"""Synthetic HTTP and refresh fixtures only; no real sessions or network."""
import contextlib
from datetime import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, Mock, patch
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/youtube'))
import innertube as it
spec = importlib.util.spec_from_file_location('refresh_test', ROOT / 'tools/youtube/youtube.py')
yt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(yt)
VIDEO = 'abcDEF123_-'
OTHER = 'zyxWVU987_-'


def config():
    return {'LOGGED_IN': True, 'INNERTUBE_CONTEXT': {'client': {'clientName': 'WEB', 'clientVersion': 'synthetic'}},
            'SESSION_INDEX': 2, 'DELEGATED_SESSION_ID': 'synthetic-page'}


def response(payload=None, status=200, source=None):
    result = requests.Response()
    result.status_code = status
    result._content = (source if source is not None else json.dumps(payload)).encode()
    result._content_consumed = True
    return result


def continuation(token='synthetic-next', path=it.BROWSE_PATH):
    return {'continuationItemRenderer': {'continuationEndpoint': {
        'commandMetadata': {'webCommandMetadata': {'apiUrl': path}},
        'continuationCommand': {'token': token}}}}


def section(label='Yesterday', identifier=VIDEO):
    return {'itemSectionRenderer': {'header': {'itemSectionHeaderRenderer': {'title': {'simpleText': label}}},
        'contents': [{'videoRenderer': {'videoId': identifier, 'title': {'simpleText': 'Synthetic title'},
                                      'ownerText': {'simpleText': 'Synthetic channel'}}}]}}


def page(items, initial=False):
    payload = {'responseContext': {'mainAppWebResponseContext': {'loggedOut': False}}}
    if initial:
        payload['contents'] = {'twoColumnBrowseResultsRenderer': {'tabs': [
            {'tabRenderer': {'selected': True, 'content': {'sectionListRenderer': {'contents': items}}}}]}}
    else:
        payload['onResponseReceivedActions'] = [{'appendContinuationItemsAction': {'continuationItems': items}}]
    return payload


