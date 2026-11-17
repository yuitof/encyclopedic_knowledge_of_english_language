"""Synthetic fixtures only: never copy account data, real posts, or sessions here."""
import copy
import gzip
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/x'))
from api import Client, XError, chunk_urls, operations
from cache import Cache, atomic_json, body, empty_index, merge_indexes, validate_index
from posts import embedded_posts, normalize, post_id, timeline
from s3_cache import S3Cache

spec = importlib.util.spec_from_file_location('x_cli', Path(__file__).resolve().parents[2] / 'tools/x/x.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
STAMP = '2026-01-01T00:00:00+00:00'


def tweet(identifier='123', text='A synthetic sentence.', quoted=None):
    result = {'__typename': 'Tweet', 'rest_id': identifier,
              'legacy': {'full_text': text, 'lang': 'en', 'entities': {}, 'created_at': STAMP},
              'core': {'user_results': {'result': {'rest_id': '42', 'core': {'screen_name': 'fixture', 'name': 'Fixture'}}}}}
    if quoted:
        result['quoted_status_result'] = {'result': quoted}
        result['legacy']['quoted_status_id_str'] = quoted['rest_id']
    return result


def page(tweets=(), cursor=None):
    entries = [{'entryId': 'tweet-' + t['rest_id'], 'content': {'itemContent': {'itemType': 'TimelineTweet',
                'tweet_results': {'result': t}}}} for t in tweets]
    if cursor:
        entries.append({'entryId': 'cursor-bottom', 'content': {'cursorType': 'Bottom', 'value': cursor}})
    return {'timeline': {'instructions': [{'type': 'TimelineAddEntries', 'entries': entries}]}}


class S3Error(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code}}


class FakeS3:
    def __init__(self):
        self.objects, self.writes, self.version = {}, [], 0
        self.encodings = {}
        self.fail_posts, self.conflict = False, None

    def get_object(self, Bucket, Key):
        data, etag = self.objects[Key]
        return {'Body': io.BytesIO(data), 'ETag': etag, 'ContentEncoding': self.encodings.get(Key)}

    def put_object(self, Bucket, Key, Body, **kw):
        if self.fail_posts and '/posts/' in Key:
            raise S3Error('AccessDenied')
        if kw.get('IfNoneMatch') == '*' and Key in self.objects:
            raise S3Error('PreconditionFailed')
        if self.conflict and kw.get('IfMatch'):
            other = self.conflict
            self.conflict = None
            self.version += 1
            self.objects[Key] = (body(other), str(self.version))
            self.encodings[Key] = None
            raise S3Error('PreconditionFailed')
        if kw.get('IfMatch') and self.objects[Key][1] != kw['IfMatch']:
            raise S3Error('PreconditionFailed')
        self.version += 1
        self.objects[Key] = (Body, str(self.version))
        self.encodings[Key] = kw.get('ContentEncoding')
        self.writes.append(Key)
        return {'ETag': str(self.version)}


class PostTests(unittest.TestCase):
    def test_long_post_quotes_and_html(self):
        value = tweet(quoted=tweet('456', 'Quoted text.'))
        value['note_tweet'] = {'note_tweet_results': {'result': {'text': 'Full &amp; untruncated text.', 'entity_set': {'urls': []}}}}
        value = {'__typename': 'TweetWithVisibilityResults', 'tweet': value}
        post = normalize(value, STAMP)
        self.assertEqual(post['text'], 'Full & untruncated text.')
        self.assertEqual(post['text_source'], 'note_tweet')
        result = timeline(page([value['tweet']], 'next'), STAMP)
        self.assertEqual(result['members'], ['123'])
        self.assertEqual(set(result['posts']), {'123', '456'})
        self.assertEqual(result['cursor'], 'next')

    def test_promoted_tweet_excluded(self):
        data = page([tweet()])
        data['timeline']['instructions'][0]['entries'][0]['content']['promotedMetadata'] = {'ad': True}
        self.assertFalse(timeline(data, STAMP)['posts'])

    def test_missing_timeline_is_not_empty(self):
        with self.assertRaises(XError):
            timeline({'user': {'result': {'__typename': 'UserUnavailable'}}}, STAMP)
        self.assertEqual(timeline(page(), STAMP)['members'], [])
        self.assertTrue(timeline(page(cursor='same'), STAMP)['cursor_only'])
        self.assertFalse(timeline(page([tweet()], 'same'), STAMP)['cursor_only'])
        with self.assertRaises(XError):
            timeline({'timeline': {'instructions': [{'type': 'UnknownSchema'}]}}, STAMP)

    def test_module_and_replacement_cursor(self):
        data = {'timeline': {'instructions': [
            {'type': 'TimelineAddToModule', 'moduleItems': [{'item': {'itemContent': {'itemType': 'TimelineTweet', 'tweet_results': {'result': tweet()}}}}]},
            {'type': 'TimelineReplaceEntry', 'entry': {'content': {'cursorType': 'Bottom', 'value': 'next'}}}]}}
        parsed = timeline(data, STAMP)
        self.assertEqual(parsed['members'], ['123'])
        self.assertEqual(parsed['cursor'], 'next')

    def test_post_url_validation(self):
        self.assertEqual(post_id('https://x.com/fixture/status/123?s=20'), '123')
        for value in ('../auth', 'https://evil.example/status/123', '0', '123/../'):
            with self.assertRaises(ValueError):
                post_id(value)


