"""Synthetic tests for the shared Cloudflare Workers relay client."""
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from cloud_bridge.workers import WorkersError, WorkersTransport, command, worker_origin


CONFIG = {
    'SERVICE_BRIDGE_WORKER_URL': 'https://bridge.example.org',
    'CF_ACCESS_CLIENT_ID': 'synthetic-id',
    'CF_ACCESS_CLIENT_SECRET': 'synthetic-placeholder',
}


def response(body='', status=200, **headers):
    result = requests.Response()
    result.status_code = status
    result.headers.update(headers)
    result._content = body.encode()
    result._content_consumed = True
    return result


class WorkersTransportTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.dict(os.environ, CONFIG)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_relay_uses_fixed_envelope_and_preserves_upstream_status(self):
        reply = response(
            'blocked',
            **{
                'X-Bridge-Version': '1',
                'X-Bridge-Response': 'upstream',
                'X-Origin-Http': '403',
                'Content-Type': 'text/html; charset=utf-8',
                'X-Origin-Set-Cookie': 'session%3Dsynthetic%3B%20Path%3D%2F',
            },
        )
        with WorkersTransport() as transport:
            with patch.object(transport.session, 'request', return_value=reply) as send:
                result = transport.relay(
                    'reddit',
                    'listing',
                    {'account': 'fixture', 'collection': 'saved', 'after': None},
                    headers={'User-Agent': 'synthetic', 'Host': 'evil.example'},
                    url='https://old.reddit.com/user/fixture/saved.json',
                )
        self.assertEqual(result.status_code, 403)
        self.assertEqual(result.text, 'blocked')
        self.assertEqual(result.set_cookies, ['session=synthetic; Path=/'])
        call = send.call_args
        self.assertEqual(call.args, ('POST', 'https://bridge.example.org/v1/relay/reddit/listing'))
        self.assertEqual(call.kwargs['headers']['CF-Access-Client-Id'], 'synthetic-id')
        self.assertEqual(call.kwargs['json'], {
            'parameters': {'account': 'fixture', 'collection': 'saved', 'after': None},
            'query': '',
            'headers': {'User-Agent': 'synthetic'},
            'body': None,
        })
        self.assertFalse(call.kwargs['allow_redirects'])

    def test_access_denial_and_worker_error_are_distinct_and_sanitized(self):
        with WorkersTransport() as transport:
            with patch.object(transport.session, 'request', return_value=response(
                    'private-access-error', status=403)):
                with self.assertRaisesRegex(WorkersError, 'before the Worker ran'):
                    transport.relay('x', 'home', {})
            with patch.object(transport.session, 'request', return_value=response(
                    json.dumps({'error': 'gateway_binding_unavailable'}),
                    status=502, **{
                        'X-Bridge-Version': '1',
                        'X-Bridge-Response': 'error',
                    })):
                with self.assertRaisesRegex(WorkersError, 'gateway_binding_unavailable'):
                    transport.relay('x', 'home', {})

    def test_response_stream_failure_is_sanitized(self):
        reply = response(
            'partial',
            **{
                'X-Bridge-Version': '1',
                'X-Bridge-Response': 'upstream',
                'X-Origin-Http': '200',
            },
        )
        with WorkersTransport() as transport:
            with patch.object(
                reply,
                'iter_content',
                side_effect=requests.exceptions.ChunkedEncodingError('secret'),
            ), patch.object(
                transport.session,
                'request',
                return_value=reply,
            ):
                with self.assertRaisesRegex(WorkersError, 'stream failed'):
                    transport.relay('x', 'home', {})

    def test_rejects_non_https_or_ambiguous_worker_urls(self):
        for value in (
            'http://bridge.example.org',
            'https://localhost',
            'https://127.0.0.1',
            'https://user@bridge.example.org',
            'https://bridge.example.org:444',
            'https://bridge.example.org/path',
        ):
            with self.subTest(value=value), self.assertRaises(WorkersError):
                worker_origin(value)

    def test_command_sets_workers_marker_and_removes_lambda_proxy(self):
        args = SimpleNamespace(
            arguments=['--', 'refresh', '--resume'],
            account='42',
            offline=False,
        )
        with patch.dict(os.environ, {'X_PROXY': 'http://lambda.invalid'}), \
                patch('cloud_bridge.workers.subprocess.call', return_value=7) as call:
            self.assertEqual(command(args, 'x'), 7)
        environment = call.call_args.kwargs['env']
        self.assertEqual(environment['X_TRANSPORT'], 'workers')
        self.assertNotIn('X_PROXY', environment)
        self.assertEqual(
            call.call_args.args[0][1:],
            [
                str(Path(__file__).resolve().parents[2] / 'tools/x/x.py'),
                '--account',
                '42',
                'refresh',
                '--resume',
            ],
        )

    def test_offline_command_never_starts_a_child(self):
        args = SimpleNamespace(
            arguments=['--', 'refresh'],
            account=None,
            offline=True,
        )
        with patch('cloud_bridge.workers.subprocess.call') as call:
            with self.assertRaisesRegex(WorkersError, 'Offline'):
                command(args, 'x')
        call.assert_not_called()

    def test_probe_checks_access_then_fixed_origin_relay(self):
        transport = MagicMock()
        transport.__enter__.return_value = transport
        transport.relay.return_value = SimpleNamespace(
            status_code=200,
            url='https://old.reddit.com/',
        )
        with patch(
            'cloud_bridge.workers.WorkersTransport',
            return_value=transport,
        ), patch('builtins.print') as output:
            from cloud_bridge import workers
            result = workers.command(
                SimpleNamespace(
                    arguments=['--', 'probe'],
                    account=None,
                    offline=False,
                ),
                'reddit',
            )
        self.assertEqual(result, 0)
        transport.health.assert_called_once()
        transport.relay.assert_called_once()
        self.assertEqual(
            transport.relay.call_args.args[:3],
            ('reddit', 'home', {}),
        )
        output.assert_any_call(
            '{"workers_access": "verified"}',
            flush=True,
        )


if __name__ == '__main__':
    unittest.main()
