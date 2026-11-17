"""Session-authenticated CONNECT service. TLS remains between client and origin."""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import select
import socket
import threading
import time

ALLOWED_HOSTS = frozenset(('youtube.com', 'www.youtube.com', 'checkip.amazonaws.com'))


def connect_origin(authority):
    if authority not in {host + ':443' for host in ALLOWED_HOSTS}:
        raise ValueError('Destination is not permitted')
    host = authority[:-4]
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Destination did not resolve to public addresses')
    error = OSError('Origin unavailable')
    for family, kind, protocol, _, address in addresses:
        connection = socket.socket(family, kind, protocol)
        connection.settimeout(10)
        try:
            connection.connect(address)
            return connection
        except OSError as failure:
            error = failure
            connection.close()
    raise error


def relay(left, right, stopped, deadline):
    left.settimeout(10)
    right.settimeout(10)
    idle = time.monotonic() + 60
    while not stopped.is_set() and time.time() < deadline and time.monotonic() < idle:
        readable, _, _ = select.select((left, right), (), (), 0.5)
        for source in readable:
            data = source.recv(65536)
            if not data:
                return
            (right if source is left else left).sendall(data)
            idle = time.monotonic() + 60


class Handler(BaseHTTPRequestHandler):
    rbufsize = 0
    timeout = 10

    def log_message(self, *args):
        pass

    def do_CONNECT(self):
        self.close_connection = True
        authorization = self.headers.get('Proxy-Authorization', '')
        token = authorization.removeprefix('Bearer ')
        if (not authorization.startswith('Bearer ') or len(token) != 64 or
                not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), self.server.token_hash)):
            self.send_error(407)
            return
        if self.server.stopped.is_set() or time.time() >= self.server.deadline:
            self.send_error(503)
            return
        if self.path not in {host + ':443' for host in ALLOWED_HOSTS}:
            self.send_error(403)
            return
        if not self.server.slots.acquire(blocking=False):
            self.send_error(503)
            return
        connected = False
        try:
            with connect_origin(self.path) as remote:
                self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                connected = True
                relay(self.connection, remote, self.server.stopped, self.server.deadline)
        except (OSError, ValueError):
            if not connected:
                self.send_error(502)
        finally:
            self.server.slots.release()


class Proxy:
    def __init__(self, token_hash, deadline):
        if len(token_hash) != 64 or any(c not in '0123456789abcdef' for c in token_hash):
            raise ValueError('Invalid session credential hash')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.token_hash = token_hash
        self.server.deadline = deadline
        self.server.stopped = threading.Event()
        self.server.slots = threading.BoundedSemaphore(16)
        self.port = self.server.server_port

    def __enter__(self):
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.stopped.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