class DiscoveryTests(unittest.TestCase):
    def test_only_queries_and_allowlisted_operations(self):
        source = 'queryId:"fresh-id",operationName:"Likes",operationType:"query",metadata:{featureSwitches:["enabled"],fieldToggles:[]}'
        source += 'queryId:"bad",operationName:"CreateTweet",operationType:"mutation",metadata:{featureSwitches:[],fieldToggles:[]}'
        self.assertEqual(operations(source)['Likes']['query_id'], 'fresh-id')
        self.assertNotIn('CreateTweet', operations(source))
        client = object.__new__(Client)
        with self.assertRaises(XError):
            client.query('CreateTweet', {})

    def test_chunk_name_hash_pairing(self):
        urls = chunk_urls('x={1:"bundle.Bookmarks",2:"ondemand.s",3:"bundle.Unrelated"};y={1:"abcdef12",2:"1234abcd",3:"abcd1234"}')
        self.assertEqual(len(urls), 2)
        self.assertTrue(any('/bundle.Bookmarks.abcdef12a.js' in u for u in urls))

    def test_error_does_not_expose_response_or_become_empty(self):
        client = object.__new__(Client)
        client.bootstrap = lambda: None
        client.ops = {'Likes': {'query_id': 'new', 'switches': [], 'toggles': []}}
        client.headers, client.features = {}, {}
        client.transaction = type('Transaction', (), {'generate_transaction_id': lambda *a, **k: 'fixture'})()
        response = type('Response', (), {'json': lambda s: {'errors': [{'code': 32, 'message': 'private response'}]}})()
        client.get = lambda *a, **kw: response
        with self.assertRaisesRegex(XError, r'\[32\]') as error:
            client.query('Likes', {})
        self.assertNotIn('private response', str(error.exception))


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_corruption_is_retryable_and_accounts_isolated(self):
        cache = Cache(self.root, '42')
        cache.put(normalize(tweet(), STAMP))
        self.assertEqual(cache.get('123')['text'], 'A synthetic sentence.')
        self.assertIsNone(Cache(self.root, '43').get('123'))
        (cache.root / 'posts/123.json').write_text('{broken')
        self.assertIsNone(cache.get('123'))
        self.assertEqual(cache.index['posts']['123']['status'], 'retry_needed')
        with self.assertRaises(ValueError):
            Cache(self.root, '../auth')
        with self.assertRaises(ValueError):
            cache.get('../auth')

    def test_orphan_post_write_is_recovered_without_x(self):
        cache = Cache(self.root, '42')
        atomic_json(cache.root / 'posts/123.json', normalize(tweet(), STAMP))
        self.assertEqual(cache.get('123')['id'], '123')
        recovered = Cache(self.root, '42')
        self.assertEqual(recovered.index['posts']['123']['status'], 'cached')

    def test_cache_get_and_search_never_initialize_x_client(self):
        cache = Cache(self.root, '42')
        cache.put(normalize(tweet(), STAMP))
        atomic_json(self.root / 'account.json', {'id': '42'})
        args = type('Args', (), {'account': None, 'offline': True, 'post': '123', 'refresh': False})()
        with patch.object(cli, 'CACHE', self.root), patch.object(cli, 'Client', side_effect=AssertionError('Network forbidden')), patch.object(cli, 'emit') as emit:
            cli.get_post(args)
            self.assertEqual(emit.call_args.args[0]['id'], '123')
            args.phrase, args.collection, args.latest, args.coverage = 'SYNTHETIC   sentence', None, False, False
            cli.search(args)
            self.assertEqual(len(emit.call_args.args[0]['matches']), 1)

    def test_union_archive_does_not_invent_completed_coverage(self):
        a, b = empty_index('42'), empty_index('42')
        a['collections']['likes'] = {'post_ids': ['123'], 'latest_post_ids': ['123'], 'last_completed_at': '2026-01-01',
                                    'scan': {'updated_at': '2026-01-01', 'status': 'reachable_end'}}
        b['collections']['likes'] = {'post_ids': ['456'], 'scan': {'updated_at': '2026-02-01', 'status': 'partial', 'cursor': 'next'}}
        merged = merge_indexes(a, b)['collections']['likes']
        self.assertEqual(set(merged['post_ids']), {'123', '456'})
        self.assertEqual(merged['latest_post_ids'], ['123'])
        self.assertEqual(merged['scan']['status'], 'partial')
        with self.assertRaises(ValueError):
            merge_indexes(a, empty_index('43'))

    def test_merge_reuses_remote_reference_for_identical_source(self):
        cache = Cache(self.root, '42')
        cache.put(normalize(tweet(), STAMP))
        local = copy.deepcopy(cache.index)
        state = cache.index['posts']['123']
        state['s3_key'] = f'cache/x/v1/accounts/42/posts/123.{state["sha256"]}.json'
        merged = merge_indexes(cache.index, local)
        self.assertEqual(merged['posts']['123']['s3_key'], state['s3_key'])

    def test_s3_upload_order_restore_integrity_and_auth_exclusion(self):
        fake = FakeS3()
        remote = S3Cache('fixture-cache', fake)
        cache = Cache(self.root, '42', remote)
        cache.put(normalize(tweet(), STAMP))
        (self.root / 'auth').mkdir()
        (self.root / 'auth/storage-state.json').write_text('{"cookies":"PRIVATE"}')
        cache.save()
        self.assertIn('/posts/', fake.writes[-2])
        self.assertTrue(fake.writes[-1].endswith('/index.json'))
        fresh = Cache(self.root / 'fresh', '42', remote)
        self.assertFalse((fresh.root / 'posts/123.json').exists())
        self.assertEqual(fresh.get('123')['text'], 'A synthetic sentence.')
        self.assertTrue(all(b'PRIVATE' not in content for content, etag in fake.objects.values()))
        key = fresh.index['posts']['123']['s3_key']
        fake.objects[key] = (b'{}', 'corrupt')
        (fresh.root / 'posts/123.json').unlink()
        with self.assertRaises(ValueError):
            fresh.get('123')

    def test_s3_failure_retains_local_post_and_never_publishes_reference(self):
        fake = FakeS3()
        cache = Cache(self.root, '42', S3Cache('fixture-cache', fake))
        cache.put(normalize(tweet(), STAMP))
        fake.fail_posts = True
        with self.assertRaises(S3Error):
            cache.save()
        self.assertEqual(Cache(self.root, '42').get('123')['id'], '123')
        self.assertNotIn('s3_key', cache.index['posts']['123'])
        manifest = json.loads(gzip.decompress(fake.objects['cache/x/v1/accounts/42/index.json'][0]))
        self.assertFalse(manifest['posts'])

    def test_conditional_manifest_conflict_merges_other_task(self):
        fake = FakeS3()
        cache = Cache(self.root, '42', S3Cache('fixture-cache', fake))
        cache.put(normalize(tweet(), STAMP))
        other = empty_index('42')
        other['collections']['likes'] = {'post_ids': ['456']}
        fake.conflict = other
        cache.save()
        self.assertEqual(cache.index['collections']['likes']['post_ids'], ['456'])
        self.assertEqual(cache.index['posts']['123']['status'], 'cached')

    def test_index_refuses_credentials_and_unsafe_references(self):
        index = empty_index('42')
        index['cookies'] = 'PRIVATE'
        with self.assertRaises(ValueError):
            validate_index(index, '42')
        index.pop('cookies')
        index['posts']['123'] = {'status': 'cached', 's3_key': 'auth/storage-state.json'}
        with self.assertRaises(ValueError):
            validate_index(index, '42')

    def test_folder_pagination_matches_flat_website_variables(self):
        calls = []
        class FakeClient:
            def query(self, operation, variables):
                calls.append((operation, variables))
                data = {'items': [{'id': '55', 'name': 'Fixture folder'}], 'slice_info': {'next_cursor': 'next'}} if len(calls) == 1 else {'items': [], 'slice_info': {}}
                return {'viewer': {'user_results': {'result': {'bookmark_collections_slice': data}}}}
        args = type('Args', (), {'account': None, 'offline': False, 'refresh': True})()
        with patch.object(cli, 'CACHE', self.root), patch.object(cli, 'remote', return_value=None), patch.object(cli, 'authenticated', return_value=(FakeClient(), {'id': '42'})), patch.object(cli, 'emit'), patch.object(cli.time, 'sleep'):
            cli.folders(args)
        self.assertEqual(calls, [('BookmarkFoldersSlice', {}), ('BookmarkFoldersSlice', {'cursor': 'next'})])
        self.assertEqual(Cache(self.root, '42').index['folders']['55']['name'], 'Fixture folder')

    def test_terminal_cursor_only_page_completes_but_repeated_content_is_partial(self):
        for empty, expected in ((True, 'reachable_end'), (False, 'partial')):
            with self.subTest(empty=empty):
                cache = Cache(self.root, '42')
                cache.index['collections']['likes'] = {'post_ids': [], 'scan': {'status': 'partial', 'cursor': 'same', 'reason': 'requested_page_limit', 'pages': 1, 'post_ids': [], 'unavailable_ids': []}}
                cache.save()
                class FakeClient:
                    def page(self, *args):
                        return page([] if empty else [tweet()], 'advancing-empty-cursor' if empty else 'same')
                args = type('Args', (), {'account': None, 'offline': False, 'collections': ['likes'], 'folder': None, 'max_pages': None, 'delay': 0, 'resume': True})()
                with patch.object(cli, 'CACHE', self.root), patch.object(cli, 'remote', return_value=None), patch.object(cli, 'authenticated', return_value=(FakeClient(), {'id': '42'})), patch.object(cli, 'emit'):
                    cli.refresh(args)
                recovered = Cache(self.root, '42')
                self.assertEqual(recovered.index['collections']['likes']['scan']['status'], expected)

    def test_resume_continues_after_page_limit_and_checkpoint_survives_error(self):
        cache = Cache(self.root, '42')
        cache.index['collections']['likes'] = {'post_ids': [], 'scan': {'status': 'partial', 'cursor': 'old', 'reason': 'requested_page_limit', 'pages': 1, 'post_ids': [], 'unavailable_ids': []}}
        cache.save()
        responses = iter([page([tweet()], 'next'), XError('rate limit')])
        class FakeClient:
            def page(self, *args):
                result = next(responses)
                if isinstance(result, Exception):
                    raise result
                return result
        args = type('Args', (), {'account': None, 'offline': False, 'collections': ['likes'], 'folder': None, 'max_pages': None, 'delay': 0, 'resume': True})()
        with patch.object(cli, 'CACHE', self.root), patch.object(cli, 'remote', return_value=None), patch.object(cli, 'authenticated', return_value=(FakeClient(), {'id': '42'})), patch.object(cli, 'emit'):
            self.assertEqual(cli.refresh(args), 1)
        recovered = Cache(self.root, '42')
        scan = recovered.index['collections']['likes']['scan']
        self.assertEqual(scan['pages'], 2)
        self.assertEqual(scan['cursor'], 'next')
        self.assertEqual(scan['reason'], 'rate limit')
        self.assertIsNotNone(recovered.get('123'))


if __name__ == '__main__':
    unittest.main()
