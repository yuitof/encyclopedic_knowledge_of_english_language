"""Worker lifecycle and private proxy boundaries; no live AWS/YouTube calls."""
import contextlib
import hashlib
import http.client
import importlib.util
import io
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'infra/service-bridge'))
import proxy
import sessions
import tailscale_node
import worker

TOKEN = 'b' * 64
HASH = hashlib.sha256(TOKEN.encode()).hexdigest()
SESSION = 'a' * 32


class WorkerTests(unittest.TestCase):
    def test_duplicate_expired_stopped_or_wrong_protocol_cannot_claim(self):
        table = Mock()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ConditionalCheckFailedException'}}, 'UpdateItem')
        self.assertIsNone(sessions.Jobs(table).claim(SESSION, 'owner'))
        condition = table.update_item.call_args.kwargs['ConditionExpression']
        for required in ('expires_at > :now', 'stop_requested = :false', '#p = :protocol', '#s = :requested'):
            self.assertIn(required, condition)
        jobs = Mock()
        jobs.claim.return_value = None
        with patch.dict(os.environ, {'SESSION_TABLE': 'synthetic'}), patch.object(worker, 'Jobs', return_value=jobs), \
                patch.object(worker.boto3, 'resource'), patch.object(worker, 'TailscaleNode') as node:
            self.assertEqual(worker.handler({'session_id': SESSION}, types.SimpleNamespace(aws_request_id='owner')),
                             {'state': 'ignored'})
            node.assert_not_called()

    def setup_worker(self):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ, {'SESSION_TABLE': 'table', 'TAILSCALE_AUTH_SECRET_ARN': 'secret'}))
        stack.enter_context(patch.object(worker.time, 'time', return_value=500))
        stack.enter_context(patch.object(worker.boto3, 'resource'))
        stack.enter_context(patch.object(worker.boto3, 'client'))
        stack.enter_context(patch.object(worker, 'auth_key', return_value='tskey-auth-synthetic'))
        stack.enter_context(patch.object(worker, 'public_address', return_value='8.8.8.8'))
        jobs = stack.enter_context(patch.object(worker, 'Jobs')).return_value
        jobs.claim.return_value = {'expires_at': 1200, 'proxy_token_hash': HASH}
        jobs.get.return_value = {'stop_requested': True}
        node = stack.enter_context(patch.object(worker, 'TailscaleNode'))
        node.return_value.__enter__.return_value.status.return_value = {
            'BackendState': 'Running', 'Self': {'ID': 'synthetic-node', 'TailscaleIPs': ['100.64.0.1']}}
        proxy_context = stack.enter_context(patch.object(worker, 'Proxy'))
        proxy_context.return_value.__enter__.return_value.port = 12345
        context = types.SimpleNamespace(aws_request_id='owner', get_remaining_time_in_millis=lambda: 900000)
        return jobs, node, proxy_context, context

    def test_ready_only_after_serving_and_cleanup_on_stop(self):
        jobs, node, proxy_context, context = self.setup_worker()
        self.assertEqual(worker.handler({'session_id': SESSION}, context), {'state': 'stopped'})
        node.return_value.__enter__.return_value.serve.assert_called_once_with(12345)
        ready = jobs.publish.call_args_list[0].kwargs
        self.assertEqual((ready['ipv4'], ready['proxy_port']), ('100.64.0.1', 8443))
        self.assertEqual(jobs.publish.call_args.kwargs['reason'], 'StopRequested')
        node.return_value.__exit__.assert_called_once()
        proxy_context.return_value.__exit__.assert_called_once()

    def test_failed_serve_is_sanitized_and_never_ready(self):
        jobs, node, proxy_context, context = self.setup_worker()
        node.return_value.__enter__.return_value.serve.side_effect = RuntimeError('tskey-auth-private')
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.assertEqual(worker.handler({'session_id': SESSION}, context), {'state': 'failed'})
        self.assertNotIn('private', output.getvalue() + str(jobs.publish.call_args))
        self.assertNotIn('ready', [c.kwargs.get('state') for c in jobs.publish.call_args_list])
        node.return_value.__exit__.assert_called_once()
        proxy_context.return_value.__exit__.assert_called_once()

    def test_daemon_failure_removes_key_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tailscale_node.subprocess, 'Popen', side_effect=OSError):
            with self.assertRaises(OSError):
                with tailscale_node.TailscaleNode(directory, 'tskey-auth-private', 'synthetic'):
                    self.fail('daemon failed')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_userspace_daemon_serves_without_exit_advertisement(self):
        with tempfile.TemporaryDirectory() as directory:
            process = Mock()
            process.poll.return_value = None
            def start(arguments, **kwargs):
                (kwargs['cwd'] / 't.sock').touch()
                return process
            with patch.object(tailscale_node.subprocess, 'Popen', side_effect=start) as spawn, \
                    patch.object(tailscale_node.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=b'')) as run:
                with tailscale_node.TailscaleNode(Path(directory) / ('deep-' * 30), 'tskey-auth-synthetic', 'bridge') as node:
                    node.serve(12345)
                    self.assertIn('--tun=userspace-networking', spawn.call_args.args[0])
                    self.assertIn('--socket=t.sock', spawn.call_args.args[0])
                    commands = [c.args[0] for c in run.call_args_list]
                    self.assertFalse(any('--advertise-exit-node' in c for c in commands))
                    self.assertIn('--tcp=8443', commands[-1])
                    self.assertIn('tcp://127.0.0.1:12345', commands[-1])


class ProxyTests(unittest.TestCase):
    def request(self, service, target, authorization=None):
        connection = http.client.HTTPConnection('127.0.0.1', service.port, timeout=3)
        self.addCleanup(connection.close)
        connection.request('CONNECT', target, headers={'Proxy-Authorization': authorization} if authorization else {})
        return connection.getresponse()

    def test_authentication_allowlist_and_expiry_reject_before_dial(self):
        with proxy.Proxy(HASH, time.time() + 30) as service, patch.object(proxy, 'connect_origin') as connect:
            self.assertEqual(self.request(service, 'www.youtube.com:443').status, 407)
            self.assertEqual(self.request(service, 'www.youtube.com:443', 'Bearer ' + 'c' * 64).status, 407)
            for target in ('169.254.169.254:443', 'www.youtube.com:80', 'www.youtube.com.evil:443'):
                self.assertEqual(self.request(service, target, 'Bearer ' + TOKEN).status, 403)
            service.server.deadline = 0
            self.assertEqual(self.request(service, 'www.youtube.com:443', 'Bearer ' + TOKEN).status, 503)
            connect.assert_not_called()

    def test_private_dns_answer_is_rejected(self):
        with patch.object(proxy.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(ValueError):
                proxy.connect_origin('www.youtube.com:443')

    def test_opaque_bytes_round_trip_and_active_connection_closes(self):
        left, right = socket.socketpair()
        self.addCleanup(right.close)
        with proxy.Proxy(HASH, time.time() + 30) as service, patch.object(proxy, 'connect_origin', return_value=left):
            client = http.client.HTTPConnection('127.0.0.1', service.port, timeout=3)
            self.addCleanup(client.close)
            client.set_tunnel('www.youtube.com', 443, {'Proxy-Authorization': 'Bearer ' + TOKEN})
            client.connect()
            client.sock.sendall(b'opaque TLS bytes')
            self.assertEqual(right.recv(100), b'opaque TLS bytes')
            right.sendall(b'opaque response')
            self.assertEqual(client.sock.recv(100), b'opaque response')
        self.assertEqual(client.sock.recv(100), b'')


if __name__ == '__main__':
    unittest.main()