class TransportTests(unittest.TestCase):
    def session(self, responses):
        session = requests.Session()
        session.request = Mock(side_effect=responses)
        session.close = Mock(wraps=session.close)
        self.addCleanup(session.close)
        return session

    def state(self):
        return {'cookies': [
            {'name': 'SAPISID', 'value': 'synthetic-sid', 'domain': '.youtube.com', 'expires': -1},
            {'name': 'secret', 'value': 'unrelated', 'domain': '.google.com', 'expires': -1},
            {'name': 'expired', 'value': 'old', 'domain': '.youtube.com', 'expires': 1},
        ]}

    def bootstrap(self):
        return response(source='ytcfg.set(' + json.dumps(config()) + ');')

    def test_bootstrap_parses_json_without_executing_scripts(self):
        source = 'ytcfg.set({"extra":{"literal":"});"}}); ytcfg.set(' + json.dumps(config()) + ');'
        parsed = it.bootstrap_config(source)
        self.assertEqual(parsed['extra']['literal'], '});')
        self.assertTrue(parsed['LOGGED_IN'])

    def test_bootstrap_rejects_signed_out_missing_and_changed_config(self):
        for source in ('consent page', 'ytcfg.set({"LOGGED_IN":false});',
                       'ytcfg.set({"LOGGED_IN":true,"INNERTUBE_CONTEXT":[]});'):
            with self.subTest(source=source), self.assertRaises(it.HistoryError):
                it.bootstrap_config(source)

    def test_requests_authentication_timezone_cookie_scope_and_cleanup(self):
        session = self.session([self.bootstrap(), response(page([], initial=True))])
        with patch.object(it.requests, 'Session', return_value=session), patch.object(it.time, 'time', return_value=2_000_000_000):
            with it.HistoryClient(self.state(), 'Asia/Tokyo') as client:
                client.browse()
                body = session.request.call_args.kwargs['json']
                self.assertEqual(body['browseId'], 'FEhistory')
                self.assertEqual(body['context']['client']['utcOffsetMinutes'], 540)
                self.assertEqual(body['context']['client']['timeZone'], 'Asia/Tokyo')
                self.assertEqual(session.headers['X-Goog-Authuser'], '2')
                self.assertEqual(session.headers['X-Goog-PageId'], 'synthetic-page')
                digest = hashlib.sha1(b'2000000000 synthetic-sid https://www.youtube.com').hexdigest()
                self.assertEqual(session.headers['Authorization'], 'SAPISIDHASH 2000000000_' + digest)
                self.assertEqual([c.name for c in session.cookies], ['SAPISID'])
        session.close.assert_called_once()
        for call in session.request.call_args_list:
            self.assertFalse(call.kwargs['allow_redirects'])
            self.assertEqual(call.kwargs['timeout'], (15, 45))

    def test_transient_post_failure_retries_same_continuation(self):
        session = self.session([self.bootstrap(), response(status=503), response(page([]))])
        with patch.object(it.requests, 'Session', return_value=session), patch.object(it.time, 'sleep') as sleep:
            with it.HistoryClient(self.state(), 'Europe/London') as client:
                client.browse('synthetic-next')
        sleep.assert_called_once_with(0.5)
        posts = [call for call in session.request.call_args_list if call.args[0] == 'POST']
        self.assertEqual(len(posts), 2)
        self.assertEqual(posts[0].kwargs['json'], posts[1].kwargs['json'])
        self.assertEqual(posts[1].kwargs['json']['continuation'], 'synthetic-next')
        self.assertNotIn('browseId', posts[1].kwargs['json'])

    def test_network_failure_is_bounded_and_does_not_leak_credentials(self):
        session = self.session([requests.ConnectionError('https://user:secret@proxy.invalid')] * 3)
        with patch.object(it.requests, 'Session', return_value=session), patch.object(it.time, 'sleep'):
            with self.assertRaises(it.HistoryError) as error:
                with it.HistoryClient(self.state(), 'Europe/London'):
                    self.fail('bootstrap should fail')
        self.assertNotIn('secret', str(error.exception))
        self.assertEqual(session.request.call_count, 3)
        session.close.assert_called_once()

    def test_redirects_and_forbidden_responses_are_not_followed_or_retried(self):
        for status in (302, 401, 403):
            session = self.session([response(status=status)])
            with patch.object(it.requests, 'Session', return_value=session):
                with self.assertRaises(it.HistoryError):
                    with it.HistoryClient(self.state(), 'Europe/London'):
                        self.fail('bootstrap should fail')
            self.assertEqual(session.request.call_count, 1)

    def test_invalid_json_api_errors_and_lost_auth_are_not_empty_history(self):
        for result in (response(source='not json'), response({'error': {'message': 'private response'}}),
                       response({'responseContext': {'mainAppWebResponseContext': {'loggedOut': True}}}),
                       response({})):
            session = self.session([self.bootstrap(), result])
            with patch.object(it.requests, 'Session', return_value=session):
                with it.HistoryClient(self.state(), 'Europe/London') as client:
                    with self.assertRaises(it.HistoryError) as error:
                        client.browse()
            self.assertNotIn('private response', str(error.exception))

    def test_authorization_honors_cookie_path_and_expiry(self):
        state = self.state()
        state['cookies'][0]['path'] = '/unrelated'
        session = self.session([self.bootstrap()])
        with patch.object(it.requests, 'Session', return_value=session):
            with it.HistoryClient(state, 'Europe/London') as client:
                with self.assertRaises(it.HistoryError):
                    client.browse()
        self.assertEqual(session.request.call_count, 1)

    def test_only_selected_history_body_is_parsed(self):
        payload = page([section()], initial=True)
        payload['contents']['twoColumnBrowseResultsRenderer']['secondaryContents'] = section(identifier=OTHER)
        payload['header'] = continuation('unrelated-header')
        items = it.history_items(payload)
        self.assertEqual(list(yt.cards(items))[0][0], VIDEO)
        self.assertEqual(len(list(yt.cards(items))), 1)
        self.assertIsNone(it.continuation_token(items))

    def test_empty_recognized_feed_is_distinct_from_unrecognized_response(self):
        self.assertEqual(it.history_items(page([], initial=True)), [])
        for payload in ({}, {'onResponseReceivedActions': []}, {'contents': {}}):
            with self.assertRaises(it.HistoryError):
                it.history_items(payload)

    def test_malicious_malformed_and_ambiguous_continuations_are_rejected(self):
        for items in ([continuation(path='https://example.org/collect')],
                      [continuation(path='/youtubei/v1/feedback')],
                      [continuation('')], [continuation('a'), continuation('b')],
                      [{'continuationItemView': {}}], [{'continuationItemRenderer': None}]):
            with self.assertRaises(it.HistoryError):
                it.continuation_token(items)


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(yt, 'CACHE', Path(self.tmp.name)))
        self.stack.enter_context(patch.object(yt, 'remote_cache', return_value=None))
        self.stack.enter_context(patch.object(yt, 'session_state', return_value={'cookies': []}))
        clock = self.stack.enter_context(patch.object(yt, 'datetime', wraps=datetime))
        clock.now.return_value = datetime(2026, 11, 17, 12, tzinfo=ZoneInfo('Europe/London'))
        self.args = types.SimpleNamespace(since='2026-11-15', timezone='Europe/London', max_pages=100)

    def run_refresh(self, responses, fails=False):
        client = MagicMock()
        client.__enter__.return_value = client
        client.browse.side_effect = responses
        with patch.object(it, 'HistoryClient', return_value=client), contextlib.redirect_stdout(io.StringIO()):
            if fails:
                with self.assertRaisesRegex(ValueError, 'coverage incomplete'):
                    yt.refresh(self.args)
            else:
                yt.refresh(self.args)
        return client, yt.load_index()

    def test_explicit_continuations_and_cutoff_preserve_existing_transcripts(self):
        cached = {'video_id': VIDEO, 'title': 'old', 'watched_on': ['2026-11-01'],
                  'transcript': {'status': 'cached', 'path': f'transcripts/{VIDEO}.en.json'}}
        yt.atomic_json(yt.CACHE / 'history.json', {'metadata': {}, 'videos': [cached]})
        client, index = self.run_refresh([
            page([section(), continuation()], initial=True), page([section('Nov 14, 2026')])])
        self.assertEqual([c.args[0] for c in client.browse.call_args_list], [None, 'synthetic-next'])
        self.assertEqual(index['videos'][0]['watched_on'], ['2026-11-01', '2026-11-16'])
        self.assertEqual(index['videos'][0]['transcript'], cached['transcript'])
        self.assertTrue(index['metadata']['cloud_history']['range_complete'])
        self.assertEqual(index['metadata']['cloud_history']['termination_reason'], 'older_than_cutoff')

    def test_short_and_empty_feeds_finish_without_older_cutoff_section(self):
        for items in ([], [section()]):
            with self.subTest(empty=not items):
                _, index = self.run_refresh([page(items, initial=True)])
                self.assertTrue(index['metadata']['cloud_history']['range_complete'])
                self.assertEqual(index['metadata']['cloud_history']['termination_reason'], 'feed_exhausted')

    def test_page_cap_saves_last_received_page_as_incomplete(self):
        self.args.max_pages = 1
        _, index = self.run_refresh([page([section(), continuation()], initial=True)], fails=True)
        self.assertEqual(len(index['videos']), 1)
        self.assertFalse(index['metadata']['cloud_history']['range_complete'])
        self.assertEqual(index['metadata']['cloud_history']['termination_reason'], 'page_cap')

    def test_failed_continuation_retains_gathered_progress_and_safe_error(self):
        _, index = self.run_refresh([page([section(), continuation()], initial=True),
            it.HistoryError('YouTube history HTTP 403; access blocked')], fails=True)
        self.assertEqual(len(index['videos']), 1)
        self.assertEqual(index['metadata']['cloud_history']['pages_fetched'], 1)
        self.assertEqual(index['metadata']['cloud_history']['termination_reason'], 'request_failed')
        self.assertIn('HTTP 403', index['metadata']['cloud_history']['errors'][0])

    def test_repeated_tokens_stop_incomplete_instead_of_looping(self):
        client, index = self.run_refresh([
            page([section(), continuation()], initial=True), page([section(), continuation()])], fails=True)
        self.assertEqual(client.browse.call_count, 2)
        self.assertEqual(index['metadata']['cloud_history']['termination_reason'], 'repeated_continuation')

    def test_unknown_dates_cards_and_feed_messages_cannot_be_complete(self):
        unknown_card = section()
        unknown_card['itemSectionRenderer']['contents'] = [{'futureVideoRenderer': {'videoId': OTHER}}]
        for items in ([section('unknown day')], [unknown_card], [{'messageRenderer': {'text': {'simpleText': 'Try again'}}}]):
            with self.subTest(items=items):
                _, index = self.run_refresh([page(items, initial=True)], fails=True)
                self.assertFalse(index['metadata']['cloud_history']['range_complete'])
                self.assertTrue(index['metadata']['cloud_history']['unparsed_headings'])

    def test_bad_endpoint_saves_current_page_without_publishing_token(self):
        _, index = self.run_refresh([page([section(), continuation('private-token', '/bad')], initial=True)], fails=True)
        self.assertEqual(len(index['videos']), 1)
        self.assertNotIn('private-token', json.dumps(index))

    def test_incremental_refresh_overlaps_prior_success_date(self):
        self.args.since = None
        yt.atomic_json(yt.CACHE / 'history.json', {'videos': [], 'metadata': {'cloud_history': {
            'range_complete': True, 'timezone': 'Europe/London', 'coverage_end_date': '2026-11-16'}}})
        _, index = self.run_refresh([page([], initial=True)])
        self.assertEqual(index['metadata']['cloud_history']['coverage_start_date'], '2026-11-16')


if __name__ == '__main__':
    unittest.main()
