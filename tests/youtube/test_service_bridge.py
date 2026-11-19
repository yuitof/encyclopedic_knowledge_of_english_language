"""Built-in VPN tunnel and client lifecycle tests; no live AWS or YouTube."""
import base64
import contextlib
import hashlib
import http.client
import io
import os
from pathlib import Path
import socketserver
import sys
import threading
import time
import types
import unittest
from unittest.mock import MagicMock, Mock, patch

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/youtube'))
sys.path.insert(0, str(ROOT / 'tools'))
from cloud_bridge import sessions as bridge_sessions, transport as bridge_transport
import innertube
from cloud_bridge import client as service_bridge
import youtube

TOKEN = 'b' * 64
SESSION = 'a' * 32


def ready():
    return {'state': 'ready', 'protocol': 'connect-v2', 'expires_at': 1000, 'heartbeat': 500,
            'node_id': 'synthetic-node', 'ipv4': '100.64.0.1', 'proxy_port': 8443, 'egress_ip': '8.8.8.8'}


class BridgeTests(unittest.TestCase):
    def test_cloud_tcp_failure_categories_are_sanitized_without_retry(self):
        cases = [(TimeoutError('PRIVATE'), 'timed out'),
                 (ConnectionRefusedError('PRIVATE'), 'proxy connection refused'),
                 (OSError('Tunnel connection failed: 403 Forbidden'), 'CONNECT returned HTTP 403'),
                 (OSError('PRIVATE'), 'connection failed')]
        for failure, message in cases:
            connection = Mock()
            connection.connect.side_effect = failure
            with self.subTest(message=message), patch.object(bridge_transport.http.client, 'HTTPConnection', return_value=connection):
                with self.assertRaisesRegex(bridge_transport.BridgeError, message) as caught:
                    bridge_transport.peer_connection('100.64.0.1', 8443)
                self.assertNotIn('PRIVATE', str(caught.exception))
                connection.connect.assert_called_once()
                connection.close.assert_called_once()

    def test_private_proxy_read_timeout_reports_stage_without_private_values(self):
        connection = Mock()
        with patch.object(bridge_transport, 'peer_connection', return_value=connection), \
                patch.object(bridge_transport.http.client, 'HTTPResponse', side_effect=TimeoutError('PRIVATE')):
            with self.assertRaisesRegex(bridge_transport.BridgeError, 'Private bridge authentication check: timed out') as caught:
                bridge_transport.probe_private_proxy('100.64.0.1',8443)
        self.assertNotIn('PRIVATE', str(caught.exception))
        connection.close.assert_called_once()

    def test_shared_settings_preserve_legacy_and_prefer_shared_values(self):
        for name in ('FUNCTION', 'TABLE'):
            legacy = f'YOUTUBE_BRIDGE_{name}'
            shared = f'SERVICE_BRIDGE_{name}'
            with self.subTest(name=name), patch.dict(os.environ, {legacy: 'legacy'}, clear=True):
                with contextlib.redirect_stderr(io.StringIO()) as stderr:
                    self.assertEqual(service_bridge.required(name), 'legacy')
                self.assertEqual(stderr.getvalue(), f'{legacy} is deprecated. Set {shared} instead.\n')
                with patch.dict(os.environ, {shared: 'shared'}), contextlib.redirect_stderr(io.StringIO()) as stderr:
                    self.assertEqual(service_bridge.required(name), 'shared')
                self.assertEqual(stderr.getvalue(), '')

    def test_x_child_uses_shared_lifecycle_and_only_x_proxy(self):
        child, jobs, transport = Mock(), Mock(), Mock()
        child.poll.return_value = 0
        child.returncode = 0
        jobs.get.return_value = ready()
        transport.proxy_url = 'http://127.0.0.1:12345'
        with patch.dict(os.environ, {}, clear=True), patch.object(service_bridge.subprocess, 'Popen', return_value=child) as spawn, \
                patch.object(bridge_sessions.time, 'time', return_value=500):
            self.assertEqual(service_bridge.collect(['--account', '42', 'refresh', '--resume'],
                transport, ready(), jobs, SESSION, workflow='x'), 0)
        call = spawn.call_args
        self.assertTrue(call.args[0][1].endswith('/tools/x/x.py'))
        self.assertEqual(call.args[0][2:], ['--account', '42', 'refresh', '--resume'])
        self.assertEqual(call.kwargs['env']['X_PROXY'], transport.proxy_url)
        self.assertNotIn('HTTPS_PROXY', call.kwargs['env'])
        self.assertNotIn('YOUTUBE_HISTORY_PROXY', call.kwargs['env'])

    def test_x_unsigned_probe_uses_shared_session_and_stops_on_http_denial(self):
        args = types.SimpleNamespace(arguments=['probe'], session_seconds=180, ready_timeout=60)
        jobs, aws, transport = Mock(), Mock(), MagicMock()
        jobs.get.return_value = ready()
        aws.client.return_value.invoke.return_value = {'StatusCode': 202}
        with patch.dict(os.environ, {'SERVICE_BRIDGE_FUNCTION': 'function', 'SERVICE_BRIDGE_TABLE': 'table'}, clear=True), \
                patch.object(service_bridge.boto3, 'Session', return_value=aws), \
                patch.object(service_bridge, 'Jobs', return_value=jobs), \
                patch.object(service_bridge, 'wait_ready', return_value=ready()), \
                patch.object(service_bridge, 'ManagedBridge', return_value=transport), \
                patch.object(service_bridge, 'probe_private_proxy', return_value=407), \
                patch.object(service_bridge, 'public_address', return_value='8.8.8.8'), \
                patch.object(service_bridge, 'x_probe', return_value=[{'status':403}]) as probe, \
                patch.object(service_bridge, 'youtube_probe', side_effect=AssertionError('Wrong probe')), \
                patch.object(service_bridge, 'collect', side_effect=AssertionError('No authenticated workflow during probe')), \
                patch.object(bridge_sessions.time, 'time', return_value=500), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(service_bridge.run(args, workflow='x'), 1)
        probe.assert_called_once()
        jobs.stop.assert_called_once()
        transport.__exit__.assert_called_once()

    def test_offline_or_unsupported_x_commands_never_create_aws_session(self):
        with patch.object(service_bridge.boto3, 'Session', side_effect=AssertionError('AWS forbidden')):
            for arguments in (['--offline', 'refresh'], ['login'], ['search', 'phrase']):
                with self.subTest(arguments=arguments), self.assertRaises(bridge_transport.BridgeError):
                    service_bridge.run(types.SimpleNamespace(arguments=arguments), workflow='x')

    def test_sessions_store_only_token_hash(self):
        table = Mock()
        bridge_sessions.Jobs(table).create(SESSION, 720, TOKEN)
        item = table.put_item.call_args.kwargs['Item']
        self.assertEqual(item['protocol'], 'connect-v2')
        self.assertEqual(item['proxy_token_hash'], hashlib.sha256(TOKEN.encode()).hexdigest())
        self.assertNotIn(TOKEN, repr(item))

    def test_stale_stopped_expiring_and_old_protocol_are_rejected(self):
        with patch.object(bridge_sessions.time, 'time', return_value=500):
            bridge_sessions.check_ready(ready(), reserve=60)
            for change in ({'state': 'failed'}, {'stop_requested': True}, {'heartbeat': 470},
                           {'expires_at': 530}, {'protocol': 'connect-v1'}):
                with self.subTest(change=change), self.assertRaises(bridge_transport.BridgeError):
                    bridge_sessions.check_ready({**ready(), **change}, reserve=60)
        for change in ({'ipv4': '8.8.8.8'}, {'ipv4': '127.0.0.1'}, {'proxy_port': 22}, {'protocol': None}):
            with self.subTest(change=change), self.assertRaises(bridge_transport.BridgeError):
                bridge_transport.endpoint({**ready(), **change})

    def test_tunnel_uses_managed_proxy_and_keeps_auth_inside_private_tunnel(self):
        connection = Mock()
        response = Mock(status=200)
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://ambient.invalid:1234'}), \
                patch.object(bridge_transport.http.client, 'HTTPConnection', return_value=connection) as connect, \
                patch.object(bridge_transport.http.client, 'HTTPResponse', return_value=response):
            self.assertIs(bridge_transport.open_tunnel('100.64.0.1', 8443, 'www.youtube.com:443', TOKEN), connection)
        connect.assert_called_once_with('proxy', 8088, timeout=10)
        connection.set_tunnel.assert_called_once_with('100.64.0.1', 8443)
        self.assertIn(('Proxy-Authorization: Basic ' + base64.b64encode(('bridge:'+TOKEN).encode()).decode()).encode(), connection.send.call_args.args[0])

    def test_private_probe_requires_authentication_without_credentials_or_origin(self):
        connection = Mock()
        response = Mock(status=407)
        with patch.object(bridge_transport, 'peer_connection', return_value=connection) as peer, \
                patch.object(bridge_transport.http.client, 'HTTPResponse', return_value=response):
            self.assertEqual(bridge_transport.probe_private_proxy('100.64.0.1', 8443), 407)
        peer.assert_called_once_with('100.64.0.1', 8443)
        self.assertNotIn(b'Proxy-Authorization', connection.send.call_args.args[0])
        connection.close.assert_called_once()

    def test_managed_proxy_failure_closes_without_fallback(self):
        connection = Mock()
        connection.connect.side_effect = OSError('unreachable')
        with patch.object(bridge_transport.http.client, 'HTTPConnection', return_value=connection) as connect:
            with self.assertRaises(bridge_transport.BridgeError):
                bridge_transport.open_tunnel('100.64.0.1', 8443, 'www.youtube.com:443', TOKEN)
        connect.assert_called_once()
        connection.close.assert_called_once()

    def test_collect_terminates_child_on_transport_loss(self):
        child = Mock()
        child.poll.return_value = None
        transport, jobs = Mock(), Mock()
        transport.proxy_url = 'http://127.0.0.1:12345'
        transport.check.side_effect = bridge_transport.BridgeError('route lost')
        jobs.get.return_value = ready()
        with patch.object(service_bridge.subprocess, 'Popen', return_value=child) as spawn, \
                patch.object(bridge_sessions.time, 'time', return_value=500), self.assertRaises(bridge_transport.BridgeError):
            service_bridge.collect(['refresh'], transport, ready(), jobs, SESSION)
        child.terminate.assert_called_once()
        for key in ('YOUTUBE_HISTORY_PROXY', 'YOUTUBE_TRANSCRIPT_PROXY'):
            self.assertEqual(spawn.call_args.kwargs['env'][key], transport.proxy_url)

    def test_egress_mismatch_prevents_collection_and_always_stops_session(self):
        args = types.SimpleNamespace(arguments=['refresh'], session_seconds=720, ready_timeout=60)
        settings = {'YOUTUBE_BRIDGE_FUNCTION': 'function', 'YOUTUBE_BRIDGE_TABLE': 'table'}
        jobs, aws, transport = Mock(), Mock(), MagicMock()
        jobs.get.return_value = ready()
        aws.client.return_value.invoke.return_value = {'StatusCode': 202}
        transport.__enter__.return_value.proxy_url = 'http://127.0.0.1:12345'
        with patch.dict(os.environ, settings), patch.object(service_bridge.boto3, 'Session', return_value=aws), \
                patch.object(service_bridge, 'Jobs', return_value=jobs), \
                patch.object(service_bridge, 'wait_ready', return_value=ready()), \
                patch.object(service_bridge, 'ManagedBridge', return_value=transport), \
                patch.object(service_bridge, 'public_address', return_value='1.1.1.1'), \
                patch.object(bridge_sessions.time, 'time', return_value=500), \
                patch.object(service_bridge, 'collect') as collect, self.assertRaises(bridge_transport.BridgeError):
            service_bridge.run(args)
        collect.assert_not_called()
        jobs.stop.assert_called_once()
        transport.__exit__.assert_called_once()
        self.assertEqual([c.args[0] for c in aws.client.call_args_list], ['lambda'])

    def test_history_proxy_overrides_ambient_proxy_with_tls_verification(self):
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://ambient.invalid:1234'}):
            session = requests.Session()
            adapter = Mock()
            response = requests.Response()
            response.status_code = 200
            adapter.send.return_value = response
            session.mount('https://', adapter)
            with patch.object(innertube.requests, 'Session', return_value=session):
                client = innertube.HistoryClient({'cookies': []}, 'Europe/London', 'http://127.0.0.1:12345')
                client._request('GET', innertube.HISTORY_URL)
            self.assertEqual(adapter.send.call_args.kwargs['proxies']['https'], 'http://127.0.0.1:12345')
            self.assertTrue(adapter.send.call_args.kwargs['verify'])
            client.__exit__()

    def test_cli_preserves_failed_probe_exit_status(self):
        with patch.object(sys, 'argv', ['youtube.py', 'bridge', '--', 'probe']), \
                patch.object(service_bridge, 'command', return_value=1):
            self.assertEqual(youtube.main(), 1)

    def test_nested_connect_round_trip_over_real_sockets(self):
        observed = []
        class FakeManagedProxy(socketserver.StreamRequestHandler):
            def handle(self):
                outer = self.rfile.readline()
                headers = []
                while True:
                    line = self.rfile.readline()
                    if line in (b'\r\n', b''):
                        break
                    headers.append(line)
                observed.append((outer, headers))
                self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                inner = self.rfile.readline()
                headers = []
                while True:
                    line = self.rfile.readline()
                    if line in (b'\r\n', b''):
                        break
                    headers.append(line)
                observed.append((inner, headers))
                self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                data = self.rfile.read(8)
                self.wfile.write(data)
        server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), FakeManagedProxy)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        original = http.client.HTTPConnection
        def route_proxy(host, port, **kwargs):
            self.assertEqual((host, port), ('proxy', 8088))
            return original('127.0.0.1', server.server_address[1], **kwargs)
        try:
            job = {**ready(), 'expires_at': time.time() + 60}
            with patch.object(bridge_transport.http.client, 'HTTPConnection', side_effect=route_proxy):
                with bridge_transport.ManagedBridge(job, TOKEN) as transport:
                    port = int(transport.proxy_url.rsplit(':', 1)[1])
                    for host in ('www.youtube.com', 'x.com', 'abs.twimg.com'):
                        client = original('127.0.0.1', port, timeout=3)
                        try:
                            client.set_tunnel(host, 443)
                            client.connect()
                            client.sock.sendall(b'\x16\x03\x01HELLO')
                            self.assertEqual(client.sock.recv(8), b'\x16\x03\x01HELLO')
                            transport.check()
                        finally:
                            client.close()
            self.assertIn(b'CONNECT 100.64.0.1:8443 ', observed[0][0])
            self.assertNotIn(TOKEN.encode(), b''.join(observed[0][1]))
            self.assertIn(b'CONNECT www.youtube.com:443 ', observed[1][0])
            self.assertIn(base64.b64encode(('bridge:'+TOKEN).encode()), b''.join(observed[1][1]))
            self.assertIn(b'CONNECT x.com:443 ', observed[3][0])
            self.assertIn(b'CONNECT abs.twimg.com:443 ', observed[5][0])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
