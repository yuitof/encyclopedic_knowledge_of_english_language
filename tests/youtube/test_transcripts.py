"""Synthetic caption fixtures; no YouTube access or saved account state."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/youtube'))
import transcripts as tr

VIDEO = 'abcDEF123_-'
URL = 'https://www.youtube.com/api/timedtext?v=' + VIDEO


def track(language='en', automatic=False):
    result = {'languageCode': language, 'baseUrl': URL}
    if automatic:
        result['kind'] = 'asr'
    return result


def player(tracks=None):
    return {'playabilityStatus': {'status': 'OK'}, 'captions': {
        'playerCaptionsTracklistRenderer': {'captionTracks': tracks if tracks is not None else [track()]}}}


def response(source='', status=200):
    result = requests.Response()
    result.status_code = status
    result._content = source.encode()
    result._content_consumed = True
    return result


class CaptionTests(unittest.TestCase):
    def test_manual_english_is_preferred_and_regional_english_is_supported(self):
        manual = track('en-GB')
        self.assertIs(tr.english_track(player([track('en', True), track('fr'), manual])), manual)

    def test_automatic_english_is_used_when_no_manual_track_exists(self):
        automatic = track('en', True)
        self.assertIs(tr.english_track(player([track('ja'), automatic])), automatic)

    def test_unavailable_requires_confirmed_absence(self):
        cases = ((player([track('fr')]), 'No English caption track'),
                 (player([]), 'Captions disabled'),
                 ({'playabilityStatus': {'status': 'OK'}}, 'Captions disabled'),
                 ({'playabilityStatus': {'status': 'ERROR', 'reason': 'This video is unavailable'}}, 'Video unavailable'))
        for payload, reason in cases:
            with self.subTest(reason=reason), self.assertRaises(tr.TranscriptUnavailable) as error:
                tr.english_track(payload)
            self.assertEqual(error.exception.reason, reason)

    def test_blocked_restricted_and_changed_responses_are_retryable(self):
        for payload in ({}, None, [], {'playabilityStatus': {'status': 'LOGIN_REQUIRED', 'reason': 'private message'}},
                        {'playabilityStatus': {'status': 'UNPLAYABLE'}}, player([{}]), player([track('')]),
                        {'error': {'message': 'private message'}, 'playabilityStatus': {'status': 'OK'}},
                        player([{'languageCode': 'en', 'baseUrl': None}])):
            with self.subTest(payload=payload), self.assertRaises(tr.TranscriptRetryNeeded) as error:
                tr.english_track(payload)
            self.assertNotIn('private message', str(error.exception))

    def test_legacy_xml_preserves_boundaries_duration_entities_and_nested_text(self):
        xml = '<transcript><text start="1.25" dur="2.5">Please &amp;amp; &lt;i&gt;keep&lt;/i&gt;</text><text start="3.75"><b>this</b> sentence.</text></transcript>'
        self.assertEqual(tr.parse_segments(xml), [
            {'start': 1.25, 'duration': 2.5, 'text': 'Please & keep'},
            {'start': 3.75, 'duration': 0.0, 'text': 'this sentence.'}])

    def test_srv3_xml_converts_milliseconds_and_joins_word_spans(self):
        xml = '<timedtext><head/><body><w t="0" id="1"/><p t="1250" d="2500"><s>Please </s><s>keep this.</s></p><p t="3750" d="0">\n</p></body></timedtext>'
        self.assertEqual(tr.parse_segments(xml), [{'start': 1.25, 'duration': 2.5, 'text': 'Please keep this.'}])

    def test_json3_ignores_screen_clear_events_and_preserves_word_spacing(self):
        source = json.dumps({'events': [{'tStartMs': 0}, {'tStartMs': 1250, 'dDurationMs': 2500,
            'segs': [{'utf8': 'Please '}, {'utf8': 'keep this.'}]}]})
        self.assertEqual(tr.parse_segments(source), [{'start': 1.25, 'duration': 2.5, 'text': 'Please keep this.'}])

    def test_empty_malformed_nonfinite_and_entity_attack_captions_are_retryable(self):
        sources = ('', '<transcript/>', '<html>challenge</html>',
                   '<transcript><text start="nan">bad</text></transcript>',
                   '<transcript><text start="-1">bad</text></transcript>',
                   '<transcript><text start="0" dur="inf">bad</text></transcript>',
                   '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><transcript><text start="0">&secret;</text></transcript>',
                   '{"events":[{"tStartMs":true,"segs":[{"utf8":"bad"}]}]}')
        for source in sources:
            with self.subTest(source=source), self.assertRaises(tr.TranscriptRetryNeeded):
                tr.parse_segments(source)

    def test_caption_url_requires_expected_https_host_and_path(self):
        for url in ('https://www.youtube.com.evil.test/api/timedtext', 'https://google.com/api/timedtext',
                    'http://www.youtube.com/api/timedtext', 'https://www.youtube.com/watch?v=x',
                    'https://user:secret@www.youtube.com/api/timedtext',
                    'https://www.youtube.com:444/api/timedtext'):
            with self.subTest(url=url), self.assertRaises(tr.TranscriptRetryNeeded) as error:
                tr.caption_url(url)
            self.assertNotIn('secret', str(error.exception))
        self.assertEqual(tr.caption_url(URL), URL)

    def test_proof_token_requirement_is_retryable_and_not_bypassed(self):
        with self.assertRaises(tr.TranscriptRetryNeeded) as error:
            tr.caption_url(URL + '&exp=xpe')
        self.assertEqual(error.exception.reason, 'PoTokenRequired')

    def session(self, replies):
        session = requests.Session()
        session.request = Mock(side_effect=replies)
        session.close = Mock(wraps=session.close)
        self.addCleanup(session.close)
        return session

    def test_full_flow_is_signed_out_and_fetches_only_selected_track(self):
        session = self.session([response('"INNERTUBE_API_KEY":"synthetic-key"'),
            response(json.dumps(player([track('en', True), track()]))),
            response('<transcript><text start="1" dur="2">Synthetic.</text></transcript>')])
        with patch.object(tr.requests, 'Session', return_value=session), \
             patch('requests.sessions.get_netrc_auth', return_value=('ambient-user', 'ambient-secret')):
            with tr.TranscriptClient() as client:
                result = client.fetch(VIDEO)
                prepared = session.prepare_request(requests.Request('GET', URL))
                self.assertNotIn('Authorization', prepared.headers)
                self.assertNotIn('Cookie', prepared.headers)
                self.assertFalse(list(session.cookies))
        self.assertEqual(result['caption_type'], 'manual')
        self.assertEqual(result['language'], 'en')
        self.assertEqual(session.request.call_count, 3)
        self.assertEqual(session.request.call_args_list[1].kwargs['json']['videoId'], VIDEO)
        self.assertEqual(session.request.call_args_list[2].args[1], URL)
        session.close.assert_called_once()

    def test_transient_network_and_http_failures_retry_with_safe_diagnostics(self):
        session = self.session([requests.ConnectionError('https://user:secret@proxy.invalid'),
            response(status=503), response('"INNERTUBE_API_KEY":"synthetic-key"'),
            response(json.dumps(player())), response('<transcript><text start="1">Works.</text></transcript>')])
        with patch.object(tr.requests, 'Session', return_value=session), patch.object(tr.time, 'sleep') as sleep:
            with tr.TranscriptClient() as client:
                self.assertEqual(client.fetch(VIDEO)['segments'][0]['text'], 'Works.')
        self.assertEqual(sleep.call_count, 2)
        for call in session.request.call_args_list:
            self.assertFalse(call.kwargs['allow_redirects'])
            self.assertEqual(call.kwargs['timeout'], (15, 30))

    def test_redirect_and_caption_404_do_not_prove_caption_absence(self):
        for status in (302, 403, 404):
            session = self.session([response(status=status)])
            with patch.object(tr.requests, 'Session', return_value=session):
                with tr.TranscriptClient() as client:
                    with self.assertRaises(tr.TranscriptRetryNeeded):
                        client.fetch(VIDEO)
            self.assertEqual(session.request.call_count, 1)

    def test_persistent_block_is_bounded_and_does_not_leak_proxy_credentials(self):
        session = self.session([requests.ConnectionError('https://user:secret@proxy.invalid')] * 3)
        with patch.object(tr.requests, 'Session', return_value=session), patch.object(tr.time, 'sleep'):
            with tr.TranscriptClient(proxy='http://user:secret@proxy.invalid') as client:
                with self.assertRaises(tr.TranscriptRetryNeeded) as error:
                    client.fetch(VIDEO)
        self.assertEqual(session.request.call_count, 3)
        self.assertNotIn('secret', str(error.exception))
        self.assertEqual(session.request.call_args.kwargs['proxies']['https'], 'http://user:secret@proxy.invalid')

    def test_invalid_video_and_proxy_do_not_make_requests(self):
        session = self.session([])
        with patch.object(tr.requests, 'Session', return_value=session):
            with tr.TranscriptClient() as client:
                with self.assertRaises(tr.TranscriptRetryNeeded):
                    client.fetch('https://www.youtube.com/watch?v=' + VIDEO)
            with self.assertRaises(tr.TranscriptRetryNeeded):
                tr.TranscriptClient(proxy='file:///private')
        session.request.assert_not_called()

    def test_missing_bootstrap_and_malformed_player_are_retryable(self):
        for replies in ([response('<html>Consent required</html>')],
                        [response('"INNERTUBE_API_KEY":"synthetic-key"'), response('not json')]):
            session = self.session(replies)
            with patch.object(tr.requests, 'Session', return_value=session):
                with tr.TranscriptClient() as client:
                    with self.assertRaises(tr.TranscriptRetryNeeded):
                        client.fetch(VIDEO)


if __name__ == '__main__':
    unittest.main()
