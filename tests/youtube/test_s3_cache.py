import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/youtube'))
from s3_cache import S3Cache, merge_indexes
spec = importlib.util.spec_from_file_location('yt_s3_test', ROOT / 'tools/youtube/youtube.py')
yt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(yt)
VIDEO = 'abcDEF123_-'


class Error(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code}}


class FakeS3:
    def __init__(self):
        self.objects, self.calls, self.serial = {}, [], 0
        self.conflict_once = None
    def get_object(self, Bucket, Key):
        self.calls.append(('get', Key))
        if Key not in self.objects:
            raise Error('NoSuchKey')
        body, etag = self.objects[Key]
        return {'Body': io.BytesIO(body), 'ETag': etag}
    def put_object(self, Bucket, Key, Body, **kwargs):
        self.calls.append(('put', Key))
        if self.conflict_once and Key.endswith('history.json'):
            concurrent = self.conflict_once
            self.conflict_once = None
            self.serial += 1
            self.objects[Key] = (S3Cache.body(concurrent), str(self.serial))
            raise Error('PreconditionFailed')
        if kwargs.get('IfNoneMatch') == '*' and Key in self.objects:
            raise Error('PreconditionFailed')
        if 'IfMatch' in kwargs and kwargs['IfMatch'] != self.objects.get(Key, (None, None))[1]:
            raise Error('PreconditionFailed')
        self.serial += 1
        self.objects[Key] = (Body, str(self.serial))
        return {'ETag': str(self.serial)}


def sample():
    return {'metadata': {}, 'videos': [{'video_id': VIDEO, 'title': 'Synthetic', 'url': 'https://www.youtube.com/watch?v=' + VIDEO,
        'watched_on': ['2026-11-15'], 'transcript': {'status': 'cached', 'path': f'transcripts/{VIDEO}.en.json', 'retrieved_at': '2026-11-16'}}]}


def data():
    return {'video_id': VIDEO, 'language': 'en', 'caption_type': 'manual', 'audio_verified': False,
        'segments': [{'text': 'put aside the draft', 'start': 2.0}]}


class S3Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.client = FakeS3()
        self.s3 = S3Cache('private-test-bucket', self.client)
        self.index = sample()
        yt.atomic_json(self.root / self.index['videos'][0]['transcript']['path'], data())

    def test_upload_only_allowlisted_objects_and_manifest_last(self):
        yt.atomic_json(self.root / 'auth/storage-state.json', {'cookies': ['SENSITIVE']})
        yt.atomic_json(self.root / 'other.json', {'private': 'not-a-transcript'})
        self.s3.save(self.index, self.root, yt.valid_transcript)
        puts = [key for action, key in self.client.calls if action == 'put']
        self.assertEqual(len(puts), 2)
        self.assertTrue(puts[0].startswith('cache/v1/transcripts/'))
        self.assertEqual(puts[1], 'cache/v1/history.json')
        self.assertFalse(any(b'SENSITIVE' in body for body, _ in self.client.objects.values()))

    def test_new_task_restores_and_searches_without_caption_api(self):
        self.s3.save(self.index, self.root, yt.valid_transcript)
        with tempfile.TemporaryDirectory() as destination:
            with patch.object(yt, 'CACHE', Path(destination)), patch.object(yt, 'REMOTE_CACHE', S3Cache('private-test-bucket', self.client)):
                restored = yt.load_index()
                self.assertFalse(list(Path(destination).glob('transcripts/*')))
                with patch.dict('sys.modules', {'youtube_transcript_api': None}):
                    fetched = yt.fetch(restored['videos'][0], restored)
                self.assertEqual(fetched, data())
                self.assertEqual(len(list(yt.matches(fetched, 'put aside'))), 1)

    def test_conditional_manifest_retry_preserves_concurrent_watches(self):
        other = copy.deepcopy(self.index)
        other['videos'][0]['watched_on'] = ['2026-11-14']
        other['videos'][0]['transcript'] = {'status': 'unchecked'}
        self.client.conflict_once = other
        saved = self.s3.save(self.index, self.root, yt.valid_transcript)
        self.assertEqual(saved['videos'][0]['watched_on'], ['2026-11-14', '2026-11-15'])
        self.assertEqual(saved['videos'][0]['transcript']['status'], 'cached')

    def test_cached_beats_temporary_failure(self):
        other = sample()
        other['videos'][0]['transcript'] = {'status': 'retry_needed', 'attempted_at': '2027'}
        self.assertEqual(merge_indexes(self.index, other)['videos'][0]['transcript']['status'], 'cached')

    def test_metadata_does_not_invent_coverage(self):
        first = {'metadata': {'cloud_history': {'updated_at': '2026-11-14', 'range_complete': True}}, 'videos': []}
        second = {'metadata': {'cloud_history': {'updated_at': '2026-11-16', 'range_complete': False}}, 'videos': []}
        self.assertFalse(merge_indexes(first, second)['metadata']['cloud_history']['range_complete'])

    def test_path_traversal_and_auth_upload_rejected(self):
        for path in ('auth/storage-state.json', '../secrets.json', 'transcripts/../../../secret.json'):
            self.index['videos'][0]['transcript']['path'] = path
            with self.assertRaises(ValueError):
                self.s3.save(self.index, self.root, yt.valid_transcript)
        self.assertFalse(self.client.objects)

    def test_content_hash_checked_before_download(self):
        self.s3.save(self.index, self.root, yt.valid_transcript)
        video = self.index['videos'][0]
        key = video['transcript']['s3_key']
        self.client.objects[key] = (b'{"unexpected":"data"}', 'bad')
        with self.assertRaises(ValueError):
            self.s3.download(video, self.root, yt.valid_transcript, yt.atomic_json)

    def test_repeat_upload_skips_unchanged_transcript(self):
        self.s3.save(self.index, self.root, yt.valid_transcript)
        self.s3.save(self.index, self.root, yt.valid_transcript)
        puts = [key for action, key in self.client.calls if action == 'put' and '/transcripts/' in key]
        self.assertEqual(len(puts), 1)

    def test_s3_access_errors_preserve_local_progress(self):
        with patch.object(yt, 'CACHE', self.root), patch.object(yt, 'REMOTE_CACHE', self.s3):
            with patch.object(self.client, 'get_object', side_effect=Error('AccessDenied')):
                with self.assertRaises(Error):
                    yt.save_index(self.index)
            self.assertEqual(json.loads((self.root / 'history.json').read_text())['videos'][0]['video_id'], VIDEO)


if __name__ == '__main__':
    unittest.main()
