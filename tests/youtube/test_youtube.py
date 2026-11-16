"""Synthetic fixtures only: never access a real user's history or network."""
import contextlib
from datetime import date
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('vault_youtube', ROOT / 'tools/youtube/youtube.py')
yt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(yt)
VIDEO = 'abcDEF123_-'


def transcript():
    return {'video_id': VIDEO, 'language': 'en', 'caption_type': 'manual',
            'retrieved_at': '2026-11-16T00:00:00+00:00', 'source_url': 'https://www.youtube.com/watch?v=' + VIDEO,
            'segments': [{'start': 2.0, 'text': 'Please put'}, {'start': 3.0, 'text': 'aside the draft.'}],
            'audio_verified': False}


def entry():
    return {'video_id': VIDEO, 'title': 'Synthetic title', 'url': 'https://www.youtube.com/watch?v=' + VIDEO,
            'watched_on': ['2026-11-15'], 'transcript': {'status': 'unchecked'}}


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache_patch = patch.object(yt, 'CACHE', Path(self.tmp.name))
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)

    def cached(self):
        video = entry()
        video['transcript'] = {'status': 'cached', 'path': f'transcripts/{VIDEO}.en.json'}
        yt.atomic_json(yt.CACHE / video['transcript']['path'], transcript())
        return video

    def test_date_headings_and_year_boundary(self):
        today = date(2026, 1, 2)
        self.assertEqual(yt.heading_date('Yesterday', today), date(2026, 1, 1))
        self.assertEqual(yt.heading_date('Dec 31', today), date(2025, 12, 31))
        self.assertEqual(yt.heading_date('Friday', today), date(2025, 12, 26))
        self.assertIsNone(yt.heading_date('Unrecognized date', today))

    def test_history_continuation_and_shorts(self):
        payload = {'onResponseReceivedActions': [{'appendContinuationItemsAction': {'continuationItems': [
            {'itemSectionRenderer': {'header': {'itemSectionHeaderRenderer': {'title': {'simpleText': 'Yesterday'}}},
                'contents': [
                    {'videoRenderer': {'videoId': VIDEO, 'title': {'runs': [{'text': 'Synthetic title'}]}, 'ownerText': {'simpleText': 'Synthetic channel'}}},
                    {'shortsLockupViewModel': {'onTap': {'innertubeCommand': {'reelWatchEndpoint': {'videoId': VIDEO}}}, 'overlayMetadata': {'primaryText': {'content': 'Synthetic short'}}}},
                ]}}
        ]}}]}
        found = list(yt.sections(payload))
        self.assertEqual(found[0][0], 'Yesterday')
        self.assertEqual(list(yt.cards(found[0][1])), [(VIDEO, 'Synthetic title', 'Synthetic channel'), (VIDEO, 'Synthetic short', '')])

    def test_modern_history_card(self):
        card = {'lockupViewModel': {'contentId': VIDEO, 'metadata': {'lockupMetadataViewModel': {
            'title': {'content': 'Modern title'}, 'metadata': {'contentMetadataViewModel': {'metadataRows': [
                {'lockupContentMetadataRowExtension': {'contentType': 'METADATA_ROW_CONTENT_TYPE_BYLINE'},
                 'metadataParts': [{'text': {'content': 'Modern channel'}}]}
            ]}}}}}}
        self.assertEqual(list(yt.cards(card)), [(VIDEO, 'Modern title', 'Modern channel')])

    def test_incremental_merge_preserves_transcript_and_watches(self):
        video = self.cached()
        index = {'metadata': {}, 'videos': [video]}
        yt.merge_observations(index, [{'video_id': VIDEO, 'title': 'Updated title', 'watched_on': '2026-11-16'}] * 2)
        self.assertEqual(len(index['videos']), 1)
        self.assertEqual(video['watched_on'], ['2026-11-15', '2026-11-16'])
        self.assertEqual(video['transcript']['status'], 'cached')
        self.assertEqual(video['title'], 'Updated title')

    def test_cross_segment_matches_and_word_boundaries(self):
        hits = list(yt.matches(transcript(), 'put aside'))
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]['start'], 2.0)
        self.assertEqual(len(hits[0]['context_segments']), 2)
        self.assertEqual(list(yt.matches(transcript(), 'side')), [])
        self.assertEqual(list(yt.matches(transcript(), 'put asides')), [])

    def test_cached_fetch_does_not_import_or_call_api(self):
        video = self.cached()
        # API module unavailable: a cache hit must still succeed.
        with patch.dict('sys.modules', {'youtube_transcript_api': None}):
            result = yt.fetch(video, {'videos': [video], 'metadata': {}})
        self.assertEqual(result['video_id'], VIDEO)

    def test_corrupt_cache_is_retryable(self):
        video = self.cached()
        (yt.CACHE / video['transcript']['path']).write_text('{broken')
        self.assertIsNone(yt.read_transcript(video))
        self.assertEqual(video['transcript']['status'], 'retry_needed')

    def test_path_traversal_rejected(self):
        video = entry()
        video['transcript'] = {'status': 'cached', 'path': '../outside.json'}
        self.assertIsNone(yt.read_transcript(video))
        self.assertEqual(video['transcript']['status'], 'retry_needed')

    def test_fetch_skips_unavailable_and_temporary_failures(self):
        for status in ('unavailable', 'retry_needed'):
            video = entry()
            video['transcript'] = {'status': status}
            with patch.dict('sys.modules', {'youtube_transcript_api': None}):
                self.assertIsNone(yt.fetch(video, {'videos': [video], 'metadata': {}}))
        video['transcript'] = {'status': 'unavailable'}
        self.assertIsNone(yt.fetch(video, {}, retry=True))

    def test_invalid_data_does_not_count_as_cached(self):
        for bad in ({}, transcript() | {'video_id': 'wrong'}, transcript() | {'segments': []},
                    transcript() | {'segments': [{'start': float('nan'), 'text': 'bad'}]}):
            self.assertFalse(yt.valid_transcript(bad, VIDEO))

    def test_atomic_json_private_permissions_and_readback(self):
        path = yt.CACHE / 'transcripts/sample.json'
        yt.atomic_json(path, transcript())
        self.assertEqual(json.loads(path.read_text()), transcript())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(list(path.parent.iterdir())), 1)

    def test_no_browser_visits_conflated_with_account_dates(self):
        video = entry()
        local_only = entry() | {'watched_on': [], 'watched_at': ['2026-11-15T10:00:00Z']}
        self.assertEqual(list(yt.selected({'videos': [video, local_only]}, '2026-11-15')), [video])

    def test_session_filters_non_youtube_cookies_and_local_storage(self):
        state = {'cookies': [{'name': 'session', 'domain': '.youtube.com'}, {'name': 'other', 'domain': '.google.com'}],
                 'origins': [{'origin': 'https://www.google.com', 'localStorage': []}]}
        with patch.dict('os.environ', {'YOUTUBE_STORAGE_STATE_JSON': json.dumps(state)}):
            filtered = yt.session_state()
        self.assertEqual(len(filtered['cookies']), 1)
        self.assertEqual(filtered['origins'], [])

    def test_fetched_file_precedes_cached_index(self):
        data = transcript()
        fetched = types.SimpleNamespace(language_code='en', is_generated=False, to_raw_data=lambda: data['segments'])
        track = types.SimpleNamespace(language_code='en', is_generated=False, fetch=lambda: fetched)
        class Api:
            def __init__(self, **kwargs):
                pass
            def list(self, identifier):
                return [track]
        class Missing(Exception):
            pass
        modules = {
            'youtube_transcript_api': types.SimpleNamespace(YouTubeTranscriptApi=Api),
            'youtube_transcript_api._errors': types.SimpleNamespace(NoTranscriptFound=Missing, TranscriptsDisabled=Missing, VideoUnavailable=Missing),
            'youtube_transcript_api.proxies': types.SimpleNamespace(GenericProxyConfig=object),
        }
        video = entry()
        index = {'videos': [video], 'metadata': {}}
        original = yt.atomic_json
        def record(path, value):
            if path.name == 'history.json' and video['transcript']['status'] == 'cached':
                self.assertTrue((yt.CACHE / video['transcript']['path']).exists())
            original(path, value)
        with patch.dict('sys.modules', modules), patch.object(yt, 'atomic_json', side_effect=record):
            self.assertIsNotNone(yt.fetch(video, index))
        self.assertEqual(yt.load_index()['videos'][0]['transcript']['status'], 'cached')

    def test_search_reuses_cache_and_returns_summary(self):
        video = self.cached()
        yt.atomic_json(yt.CACHE / 'history.json', {'videos': [video], 'metadata': {}})
        args = types.SimpleNamespace(timezone='Europe/London', day='2026-11-15', phrase='put aside', fetch=True, retry=False)
        output = io.StringIO()
        with patch.dict('sys.modules', {'youtube_transcript_api': None}), contextlib.redirect_stdout(output):
            yt.search(args)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(lines[-1]['summary']['matches'], 1)
        self.assertIn('&t=2', lines[0]['url'])


if __name__ == '__main__':
    unittest.main()
