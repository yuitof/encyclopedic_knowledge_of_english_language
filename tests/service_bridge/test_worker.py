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

    def test_insufficient_time_never_starts_daemons(self):
        jobs, node, proxy_context, context = self.setup_worker()
        jobs.claim.return_value['expires_at'] = 530
        self.assertEqual(worker.handler({'session_id': SESSION}, context), {'state': 'failed'})
        node.assert_not_called()
        proxy_context.assert_not_called()
        self.assertEqual(jobs.publish.call_args.kwargs['reason'], 'InsufficientSessionTime')

    def test_gost_loss_during_session_fails_and_closes_both_contexts(self):
        jobs, node, proxy_context, context = self.setup_worker()
        jobs.get.return_value = {'stop_requested': False}
        proxy_context.return_value.__enter__.return_value.check.side_effect = [None, RuntimeError('private')]
        self.assertEqual(worker.handler({'session_id': SESSION}, context), {'state': 'failed'})
        self.assertEqual(jobs.publish.call_args.kwargs['reason'], 'BridgeFailure')
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


class PolicyTests(unittest.TestCase):
    def test_dns_pins_only_public_ipv4_and_rejects_mixed_private_answers(self):
        public = [(2, 1, 6, '', ('8.8.8.8', 443))]
        with patch.object(proxy.socket, 'getaddrinfo', return_value=public):
            mappings = proxy.public_mappings()
        self.assertEqual({m['hostname'] for m in mappings}, set(proxy.ALLOWED_HOSTS))
        for address in ('127.0.0.1', '169.254.169.254', '10.0.0.1', '100.64.0.1', '224.0.0.1'):
            with self.subTest(address=address), patch.object(proxy.socket, 'getaddrinfo',
                    return_value=public+[(2, 1, 6, '', (address, 443))]), self.assertRaises(tailscale_node.BridgeError):
                proxy.public_mappings()

    def test_configuration_is_private_pinned_and_fail_closed(self):
        mappings = [{'hostname': h, 'ip': '8.8.8.8'} for h in proxy.ALLOWED_HOSTS]
        config = proxy.configuration(12345, 12346, mappings)
        service = config['services'][0]
        self.assertEqual(service['addr'], '127.0.0.1:12345')
        self.assertEqual(service['resolver'], 'deny-fallback')
        self.assertEqual(config['bypasses'][0]['matchers'], [h+':443' for h in proxy.ALLOWED_HOSTS])
        self.assertTrue(config['bypasses'][0]['whitelist'])
        self.assertFalse(service['handler']['metadata']['sniffing'])
        self.assertFalse(service['handler']['metadata']['udp'])
        self.assertNotIn('api', config)
        self.assertNotIn(TOKEN, str(config))
        self.assertEqual(config['hosts'][0]['mappings'], mappings)

    def test_control_authentication_expiry_and_resolver_fallback(self):
        import json
        control = proxy.ThreadingHTTPServer(('127.0.0.1', 0), proxy.ControlHandler)
        control.token_hash, control.deadline, control.stopped = HASH, time.time()+30, threading.Event()
        thread = threading.Thread(target=control.serve_forever, daemon=True)
        thread.start()
        def request(path, data):
            client = http.client.HTTPConnection('127.0.0.1', control.server_port, timeout=3)
            try:
                client.request('POST', path, json.dumps(data), {'Content-Type':'application/json'})
                return json.loads(client.getresponse().read())
            finally:
                client.close()
        try:
            self.assertTrue(request('/auth', {'username':'bridge','password':TOKEN})['ok'])
            self.assertFalse(request('/auth', {'username':'bridge','password':'c'*64})['ok'])
            self.assertFalse(request('/auth', {'username':'other','password':TOKEN})['ok'])
            self.assertEqual(request('/resolve', {'host':'metadata.internal'}), {'ips':[]})
            control.deadline = 0
            self.assertFalse(request('/auth', {'username':'bridge','password':TOKEN})['ok'])
        finally:
            control.shutdown(); control.server_close(); thread.join(timeout=2)

    def test_failed_gost_launch_cleans_up_control_and_config(self):
        service = proxy.Proxy(HASH, time.time()+30)
        with patch.object(proxy, 'public_mappings', return_value=[]), \
                patch.object(proxy.subprocess, 'Popen', side_effect=OSError):
            with self.assertRaises(OSError):
                service.__enter__()
        self.assertFalse(Path(service.temporary.name).exists())
        self.assertTrue(service.control.stopped.is_set())
        self.assertFalse(service.thread.is_alive())


if __name__ == '__main__':
    unittest.main()
