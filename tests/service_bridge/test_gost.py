"""Real GOST binary tests. Run inside the Lambda image; no external network needed."""
import base64
import hashlib
import http.client
import os
from pathlib import Path
import socket
import socketserver
import sys
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'infra/service-bridge'))
import proxy
from tailscale_node import BridgeError

TOKEN = 'b' * 64
HASH = hashlib.sha256(TOKEN.encode()).hexdigest()
AUTH = 'Basic ' + base64.b64encode(('bridge:'+TOKEN).encode()).decode()
BINARY = os.environ.get('GOST_BIN', '/usr/local/bin/gost')


@unittest.skipUnless(Path(BINARY).is_file(), 'Real GOST integration runs in the Lambda image')
class GostTests(unittest.TestCase):
    def setUp(self):
        self.stack = __import__('contextlib').ExitStack()
        self.addCleanup(self.stack.close)
        # Synthetic DNS pins are confined to this test; production rejects loopback.
        self.stack.enter_context(patch.object(proxy, 'public_mappings', return_value=[
            {'hostname': h, 'ip': '127.0.0.1'} for h in proxy.ALLOWED_HOSTS]))
        self.service = self.stack.enter_context(proxy.Proxy(HASH, time.time()+60))

    def request(self, authority, authorization=AUTH, method='CONNECT'):
        client = http.client.HTTPConnection('127.0.0.1', self.service.port, timeout=3)
        try:
            client.request(method, authority, headers={'Proxy-Authorization': authorization} if authorization else {})
            return client.getresponse().status
        finally:
            client.close()

    def test_unauthenticated_and_wrong_credentials_rejected(self):
        for authorization in (None, 'Bearer '+TOKEN, 'Basic '+base64.b64encode(b'bridge:wrong').decode()):
            with self.subTest(authorization=authorization):
                self.assertEqual(self.request('www.youtube.com:443', authorization), 407)

    def test_hosts_ports_metadata_and_http_forwarding_restricted(self):
        for authority in ('example.com:443', 'www.youtube.com:80', 'www.youtube.com.evil:443',
                          '127.0.0.1:443', '169.254.169.254:443', '[::1]:443', 'youtube.com.:443'):
            with self.subTest(authority=authority):
                self.assertEqual(self.request(authority), 403)
        self.assertEqual(self.request('http://www.youtube.com/', method='GET'), 403)

    def test_control_unavailable_fails_closed(self):
        self.service.control.stopped.set()
        self.assertEqual(self.request('www.youtube.com:443'), 407)

    def test_host_map_miss_cannot_use_dns_fallback(self):
        # Exact domain matching may be case-insensitive in GOST; the resolver must
        # return no addresses if the exact pinned host key is absent.
        self.assertNotEqual(self.request('WWW.YOUTUBE.COM:443'), 200)

    def test_expiry_denies_new_connections_and_supervisor_detects_dead_process(self):
        self.service.control.deadline = 0
        self.assertEqual(self.request('www.youtube.com:443'), 407)
        self.service.process.terminate()
        self.service.process.wait(timeout=5)
        with self.assertRaises(BridgeError):
            self.service.check()

    def test_opaque_tunnel_and_shutdown_closes_active_connection(self):
        class Echo(socketserver.BaseRequestHandler):
            def handle(self):
                while data := self.request.recv(4096):
                    self.request.sendall(data)
        origin = socketserver.ThreadingTCPServer(('127.0.0.1', 443), Echo)
        origin.daemon_threads = True
        thread = threading.Thread(target=origin.serve_forever, daemon=True)
        thread.start()
        client = http.client.HTTPConnection('127.0.0.1', self.service.port, timeout=3)
        try:
            client.set_tunnel('www.youtube.com', 443, {'Proxy-Authorization': AUTH})
            client.connect()
            data = b'\x16\x03\x01opaque-TLS-record'
            client.sock.sendall(data)
            self.assertEqual(client.sock.recv(len(data)), data)
            self.service.process.terminate()
            self.service.process.wait(timeout=5)
            self.assertEqual(client.sock.recv(10), b'')
        finally:
            client.close(); origin.shutdown(); origin.server_close(); thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
