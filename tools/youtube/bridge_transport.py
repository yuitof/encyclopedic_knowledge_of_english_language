"""Reach a private bridge through Codex Cloud's built-in VPN TCP proxy."""
import base64
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import select
import threading
import time


class BridgeError(RuntimeError):
    """Only fixed, credential-free messages may be surfaced to the CLI."""


def endpoint(job):
    try:
        address = str(ipaddress.IPv4Address(job['ipv4']))
        if ipaddress.ip_address(address) not in ipaddress.ip_network('100.64.0.0/10'):
            raise ValueError
        if job['protocol'] != 'connect-v2' or job['proxy_port'] != 8443:
            raise ValueError
        return address, 8443
    except (KeyError, ValueError, TypeError):
        raise BridgeError('Session does not describe a supported private bridge') from None


def peer_connection(address, port):
    connection = http.client.HTTPConnection('proxy', 8088, timeout=10)
    connection.set_tunnel(address, port)
    try:
        connection.connect()
        return connection
    except BaseException:
        connection.close()
        raise


def probe_private_proxy(address, port):
    """Prove private TCP/service reachability without origin access or credentials."""
    connection = peer_connection(address, port)
    try:
        connection.send(b'CONNECT www.youtube.com:443 HTTP/1.1\r\nHost: www.youtube.com:443\r\n\r\n')
        response = http.client.HTTPResponse(connection.sock)
        response.begin()
        status = response.status
        response.close()
        if status != 407:
            raise BridgeError('Private endpoint did not enforce proxy authentication')
        return status
    finally:
        connection.close()


def open_tunnel(address, port, authority, token):
    # Use the documented raw TCP CONNECT endpoint, not the ambient HTTPS proxy.
    # There is intentionally no direct-connect or standalone Tailscale fallback.
    connection = peer_connection(address, port)
    try:
        authorization = base64.b64encode(('bridge:' + token).encode()).decode('ascii')
        connection.send((f'CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n'
                         f'Proxy-Authorization: Basic {authorization}\r\n\r\n').encode('ascii'))
        response = http.client.HTTPResponse(connection.sock)
        response.begin()
        status = response.status
        response.close()
        if status != 200:
            raise OSError('Private proxy refused the connection')
        return connection
    except BaseException:
        connection.close()
        raise


class Handler(BaseHTTPRequestHandler):
    rbufsize = 0
    timeout = 10

    def log_message(self, *args):
        pass

    def do_CONNECT(self):
        self.close_connection = True
        # Only authority syntax is accepted; Lambda enforces the destination list.
        if (len(self.path) > 253 or not self.path.endswith(':443') or
                any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789.-:' for c in self.path)):
            self.send_error(403)
            return
        connected = False
        try:
            if self.server.stopped.is_set() or time.time() >= self.server.deadline:
                raise OSError('Session ended')
            connection = open_tunnel(*self.server.endpoint, self.path, self.server.token)
            try:
                self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                connected = True
                self.connection.settimeout(10)
                idle = time.monotonic() + 60
                while (not self.server.stopped.is_set() and time.time() < self.server.deadline
                       and time.monotonic() < idle):
                    readable, _, _ = select.select((self.connection, connection.sock), (), (), 0.5)
                    for source in readable:
                        data = source.recv(65536)
                        if not data:
                            return
                        (connection.sock if source is self.connection else self.connection).sendall(data)
                        idle = time.monotonic() + 60
            finally:
                connection.close()
        except (OSError, http.client.HTTPException):
            self.server.failed.set()
            if not connected:
                self.send_error(502)


class ManagedBridge:
    def __init__(self, job, token):
        target = endpoint(job)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.endpoint = target
        self.server.token = token
        self.server.deadline = float(job['expires_at'])
        self.server.stopped = threading.Event()
        self.server.failed = threading.Event()
        self.proxy_url = f'http://127.0.0.1:{self.server.server_port}'

    def __enter__(self):
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def check(self):
        if self.server.failed.is_set() or self.server.stopped.is_set() or time.time() >= self.server.deadline:
            raise BridgeError('Built-in VPN bridge connection failed; collection stopped')

    def __exit__(self, *args):
        self.server.stopped.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.server.token = None
