"""Supervise GOST; Python handles session policy, never proxy traffic."""
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time

from tailscale_node import BridgeError

ALLOWED_HOSTS = ('youtube.com', 'www.youtube.com', 'checkip.amazonaws.com')


def public_mappings():
    """Resolve once and pin only global IPv4 addresses for this bounded session."""
    mappings = []
    for host in ALLOWED_HOSTS:
        addresses = {a[4][0] for a in socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)}
        if not addresses or any(not ipaddress.ip_address(ip).is_global or
                                ipaddress.ip_address(ip).is_multicast for ip in addresses):
            raise BridgeError('An approved proxy destination did not resolve to public addresses')
        mappings.extend({'hostname': host, 'ip': ip} for ip in sorted(addresses))
    return mappings


def configuration(port, control_port, mappings):
    control = f'http://127.0.0.1:{control_port}'
    return {
        'services': [{'name': 'youtube-connect', 'addr': f'127.0.0.1:{port}',
            'handler': {'type': 'http', 'auther': 'session',
                        'metadata': {'idleTimeout': '60s', 'udp': False, 'sniffing': False}},
            'listener': {'type': 'tcp'}, 'bypass': 'approved',
            'hosts': 'pinned', 'resolver': 'deny-fallback'}],
        'authers': [{'name': 'session', 'plugin': {'type': 'http', 'addr': control + '/auth', 'timeout': '2s'}}],
        'bypasses': [{'name': 'approved', 'whitelist': True,
                     'matchers': [host + ':443' for host in ALLOWED_HOSTS]}],
        'hosts': [{'name': 'pinned', 'mappings': mappings}],
        # A host-map miss must fail; never fall back to a second unchecked DNS lookup.
        'resolvers': [{'name': 'deny-fallback',
                       'plugin': {'type': 'http', 'addr': control + '/resolve', 'timeout': '2s'}}],
    }


class ControlHandler(BaseHTTPRequestHandler):
    timeout = 5

    def log_message(self, *args):
        pass

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if self.path not in ('/auth', '/resolve') or not 0 < length <= 4096:
                raise ValueError
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError
            if self.path == '/resolve':
                result = {'ips': []}
            else:
                token = data.get('password')
                valid = (not self.server.stopped.is_set() and time.time() < self.server.deadline
                    and data.get('username') == 'bridge' and isinstance(token, str) and len(token) == 64
                    and all(c in '0123456789abcdef' for c in token)
                    and hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), self.server.token_hash))
                result = {'ok': bool(valid), 'id': 'bridge' if valid else ''}
            body = json.dumps(result).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, OSError):
            self.send_error(400)


class Proxy:
    def __init__(self, token_hash, deadline):
        if not isinstance(token_hash, str) or len(token_hash) != 64 or any(c not in '0123456789abcdef' for c in token_hash):
            raise BridgeError('Invalid session credential hash')
        self.token_hash, self.deadline = token_hash, deadline
        self.process = self.control = self.thread = self.temporary = None

    def __enter__(self):
        try:
            mappings = public_mappings()
            if time.time() >= self.deadline:
                raise BridgeError('Proxy session expired during startup')
            self.control = ThreadingHTTPServer(('127.0.0.1', 0), ControlHandler)
            self.control.token_hash = self.token_hash
            self.control.deadline = self.deadline
            self.control.stopped = threading.Event()
            self.thread = threading.Thread(target=self.control.serve_forever, daemon=True)
            self.thread.start()
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                self.port = listener.getsockname()[1]
            self.temporary = tempfile.TemporaryDirectory(prefix='gost-', dir='/tmp')
            path = Path(self.temporary.name) / 'config.json'
            path.touch(mode=0o600)
            path.write_text(json.dumps(configuration(self.port, self.control.server_port, mappings)))
            # No credentials in argv and no daemon output, traffic logs, API, sniffing, or MITM.
            self.process = subprocess.Popen([os.environ.get('GOST_BIN', '/usr/local/bin/gost'), '-C', str(path)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            timeout = time.monotonic() + 10
            while time.monotonic() < timeout:
                self.check()
                try:
                    client = http.client.HTTPConnection('127.0.0.1', self.port, timeout=0.5)
                    try:
                        client.request('CONNECT', 'www.youtube.com:443')
                        if client.getresponse().status == 407:
                            return self
                    finally:
                        client.close()
                except (OSError, http.client.HTTPException):
                    time.sleep(0.1)
            raise BridgeError('GOST proxy did not become ready')
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def check(self):
        if self.process is None or self.process.poll() is not None or time.time() >= self.deadline:
            raise BridgeError('GOST proxy is unavailable or expired')

    def __exit__(self, *args):
        if self.control is not None:
            self.control.stopped.set()
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.thread is not None:
            self.control.shutdown()
            self.thread.join(timeout=2)
        if self.control is not None:
            self.control.server_close()
        if self.temporary is not None:
            self.temporary.cleanup()
