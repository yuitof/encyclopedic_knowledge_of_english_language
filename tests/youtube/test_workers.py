"""Cloudflare Workers client contract tests using synthetic requests and cookies."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import quote

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/youtube'))
from workers import ROUTE, TEST_VIDEO, WorkersCaptionClient, WorkersError, WorkersTransport, worker_origin


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


class WorkersTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.dict('os.environ', CONFIG)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_caption_roundtrip_preserves_query_and_scopes_guest_cookies(self):
        signed_url = f'https://www.youtube.com/api/timedtext?v={TEST_VIDEO}&sig=a%2Fb'
        watch_cookies = [
            'visitor=synthetic; Domain=.youtube.com; Path=/',
            'watch=synthetic; Path=/watch',
            'foreign=synthetic; Domain=bridge.example.org; Path=/',
        ]
        track = {'languageCode': 'en', 'baseUrl': signed_url}
        player = {'playabilityStatus': {'status': 'OK'}, 'captions': {
            'playerCaptionsTracklistRenderer': {'captionTracks': [track]}}}
        origin_headers = {'X-Bridge-Version': '1', 'X-Origin-Http': '200'}
        replies = [
            response('{"INNERTUBE_API_KEY":"synthetic"}', **origin_headers,
                     **{'X-Origin-Set-Cookie': ', '.join(quote(c, safe='') for c in watch_cookies)}),
            response(json.dumps(player), **origin_headers),
            response('<transcript><text start="0" dur="1">Verified</text></transcript>', **origin_headers),
        ]
        with WorkersTransport() as transport, WorkersCaptionClient(transport) as captions:
            self.assertTrue(transport.session.trust_env)
            with patch.object(transport.session, 'request', side_effect=replies) as send:
                result = captions.fetch(TEST_VIDEO)
        self.assertEqual(result['caption_type'], 'manual')
        self.assertEqual(result['segments'][0]['text'], 'Verified')
        for stage, call in zip(('watch', 'player', 'timedtext'), send.call_args_list, strict=True):
            self.assertEqual(call.args, ('POST', CONFIG['SERVICE_BRIDGE_WORKER_URL'] + ROUTE + stage))
            self.assertFalse(call.kwargs['allow_redirects'])
            self.assertEqual(call.kwargs['headers']['CF-Access-Client-Secret'], 'synthetic-placeholder')
            origin = {key.lower(): value for key, value in call.kwargs['json']['headers'].items()}
            self.assertNotIn('cf-access-client-secret', origin)
            self.assertEqual(origin.get('cookie'), None if stage == 'watch' else 'visitor=synthetic')
        self.assertEqual(json.loads(send.call_args_list[1].kwargs['json']['body'])['videoId'], TEST_VIDEO)
        self.assertEqual(send.call_args.kwargs['json']['search'], f'v={TEST_VIDEO}&sig=a%2Fb')

    def test_distinguishes_access_and_upstream_denials(self):
        with WorkersTransport() as transport, WorkersCaptionClient(transport) as captions:
            with patch.object(transport.session, 'request', return_value=response(status=403)):
                with self.assertRaisesRegex(WorkersError, 'before the Worker ran'):
                    captions.fetch(TEST_VIDEO)
            with patch.object(transport.session, 'request', return_value=response(
                    **{'X-Bridge-Version': '1', 'X-Origin-Http': '403'})):
                with self.assertRaisesRegex(WorkersError, 'YouTube returned HTTP 403 at watch'):
                    captions.fetch(TEST_VIDEO)

    def test_network_failures_are_sanitized_and_never_retry_or_fallback(self):
        with WorkersTransport() as transport, WorkersCaptionClient(transport) as captions:
            with patch.object(transport.session, 'request',
                              side_effect=requests.exceptions.ProxyError('signed-url-secret')) as send:
                with self.assertRaisesRegex(WorkersError, r'^Worker HTTPS proxy connection failed[^:]+\.$'):
                    captions.fetch(TEST_VIDEO)
            send.assert_called_once()

    def test_does_not_attempt_another_video(self):
        with WorkersTransport() as transport, WorkersCaptionClient(transport) as captions:
            with patch.object(transport.session, 'request') as send, self.assertRaises(WorkersError):
                captions.fetch('AAAAAAAAAAA')
            send.assert_not_called()

    def test_probe_requires_worker_marker_and_valid_public_ip(self):
        health = response('{"ok":true}', **{'X-Bridge-Version': '1'})
        egress = response('{"status":200,"ip":"104.28.206.182"}', **{'X-Bridge-Version': '1'})
        with WorkersTransport() as transport:
            with patch.object(transport.session, 'request', side_effect=[health, egress]), patch('builtins.print') as out:
                transport.probe()
            out.assert_any_call('Gateway egress IP: 104.28.206.182')

    def test_rejects_non_https_and_ambiguous_worker_urls(self):
        for url in ('http://bridge.example.org', 'https://localhost', 'https://127.0.0.1',
                    'https://user@bridge.example.org', 'https://bridge.example.org:444',
                    'https://bridge.example.org/path', 'https://bridge.example.org/?', 'https://bridge.example.org/#'):
            with self.subTest(url=url), self.assertRaises(WorkersError):
                worker_origin(url)
