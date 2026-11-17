"""Regression tests for routing, lifecycle and credential boundaries. Synthetic data only."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, Mock, patch

from botocore.exceptions import ClientError
import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/youtube'))
import exit_jobs
import exit_node
import exit_probe
import innertube
import tailscale_node

spec = importlib.util.spec_from_file_location('exit_worker', ROOT / 'infra/service-bridge/worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
SESSION = 'a' * 32


def ready():
    return {'state': 'ready', 'expires_at': 1000, 'heartbeat': 500,
            'node_id': 'synthetic-node', 'ipv4': '100.64.0.1', 'egress_ip': '8.8.8.8'}


class ExitNodeTests(unittest.TestCase):
    def test_ready_checks_deadline_heartbeat_stop_and_state(self):
        with patch.object(exit_jobs.time, 'time', return_value=500):
            exit_jobs.check_ready(ready(), reserve=60)
            for changes in ({'state': 'failed'}, {'stop_requested': True},
                            {'heartbeat': 470}, {'expires_at': 530}):
                with self.subTest(changes=changes), self.assertRaises(tailscale_node.ExitNodeError):
                    exit_jobs.check_ready({**ready(), **changes}, reserve=60)

    def test_duplicate_claim_does_not_start_second_worker(self):
        jobs = Mock()
        jobs.claim.return_value = None
        context = types.SimpleNamespace(aws_request_id='owner')
        with patch.dict(os.environ, {'SESSION_TABLE': 'synthetic'}), patch.object(worker, 'Jobs', return_value=jobs), \
                patch.object(worker.boto3, 'resource'), patch.object(worker, 'TailscaleNode') as node:
            self.assertEqual(worker.handler({'session_id': SESSION}, context), {'state': 'ignored'})
            node.assert_not_called()
            jobs.publish.assert_not_called()

    def test_expired_request_cannot_be_claimed_again(self):
        table = Mock()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ConditionalCheckFailedException'}}, 'UpdateItem')
        self.assertIsNone(exit_jobs.Jobs(table).claim(SESSION, 'owner'))
        self.assertIn('expires_at > :now', table.update_item.call_args.kwargs['ConditionExpression'])

    def worker_setup(self):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ, {'SESSION_TABLE': 'synthetic', 'TAILSCALE_AUTH_SECRET_ARN': 'secret'}))
        stack.enter_context(patch.object(worker.time, 'time', return_value=500))
        stack.enter_context(patch.object(worker.boto3, 'resource'))
        stack.enter_context(patch.object(worker.boto3, 'client'))
        jobs = stack.enter_context(patch.object(worker, 'Jobs')).return_value
        jobs.claim.return_value = {'expires_at': 1200}
        stack.enter_context(patch.object(worker, 'auth_key', return_value='tskey-auth-synthetic'))
        node = stack.enter_context(patch.object(worker, 'TailscaleNode'))
        node.return_value.__enter__.return_value.status.return_value = {
            'BackendState': 'Running', 'Self': {'ID': 'synthetic-node', 'TailscaleIPs': ['100.64.0.1']}}
        stack.enter_context(patch.object(worker, 'public_address', return_value='8.8.8.8'))
        return jobs, node, types.SimpleNamespace(aws_request_id='owner', get_remaining_time_in_millis=lambda: 900000)

    def test_worker_stops_logs_out_and_reports_terminal_state(self):
        jobs, node, context = self.worker_setup()
        jobs.get.return_value = {'stop_requested': True}
        result = worker.handler({'session_id': SESSION}, context)
        self.assertEqual(result, {'state': 'stopped'})
        node.return_value.__exit__.assert_called_once()
        self.assertEqual(jobs.publish.call_args.kwargs['reason'], 'StopRequested')
        self.assertEqual(jobs.publish.call_args_list[0].kwargs['node_id'], 'synthetic-node')

    def test_worker_failure_is_sanitized_and_context_is_closed(self):
        jobs, node, context = self.worker_setup()
        node.return_value.__enter__.return_value.status.side_effect = RuntimeError('tskey-auth-private')
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            result = worker.handler({'session_id': SESSION}, context)
        self.assertEqual(result, {'state': 'failed'})
        node.return_value.__exit__.assert_called_once()
        self.assertNotIn('private', output.getvalue())
        self.assertNotIn('private', str(jobs.publish.call_args))

    def test_selected_exit_must_be_online_and_match_identity(self):
        node = tailscale_node.TailscaleNode('/unused', '', 'synthetic')
        node.status = Mock(return_value={'BackendState': 'Running',
            'ExitNodeStatus': {'ID': 'different-node', 'Online': True}})
        with self.assertRaises(tailscale_node.ExitNodeError):
            node.check_exit('synthetic-node')
        node.status.return_value['ExitNodeStatus'] = {'ID': 'synthetic-node', 'Online': False}
        with self.assertRaises(tailscale_node.ExitNodeError):
            node.check_exit('synthetic-node')

    def test_collect_terminates_child_on_route_loss(self):
        child = Mock()
        child.poll.return_value = None
        node, jobs = Mock(), Mock()
        node.proxy_url = 'http://127.0.0.1:12345'
        node.check_exit.side_effect = tailscale_node.ExitNodeError('route lost')
        jobs.get.return_value = ready()
        with patch.object(exit_node.subprocess, 'Popen', return_value=child) as spawn, \
                patch.object(exit_jobs.time, 'time', return_value=500), self.assertRaises(tailscale_node.ExitNodeError):
            exit_node.collect(['refresh'], node, ready(), jobs, SESSION)
        child.terminate.assert_called_once()
        environment = spawn.call_args.kwargs['env']
        self.assertEqual(environment['YOUTUBE_HISTORY_PROXY'], node.proxy_url)
        self.assertEqual(environment['YOUTUBE_TRANSCRIPT_PROXY'], node.proxy_url)

    def test_bad_proxy_does_not_leak_configuration(self):
        with self.assertRaises(innertube.HistoryError) as error:
            innertube.HistoryClient({'cookies': []}, 'Europe/London', proxy='file://user:private@host')
        self.assertNotIn('private', str(error.exception))

    def test_history_proxy_overrides_ambient_https_proxy(self):
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://unrelated.invalid:1234'}):
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

    def test_failed_proxy_bind_cleans_up_secret_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tailscale_node.socket, 'socket', side_effect=OSError):
            with self.assertRaises(OSError):
                with tailscale_node.TailscaleNode(directory, 'tskey-auth-private', 'synthetic', proxy=True):
                    self.fail('proxy could not bind')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_startup_failure_cleans_up_secret_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tailscale_node.subprocess, 'Popen', side_effect=OSError):
            with self.assertRaises(OSError):
                with tailscale_node.TailscaleNode(directory, 'tskey-auth-private', 'synthetic'):
                    self.fail('daemon did not start')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_nested_checkout_uses_relative_socket_for_daemon_and_client(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / ('nested-' * 20)
            process = Mock()
            process.poll.return_value = None

            def start_daemon(arguments, **kwargs):
                (kwargs['cwd'] / 't.sock').touch()
                return process

            with patch.object(tailscale_node.subprocess, 'Popen', side_effect=start_daemon) as start, \
                    patch.object(tailscale_node.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=b'')) as run:
                with tailscale_node.TailscaleNode(root, 'tskey-auth-synthetic', 'synthetic'):
                    self.assertIn('--socket=t.sock', start.call_args.args[0])
                    self.assertIn('--socket=t.sock', run.call_args.args[0])
                    self.assertEqual(start.call_args.kwargs['cwd'], run.call_args.kwargs['cwd'])
            self.assertEqual(list(root.iterdir()), [])

    def test_egress_mismatch_prevents_collection_and_requests_stop(self):
        args = types.SimpleNamespace(arguments=['refresh'], session_seconds=720, ready_timeout=60)
        settings = {'YOUTUBE_EXIT_FUNCTION': 'function', 'YOUTUBE_EXIT_TABLE': 'table',
            'YOUTUBE_TAILSCALE_AUTH_SECRET_ARN': 'secret'}
        jobs = Mock()
        jobs.get.return_value = ready()
        aws = Mock()
        aws.client.return_value.invoke.return_value = {'StatusCode': 202}
        node = MagicMock()
        node.__enter__.return_value.proxy_url = 'http://127.0.0.1:12345'
        with patch.dict(os.environ, settings), patch.object(exit_node.boto3, 'Session', return_value=aws), \
                patch.object(exit_node, 'Jobs', return_value=jobs), patch.object(exit_node, 'auth_key', return_value='key'), \
                patch.object(exit_node, 'wait_ready', return_value=ready()), \
                patch.object(exit_node, 'TailscaleNode', return_value=node), \
                patch.object(exit_node, 'public_address', return_value='1.1.1.1'), \
                patch.object(exit_jobs.time, 'time', return_value=500), \
                patch.object(exit_node, 'collect') as collect, self.assertRaises(tailscale_node.ExitNodeError):
            exit_node.run(args)
        collect.assert_not_called()
        jobs.stop.assert_called_once()
        node.__exit__.assert_called_once()


if __name__ == '__main__':
    unittest.main()
