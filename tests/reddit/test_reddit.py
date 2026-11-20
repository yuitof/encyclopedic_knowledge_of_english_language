"""Synthetic Reddit responses, cookies and S3 only."""
import contextlib
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import Mock, patch

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/reddit'))
sys.path.insert(0, str(ROOT / 'tools'))
from api import Client
from browser import BrowserClient
from auth import state, login
from cache import Cache, atomic_json, body, empty_index, merge_indexes
from direct import DirectClient, USER_AGENT
from pages import RedditError, Unavailable, document, json_listing, listing, source, source_url, valid_post
from s3_cache import S3Cache
from cloud_bridge import client as bridge, probe
from cloud_bridge.transport import BridgeError
from cloud_bridge import transport
from cloud_bridge.workers import RelayResponse
from workers import WorkersRelayClient

spec = importlib.util.spec_from_file_location('reddit_cli', ROOT / 'tools/reddit/reddit.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
STAMP = '2026-01-01T00:00:00+00:00'
PROXY = 'http://127.0.0.1:12345'
URL = 'https://old.reddit.com/r/fixture/comments/abc/example/'
COOKIE = {'name': 'reddit_session', 'value': 'synthetic', 'domain': '.reddit.com', 'path': '/', 'expires': -1}


def header(user='fixture'):
    return f'<div id="header-bottom-right"><span class="user"><a href="https://old.reddit.com/user/{user}/">{user}</a></span></div>'


def thing(identifier='t3_abc', sentence='A synthetic full sentence.', children=''):
    comment = identifier.startswith('t1_')
    url = URL + (identifier[3:] + '/' if comment else '')
    title = '' if comment else '<a class="title" href="https://example.org/">Synthetic title</a>'
    return f'''<div class="thing {'comment' if comment else 'link self'}" data-fullname="{identifier}">
      <div class="entry">{title}<a class="author">writer</a><a class="subreddit">r/fixture</a>
      <time datetime="{STAMP}"></time><div class="usertext-body"><div class="md"><p>{sentence}</p></div></div>
      <a class="{'bylink' if comment else 'comments'}" href="{url}">permalink</a></div><div class="child">{children}</div></div>'''


def page(items='', cursor=None, empty=False):
    more = f'<span class="next-button"><a rel="next" href="/user/fixture/saved/?after={cursor}">next</a></span>' if cursor else ''
    tabs = '<ul class="tabmenu"><li class="selected"><a href="/user/fixture/saved/">saved</a></li></ul>'
    return header() + tabs + '<div class="content" role="main"><div id="siteTable" class="sitetable">' + items + more + ('<p id="noresults">empty</p>' if empty else '') + '</div></div>'


def post(identifier='t3_abc'):
    return source(header() + thing(identifier), identifier, STAMP, 'fixture')


def json_page(cursor=None):
    return {'kind': 'Listing', 'data': {'after': cursor, 'modhash': 'listing-marker', 'children': [
        {'kind': 't3', 'data': {'name': 't3_abc', 'permalink': URL}},
        {'kind': 't1', 'data': {'name': 't1_def', 'permalink': URL + 'def/'}},
    ]}}


class PageTests(unittest.TestCase):
    def test_posts_and_saved_comments_keep_full_bodies(self):
        parsed = listing(page(thing() + thing('t1_def'), 't1_def'), 'fixture', 'saved')
        self.assertEqual(list(parsed['members']), ['t3_abc', 't1_def'])
        self.assertEqual(parsed['cursor'], 't1_def')
        self.assertEqual(post()['text'], 'A synthetic full sentence.')
        self.assertTrue(valid_post(post('t1_def'), 't1_def'))

    def test_nested_comments_do_not_supply_parent_author_body_or_membership(self):
        markup = header() + thing('t1_def', 'Parent <em>exact</em> &amp; complete.', thing('t1_ghi', 'Child body.'))
        self.assertEqual(source(markup, 't1_def', STAMP, 'fixture')['text'], 'Parent exact & complete.')
        parsed = listing(page(thing('t1_def', children=thing('t1_ghi'))), 'fixture', 'saved')
        self.assertEqual(list(parsed['members']), ['t1_def'])
        bad = markup.replace('<p>Parent <em>exact</em> &amp; complete.</p>', '').replace('<div class="usertext-body"><div class="md"></div></div>', '')
        with self.assertRaises(RedditError):
            source(bad, 't1_def', STAMP, 'fixture')

    def test_verified_empty_and_legacy_next_link(self):
        self.assertEqual(listing(page(empty=True), 'fixture', 'saved')['members'], {})
        markup = page(thing(), 't3_abc').replace('class="next-button"', 'class="nextprev"')
        self.assertEqual(listing(markup, 'fixture', 'saved')['cursor'], 't3_abc')
        for bad in (page(), header() + '<p>challenge</p>', page(empty=True).replace('id="noresults"', 'id="unknown"')):
            with self.subTest(bad=bad), self.assertRaises(RedditError):
                listing(bad, 'fixture', 'saved')

    def test_login_challenge_and_wrong_account_are_not_empty(self):
        for markup in ('<html>Log in</html>', header('someone_else')):
            with self.assertRaises(RedditError):
                document(markup, 'fixture')

    def test_signed_in_wrong_feed_is_not_accepted_as_the_requested_collection(self):
        with self.assertRaises(RedditError):
            listing(page(thing()).replace('/user/fixture/saved/', '/user/fixture/submitted/'), 'fixture', 'saved')

    def test_pagination_cannot_change_account_host_or_collection(self):
        markup = page(thing(), 't3_abc')
        for replacement in ('https://evil.example/?after=t3_abc', '/user/other/saved/?after=t3_abc',
                            '/user/fixture/hidden/?after=t3_abc', '/user/fixture/saved/?after=bad'):
            with self.subTest(replacement=replacement), self.assertRaises(RedditError):
                listing(markup.replace('/user/fixture/saved/?after=t3_abc', replacement), 'fixture', 'saved')

    def test_json_listing_preserves_order_and_rejects_unverified_coverage(self):
        markup = json_page('t1_def')
        parsed = json_listing(markup)
        self.assertEqual(list(parsed['members']), ['t3_abc', 't1_def'])
        self.assertEqual(parsed['members']['t1_def'], URL + 'def/')
        self.assertEqual(parsed['cursor'], 't1_def')
        for field, value in [('modhash', ''), ('after', 'bogus'), ('children', [])]:
            with self.subTest(field=field), self.assertRaises(RedditError):
                json_listing(dict(markup, data=dict(markup['data'], **{field: value})))
        self.assertEqual(json_listing(dict(markup, data=dict(markup['data'], children=[], after=None))),
                         {'members': {}, 'cursor': None})
        markup['data']['children'][1]['data']['permalink'] = URL + 'mismatch/'
        with self.assertRaisesRegex(RedditError, 'ID and permalink disagree'):
            json_listing(markup)

    def test_source_urls_are_canonical_and_allowlisted(self):
        self.assertEqual(source_url(URL.replace('old.', 'www.') + '?context=3'), ('t3_abc', URL))
        self.assertEqual(source_url(URL + 'def/')[0], 't1_def')
        for value in ('https://old.reddit.com.evil/comments/abc/title/', 'http://old.reddit.com/comments/abc/',
                      'https://old.reddit.com:8443/comments/abc/', 'https://old.reddit.com/api/save', '../auth',
                      'https://evil.example/comments/abc/title/', 'https://old.reddit.com@evil.example/comments/abc/title/'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                source_url(value)

    def test_missing_or_truncated_sources_fail_instead_of_caching_a_title(self):
        for markup in (header(), (header() + thing()).replace('class="usertext-body"', 'class="hidden-body"')):
            with self.assertRaises(RedditError):
                source(markup, 't3_abc', STAMP, 'fixture')

    def test_known_spoiler_gate_preserves_visible_title_and_marks_hidden_body(self):
        markup=(header()+thing()).replace('<div class="usertext-body"><div class="md"><p>A synthetic full sentence.</p></div></div>',
                    '<div class="expando-gate--spoiler"><button>Click to see spoiler</button></div>')
        parsed=source(markup,'t3_abc',STAMP,'fixture')
        self.assertEqual(parsed['body_status'],'spoiler_hidden')
        self.assertEqual(parsed['text'],'')
        self.assertEqual(parsed['title'],'Synthetic title')
        self.assertTrue(valid_post(parsed,'t3_abc'))
        self.assertFalse(valid_post(dict(parsed,text='invented body'),'t3_abc'))

    def test_self_post_without_body_or_expansion_markup_records_partial_body(self):
        markup=(header()+thing()).replace('<div class="usertext-body"><div class="md"><p>A synthetic full sentence.</p></div></div>','')
        parsed=source(markup,'t3_abc',STAMP,'fixture')
        self.assertEqual(parsed['body_status'],'not_exposed')
        self.assertEqual(parsed['text'],'')
        self.assertTrue(valid_post(parsed,'t3_abc'))


class TransportTests(unittest.TestCase):
    def test_direct_local_mode_is_explicit_mac_only_and_not_a_proxy_fallback(self):
        with patch.object(sys, 'platform', 'linux'), self.assertRaises(RedditError):
            DirectClient([COOKIE])
        with patch.object(sys, 'platform', 'darwin'):
            with self.assertRaises(RedditError):
                DirectClient([COOKIE], PROXY)
            client = DirectClient([COOKIE])
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://ambient.invalid:9'}), \
                patch('direct.http.client.HTTPSConnection', side_effect=OSError('synthetic')) as connect:
            with self.assertRaisesRegex(RedditError, 'no automatic retry or route fallback'):
                client.account()
        connect.assert_called_once()
        self.assertEqual(connect.call_args.args, ('old.reddit.com',))

    def test_direct_identity_and_json_continuation_keep_cookie_and_origin_scoped(self):
        cookies = [COOKIE, dict(COOKIE, name='foreign', domain='www.reddit.com'),
                   dict(COOKIE, name='api_only', path='/api'), dict(COOKIE, name='expired', expires=1)]
        with patch.object(sys, 'platform', 'darwin'):
            client = DirectClient(cookies, delay=0)
        connections = []
        for payload in [{'data': {'name': 'Fixture'}}, json_page('t1_def'), json_page()]:
            conn = Mock()
            conn.getresponse.return_value = Mock(status=200, **{
                'getheader.return_value': 'application/json; charset=utf-8',
                'read.return_value': json.dumps(payload).encode(),
            })
            connections.append(conn)
        with patch('direct.http.client.HTTPSConnection', side_effect=connections) as connect:
            self.assertEqual(client.account(), {'id': 'fixture'})
            with self.assertRaisesRegex(RedditError, 'differs from the verified identity'):
                client.page('other', 'saved')
            page_one = client.page('fixture', 'saved')
            self.assertIsNone(client.page('fixture', 'saved', page_one['cursor'])['cursor'])
            cookies.append(dict(COOKIE, path='/user', value='another-session'))
            with self.assertRaisesRegex(RedditError, 'differs from the verified session'):
                client.page('fixture', 'saved')
        for conn, url, cookie in zip(connections, ['/api/me.json', '/user/fixture/saved.json?limit=100&raw_json=1',
                                                  '/user/fixture/saved.json?limit=100&after=t1_def&raw_json=1'],
                                     ['reddit_session=synthetic; api_only=synthetic', 'reddit_session=synthetic', 'reddit_session=synthetic']):
            conn.request.assert_called_once_with('GET', url, headers={
                'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Cookie': cookie,
            })
            conn.set_tunnel.assert_not_called()
            conn.close.assert_called_once()
        self.assertEqual([call.args for call in connect.call_args_list], [('old.reddit.com',)] * 3)

    def test_network_security_denial_does_not_claim_cookie_expiry(self):
        client=Client([COOKIE],PROXY)
        self.addCleanup(client.http.close)
        with patch.object(client.http,'get') as get:
            response=get.return_value.__enter__.return_value
            response.status_code=403
            response.iter_content.return_value=iter([b'<p>Blocked by network security</p>'])
            with self.assertRaisesRegex(RedditError,'Cookie expiry was not established'):
                client.account()
        get.assert_called_once()

    def test_live_reads_require_explicit_proxy(self):
        with self.assertRaisesRegex(RedditError, 'private bridge'):
            Client([COOKIE])
        for proxy in ('socks5://localhost:1234', 'http://', 'http://localhost:bad', 'http://u:p@localhost:1234'):
            with self.subTest(proxy=proxy), self.assertRaises(RedditError):
                Client([COOKIE], proxy)

    def test_cookie_scoping_tls_proxy_and_no_redirects(self):
        client = Client([COOKIE], PROXY)
        self.addCleanup(client.http.close)
        adapter = Mock()
        response = requests.Response()
        response.status_code, response._content, response._content_consumed = 200, header().encode(), True
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        adapter.send.return_value = response
        client.http.mount('https://', adapter)
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://wrong.invalid:9'}):
            self.assertEqual(client.account()['id'], 'fixture')
        call = adapter.send.call_args
        self.assertEqual(call.kwargs['proxies']['https'], PROXY)
        self.assertTrue(call.kwargs['verify'])
        self.assertIn('reddit_session=synthetic', call.args[0].headers['Cookie'])
        self.assertFalse(client.http.trust_env)
        with patch.object(client.http, 'get') as get:
            for path in ('//evil.example/', '/api/vote', '/message/inbox', 'https://evil.example/'):
                with self.assertRaises(RedditError):
                    client.read(path)
            get.assert_not_called()

    def test_network_failure_is_sanitized_and_never_retried_directly(self):
        client = Client([COOKIE], PROXY)
        self.addCleanup(client.http.close)
        with patch.object(client.http, 'get', side_effect=requests.exceptions.ProxyError('PRIVATE')) as get:
            with self.assertRaises(RedditError) as caught:
                client.account()
            self.assertNotIn('PRIVATE', str(caught.exception))
            get.assert_called_once()

    def test_403_429_and_login_redirect_stop(self):
        for status in (403, 429, 302):
            client = Client([COOKIE], PROXY)
            self.addCleanup(client.http.close)
            with patch.object(client.http, 'get') as get:
                get.return_value.__enter__.return_value.status_code = status
                with self.assertRaises(RedditError):
                    client.account()
                get.assert_called_once()
                self.assertFalse(get.call_args.kwargs['allow_redirects'])

    def test_workers_transport_preserves_identity_listing_and_source_semantics(self):
        transport = Mock()
        transport.relay.side_effect = [
            RelayResponse(
                200,
                json.dumps({'data': {'name': 'fixture'}}).encode(),
                'application/json; charset=utf-8',
                'https://old.reddit.com/api/me.json',
                [],
            ),
            RelayResponse(
                200,
                json.dumps(json_page('t1_def')).encode(),
                'application/json; charset=utf-8',
                'https://old.reddit.com/user/fixture/saved.json',
                [],
            ),
            RelayResponse(
                200,
                (header() + thing()).encode(),
                'text/html; charset=utf-8',
                URL,
                [],
            ),
        ]
        client = WorkersRelayClient([COOKIE], transport, delay=0)
        try:
            with patch(
                'api.Client',
                side_effect=AssertionError('Proxy client forbidden'),
            ), patch(
                'direct.DirectClient',
                side_effect=AssertionError('Direct client forbidden'),
            ):
                self.assertEqual(client.account(), {'id': 'fixture'})
                parsed = client.page('fixture', 'saved')
                self.assertEqual(list(parsed['members']), ['t3_abc', 't1_def'])
                self.assertEqual(parsed['cursor'], 't1_def')
                parsed_post = client.post(URL, STAMP, 'fixture')
                self.assertEqual(parsed_post['id'], 't3_abc')
        finally:
            client.close()
        calls = transport.relay.call_args_list
        self.assertEqual(calls[0].args[:3], ('reddit', 'identity', {}))
        self.assertEqual(
            calls[1].args[:3],
            (
                'reddit',
                'listing',
                {'account': 'fixture', 'collection': 'saved', 'after': None},
            ),
        )
        self.assertEqual(
            calls[2].args[:3],
            ('reddit', 'comments', {'permalink': URL}),
        )
        for call in calls:
            self.assertIn(
                'reddit_session=synthetic',
                call.kwargs['headers']['Cookie'],
            )
            self.assertNotIn(
                'cf-access-client-secret',
                {name.lower() for name in call.kwargs['headers']},
            )
        transport.close.assert_called_once()

    def test_workers_parser_does_not_hold_child_lock(self):
        with patch.object(
            sys,
            'argv',
            ['reddit.py', 'workers', '--', 'verify', '--collections', 'saved'],
        ), patch.object(
            cli,
            'lock',
            side_effect=AssertionError('Only the child collector owns the lock'),
        ), patch.object(cli, 'service_workers', return_value=4) as workers:
            self.assertEqual(cli.main(), 4)
        self.assertEqual(
            workers.call_args.args[0].arguments,
            ['--', 'verify', '--collections', 'saved'],
        )

    def test_private_cookie_loading_filters_foreign_and_expired_cookies(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'REDDIT_STORAGE_STATE_JSON': json.dumps({'cookies': [COOKIE,
                dict(COOKIE, domain='.x.com', value='foreign'), dict(COOKIE, expires=1, value='expired')]})}):
            self.assertEqual(state(Path(root)), [COOKIE])

    def test_cookie_export_needs_consent_before_browser_access(self):
        with patch.object(sys, 'platform', 'darwin'), patch.object(sys.stdin, 'isatty', return_value=False):
            with self.assertRaisesRegex(ValueError, 'consent'):
                login(Path('/unused'), 'Default', False, Mock())


class S3Error(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code}}


class BrowserTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.factory=Mock()
        self.driver=self.factory.return_value.start.return_value
        self.context=self.driver.chromium.launch_persistent_context.return_value
        self.page=Mock()
        self.context.pages=[self.page]
        self.addCleanup(patch.stopall)
        patch.object(sys,'platform','darwin').start()

    def client(self):
        client=BrowserClient([COOKIE],self.root,delay=0,factory=self.factory)
        self.addCleanup(client.close)
        return client

    def test_browser_is_isolated_keeps_security_checks_and_imports_only_authorized_state(self):
        client=self.client()
        call=self.driver.chromium.launch_persistent_context.call_args
        self.assertEqual(Path(call.args[0]),(self.root/'browser/profile').resolve())
        self.assertEqual(call.kwargs['channel'],'chrome')
        self.assertFalse(call.kwargs['headless'])
        self.assertTrue(call.kwargs['chromium_sandbox'])
        self.assertFalse(call.kwargs['ignore_https_errors'])
        self.assertNotIn('args',call.kwargs)
        self.context.add_cookies.assert_called_once_with([COOKIE])
        client.close()
        self.context.close.assert_called_once()
        self.driver.stop.assert_called_once()

    def test_foreign_cookies_proxy_and_cloud_cannot_launch_browser(self):
        for kwargs,cookies in (({'proxy':PROXY},[COOKIE]), ({},[dict(COOKIE,domain='.evil.example')])):
            with self.assertRaises(RedditError):
                BrowserClient(cookies,self.root,factory=self.factory,**kwargs)
        with patch.object(sys,'platform','linux'),self.assertRaises(RedditError):
            BrowserClient([COOKIE],self.root,factory=self.factory)
        self.factory.assert_not_called()

    def test_document_uses_common_identity_parser_and_no_custom_page_script(self):
        client=self.client()
        def navigate(url,**kwargs):
            self.page.url=url
            return types.SimpleNamespace(status=200,headers={'content-type':'text/html'})
        self.page.goto.side_effect=navigate
        self.page.content.return_value=header()+thing()
        self.assertEqual(client.account(),{'id':'fixture'})
        self.page.evaluate.assert_not_called()
        self.page.goto.assert_called_once_with('https://old.reddit.com/',wait_until='domcontentloaded',timeout=30000)

    def test_browser_transport_preserves_inherited_collection_method(self):
        client=self.client()
        def navigate(url,**kwargs):
            self.page.url=url
            return types.SimpleNamespace(status=200,headers={'content-type':'text/html'})
        self.page.goto.side_effect=navigate
        self.page.content.return_value=page(thing())
        parsed=client.page('fixture','saved')
        self.assertEqual(parsed['members'],{'t3_abc':URL})

    def test_redirect_mutation_and_external_assets_are_blocked(self):
        client=self.client()
        client.target='https://old.reddit.com/'
        for url,method,kind,main,allowed in (
            (client.target,'GET','document',True,True),
            ('https://old.reddit.com/login/','GET','document',True,False),
            ('https://old.reddit.com/api/save','POST','fetch',False,False),
            ('https://old.reddit.com/api/expando?link_id=t3_abc','GET','xhr',False,False),
            ('https://old.reddit.com/api/expando?link_id=t3_abc','GET','image',False,False),
            ('https://old.reddit.com/api/expando?link_id=t3_other','GET','xhr',False,False),
            ('https://old.reddit.com/api/expando?link_id=t3_abc','POST','xhr',False,False),
            ('https://external.example/tracker.js','GET','script',False,False),
            ('https://www.redditstatic.com/site.css','GET','stylesheet',False,True)):
            route=Mock();request=route.request
            request.url,request.method,request.resource_type=url,method,kind
            request.is_navigation_request.return_value=main
            request.frame=self.page.main_frame
            client._route(route)
            (route.continue_ if allowed else route.abort).assert_called_once()

    def test_login_or_challenge_navigation_is_not_followed_or_retried(self):
        client=self.client()
        def navigate(*a,**kw):
            client.navigation_blocked=True
            raise RuntimeError('PRIVATE URL')
        self.page.goto.side_effect=navigate
        with self.assertRaises(RedditError) as caught:
            client.account()
        self.assertNotIn('PRIVATE',str(caught.exception))
        self.page.goto.assert_called_once()

    def test_source_canonicalization_keeps_identity_origin_and_query_scope(self):
        client=self.client()
        original=URL+'?context=0'
        for target,allowed in ((URL.replace('/example/','/new_slug/')+'?context=0',True),
                               (URL+'?js_challenge=1',False),
                               (URL.replace('/abc/','/other/')+'?context=0',False),
                               (URL.replace('old.reddit.com','www.reddit.com')+'?context=0',False)):
            client.target=original
            route=Mock();q=route.request
            q.method,q.url,q.resource_type='GET',target,'document'
            q.is_navigation_request.return_value=True;q.frame=self.page.main_frame
            client._route(route)
            (route.continue_ if allowed else route.abort).assert_called_once()
            if allowed:self.assertEqual(client.target,target)

    def test_startup_failure_closes_driver_without_disclosing_raw_errors(self):
        self.driver.chromium.launch_persistent_context.side_effect=RuntimeError('PRIVATE')
        with self.assertRaises(RedditError) as caught:
            self.client()
        self.assertNotIn('PRIVATE',str(caught.exception))
        self.driver.stop.assert_called_once()


class FakeS3:
    def __init__(self):
        self.objects, self.encodings, self.writes = {}, {}, []
        self.fail_posts = False

    def get_object(self, Bucket, Key):
        payload, etag = self.objects[Key]
        return {'Body': io.BytesIO(payload), 'ETag': etag, 'ContentEncoding': self.encodings.get(Key)}

    def put_object(self, Bucket, Key, Body, **kw):
        if self.fail_posts and '/posts/' in Key:
            raise S3Error('AccessDenied')
        if kw.get('IfNoneMatch') == '*' and Key in self.objects:
            raise S3Error('PreconditionFailed')
        if kw.get('IfMatch') and kw['IfMatch'] != self.objects[Key][1]:
            raise S3Error('PreconditionFailed')
        self.objects[Key] = (Body, str(len(self.writes)))
        self.encodings[Key] = kw.get('ContentEncoding')
        self.writes.append(Key)
        return {'ETag': self.objects[Key][1]}


class CacheWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.addCleanup(patch.stopall)
        patch.object(cli, 'CACHE', self.root).start()
        patch.dict(os.environ, {'REDDIT_CACHE_BUCKET': '', 'REDDIT_ACCOUNT': ''}).start()
        self.args = types.SimpleNamespace(account='fixture', offline=True, collection=None, latest=False)

    def test_corruption_orphan_recovery_and_account_isolation(self):
        cache = Cache(self.root, 'fixture')
        atomic_json(cache.root / 'posts/t3_abc.json', post())
        self.assertEqual(cache.get('t3_abc')['id'], 't3_abc')
        self.assertIsNone(Cache(self.root, 'someone_else').get('t3_abc'))
        (cache.root / 'posts/t3_abc.json').write_text('{broken')
        self.assertIsNone(cache.get('t3_abc'))
        self.assertEqual(cache.index['posts']['t3_abc']['status'], 'retry_needed')
        with self.assertRaises(ValueError):
            Cache(self.root, '../auth')

    def test_offline_get_and_search_never_construct_network_clients(self):
        Cache(self.root, 'fixture').put(post())
        self.args.post, self.args.refresh = URL, False
        with patch.object(cli, 'Client', side_effect=AssertionError('No Reddit')), patch.object(cli, 'emit') as emit, \
                patch.object(cli, 'bucket', side_effect=AssertionError('No S3')):
            cli.get_post(self.args)
            self.assertEqual(emit.call_args.args[0]['id'], 't3_abc')
            self.args.phrase = 'synthetic FULL sentence'
            cli.search(self.args)
            self.assertEqual(len(emit.call_args.args[0]['matches']), 1)

    def test_merge_keeps_archive_and_previous_completed_snapshot(self):
        a, b = empty_index('fixture'), empty_index('fixture')
        a['collections']['saved'] = {'post_ids': ['t3_abc'], 'latest_post_ids': ['t3_abc'], 'last_completed_at': '2026-01-01',
                                    'scan': {'updated_at': '2026-01-01', 'status': 'reachable_end'}}
        b['collections']['saved'] = {'post_ids': ['t1_def'], 'scan': {'updated_at': '2026-02-01', 'status': 'partial'}}
        merged = merge_indexes(a, b)['collections']['saved']
        self.assertEqual(set(merged['post_ids']), {'t3_abc', 't1_def'})
        self.assertEqual(merged['latest_post_ids'], ['t3_abc'])
        self.assertEqual(merged['scan']['status'], 'partial')

    def test_s3_content_before_manifest_restore_and_no_auth_upload(self):
        fake = FakeS3()
        remote = S3Cache('fixture-cache', fake)
        cache = Cache(self.root, 'fixture', remote)
        cache.put(post())
        atomic_json(self.root / 'auth/storage-state.json', {'cookies': 'PRIVATE'})
        cache.save()
        self.assertIn('/posts/', fake.writes[-2])
        self.assertTrue(fake.writes[-1].endswith('/index.json'))
        self.assertFalse(any(b'PRIVATE' in data for data, _ in fake.objects.values()))
        restored = Cache(self.root / 'fresh', 'fixture', remote)
        self.assertEqual(restored.get('t3_abc')['text'], 'A synthetic full sentence.')
        key = restored.index['posts']['t3_abc']['s3_key']
        fake.objects[key] = (b'{}', 'bad')
        (restored.root / 'posts/t3_abc.json').unlink()
        with self.assertRaises(ValueError):
            restored.get('t3_abc')

    def test_s3_upload_failure_retains_local_source_without_remote_reference(self):
        fake = FakeS3()
        cache = Cache(self.root, 'fixture', S3Cache('fixture-cache', fake))
        cache.put(post())
        fake.fail_posts = True
        with self.assertRaises(S3Error):
            cache.save()
        self.assertEqual(Cache(self.root, 'fixture').get('t3_abc')['id'], 't3_abc')
        index = json.loads(gzip.decompress(fake.objects['cache/reddit/v1/accounts/fixture/index.json'][0]))
        self.assertEqual(index['posts'], {})

    def refresh_setup(self):
        args = types.SimpleNamespace(account='fixture', offline=False, max_pages=None, delay=1.0,
                                     collections=['saved'], resume=False)
        client = Mock()
        patch.object(cli, 'authenticated', return_value=(client, 'fixture')).start()
        patch.object(cli, 'emit').start()
        client.post.side_effect = lambda url, stamp, account: post(source_url(url)[0])
        return args, client

    def test_pagination_checkpoint_resume_and_source_reuse(self):
        args, client = self.refresh_setup()
        client.page.side_effect = [{'members': {'t3_abc': URL}, 'cursor': 't3_abc'}, RedditError('rate limit')]
        self.assertEqual(cli.refresh(args), 1)
        cache = Cache(self.root, 'fixture')
        self.assertEqual(cache.index['collections']['saved']['scan']['cursor'], 't3_abc')
        client.page.side_effect = None
        client.page.return_value = {'members': {'t3_abc': URL}, 'cursor': None}
        args.resume = True
        self.assertEqual(cli.refresh(args), 0)
        self.assertEqual(client.page.call_args.args, ('fixture', 'saved', 't3_abc'))
        client.post.assert_called_once()
        scan = Cache(self.root, 'fixture').index['collections']['saved']
        self.assertEqual(scan['latest_post_ids'], ['t3_abc'])

    def test_source_failure_retries_same_page_and_keeps_missing_membership(self):
        args, client = self.refresh_setup()
        client.page.return_value = {'members': {'t3_abc': URL, 't1_def': URL + 'def/'}, 'cursor': 't1_def'}
        client.post.side_effect = [post(), RedditError('source failed')]
        self.assertEqual(cli.refresh(args), 1)
        cache = Cache(self.root, 'fixture')
        self.assertIsNone(cache.index['collections']['saved']['scan']['cursor'])
        self.assertEqual(cache.index['posts']['t1_def']['status'], 'retry_needed')
        self.args.phrase = 'absent'
        with patch.object(cli, 'emit') as emit:
            cli.search(self.args)
            self.assertEqual(emit.call_args.args[0]['missing_items'], 1)
        client.post.side_effect = lambda *args: post('t1_def')
        client.page.return_value = {'members': {'t3_abc': URL, 't1_def': URL + 'def/'}, 'cursor': None}
        args.resume = True
        self.assertEqual(cli.refresh(args), 0)
        self.assertEqual(client.page.call_args.args[-1], None)

    def test_explicit_unavailable_source_does_not_block_following_items_or_retry(self):
        args, client = self.refresh_setup()
        client.page.return_value = {'members': {'t1_def': URL + 'def/', 't3_abc': URL}, 'cursor': None}
        client.post.side_effect = [Unavailable('Reddit explicitly returned HTTP 404.'), post()]
        self.assertEqual(cli.refresh(args), 0)
        cache = Cache(self.root, 'fixture')
        self.assertEqual(cache.index['posts']['t1_def']['status'], 'unavailable')
        self.assertEqual(cache.index['collections']['saved']['scan']['unavailable_ids'], ['t1_def'])
        client.post.reset_mock()
        self.assertEqual(cli.refresh(args), 0)
        client.post.assert_not_called()

    def test_failed_explicit_recheck_retains_readable_old_source(self):
        Cache(self.root, 'fixture').put(post())
        self.args.offline, self.args.post, self.args.refresh = False, URL, True
        client = Mock()
        client.post.side_effect = Unavailable('Reddit explicitly returned HTTP 404.')
        with patch.object(cli, 'authenticated', return_value=(client, 'fixture')):
            with self.assertRaises(Unavailable):
                cli.get_post(self.args)
        self.assertEqual(Cache(self.root, 'fixture').get('t3_abc')['text'], 'A synthetic full sentence.')

    def test_rate_limit_stops_other_collections_and_repeated_cursor_is_partial(self):
        args, client = self.refresh_setup()
        args.collections = ['saved', 'upvoted']
        client.page.side_effect = RedditError('rate limited')
        self.assertEqual(cli.refresh(args), 1)
        client.page.assert_called_once()
        self.assertNotIn('upvoted', Cache(self.root, 'fixture').index['collections'])
        args.collections = ['saved']
        client.page.side_effect = None
        client.page.return_value = {'members': {'t3_abc': URL}, 'cursor': 't3_abc'}
        self.assertEqual(cli.refresh(args), 1)
        self.assertEqual(Cache(self.root, 'fixture').index['collections']['saved']['scan']['reason'], 'repeated_cursor')

    def test_explicit_page_limit_is_resumable(self):
        args, client = self.refresh_setup()
        args.max_pages = 1
        client.page.return_value = {'members': {'t3_abc': URL}, 'cursor': 't3_abc'}
        self.assertEqual(cli.refresh(args), 0)
        self.assertEqual(Cache(self.root, 'fixture').index['collections']['saved']['scan']['reason'], 'requested_page_limit')

    def test_account_mismatch_cannot_write_another_archive(self):
        self.args.offline = False
        with patch.object(cli, 'Client') as factory:
            factory.return_value.account.return_value = {'id': 'someone_else'}
            with patch.object(cli, 'state', return_value=[COOKIE]), self.assertRaises(RedditError):
                cli.authenticated(self.args)
        self.assertFalse((self.root / 'account.json').exists())

    def test_live_verification_caches_a_source_without_inventing_collection_coverage(self):
        args,client=self.refresh_setup()
        client.page.return_value={'members':{'t3_abc':URL,'t1_def':URL+'def/'},'cursor':'t1_def'}
        cli.verify(args)
        cache=Cache(self.root,'fixture')
        self.assertEqual(cache.index['collections'],{})
        self.assertEqual(list(cache.index['posts']),['t3_abc'])
        client.post.assert_called_once()

    def test_cached_search_reports_bodies_that_could_not_be_read(self):
        cache=Cache(self.root,'fixture')
        cache.put(dict(post(),text='',body_status='spoiler_hidden'))
        self.args.phrase='absent'
        with patch.object(cli,'emit') as emit:
            cli.search(self.args)
        result=emit.call_args.args[0]
        self.assertEqual(result['hidden_bodies'],1)
        self.assertEqual(result['unread_bodies'],1)
        self.assertEqual(result['matches'],[])
        self.assertEqual(result['missing_items'],0)


class BridgeTests(unittest.TestCase):
    def test_post_connect_client_disconnect_does_not_poison_bridge_health(self):
        handler = object.__new__(transport.Handler)
        handler.server = types.SimpleNamespace(stopped=threading.Event(), failed=threading.Event(),
            deadline=time.time()+60, endpoint=('100.64.0.1',8443), token='synthetic', local_transport=False)
        handler.path, handler.wfile, handler.connection = 'old.reddit.com:443', io.BytesIO(), Mock()
        handler.connection.sendall.side_effect = BrokenPipeError('client closed a completed HTTPS response')
        upstream = Mock()
        upstream.sock.recv.return_value = b'opaque TLS bytes'
        with patch.object(transport, 'open_tunnel', return_value=upstream), \
                patch.object(transport.select, 'select', return_value=([upstream.sock],[],[])):
            handler.do_CONNECT()
        self.assertIn(b'200 Connection Established',handler.wfile.getvalue())
        self.assertFalse(handler.server.failed.is_set())
        upstream.close.assert_called_once()

    def test_pre_connect_failure_still_marks_bridge_unhealthy(self):
        handler = object.__new__(transport.Handler)
        handler.server = types.SimpleNamespace(stopped=threading.Event(), failed=threading.Event(),
            deadline=time.time()+60, endpoint=('100.64.0.1',8443), token='synthetic', local_transport=False)
        handler.path, handler.send_error = 'old.reddit.com:443', Mock()
        with patch.object(transport, 'open_tunnel', side_effect=OSError('route failed')):
            handler.do_CONNECT()
        self.assertTrue(handler.server.failed.is_set())
        handler.send_error.assert_called_once_with(502)

    def test_explicit_local_transport_never_uses_cloud_proxy_or_falls_back(self):
        connection = Mock()
        with patch.object(transport.http.client, 'HTTPConnection', return_value=connection) as factory:
            self.assertIs(transport.local_peer_connection('100.64.0.1', 8443), connection)
        factory.assert_called_once_with('100.64.0.1', 8443, timeout=10)
        connection.connect.assert_called_once()
        with patch.object(transport, 'peer_connection', side_effect=AssertionError('Cloud path forbidden')), \
                patch.object(transport, 'local_peer_connection', side_effect=OSError('local route failed')) as local:
            with self.assertRaises(OSError):
                transport.open_tunnel('100.64.0.1', 8443, 'old.reddit.com:443', 'synthetic', local=True)
        local.assert_called_once()

    def test_reddit_child_sets_only_reddit_proxy_and_preserves_aws_environment(self):
        child, jobs, transport = Mock(), Mock(), Mock()
        child.poll.return_value, child.returncode = 0, 0
        transport.proxy_url = PROXY
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://aws.invalid:9'}, clear=True), \
                patch.object(bridge.subprocess, 'Popen', return_value=child) as spawn, patch.object(bridge, 'check_ready'):
            self.assertEqual(bridge.collect(['--account', 'fixture', 'refresh'], transport, {}, jobs, 'synthetic', workflow='reddit'), 0)
        call = spawn.call_args
        self.assertTrue(call.args[0][1].endswith('/tools/reddit/reddit.py'))
        self.assertEqual(call.kwargs['env']['REDDIT_PROXY'], PROXY)
        self.assertEqual(call.kwargs['env']['HTTPS_PROXY'], 'http://aws.invalid:9')
        self.assertNotIn('X_PROXY', call.kwargs['env'])
        self.assertNotIn('YOUTUBE_HISTORY_PROXY', call.kwargs['env'])

    def test_cli_forwards_account_without_parent_lock(self):
        with patch.object(sys, 'argv', ['reddit.py', '--account', 'fixture', 'bridge', '--', 'refresh', '--resume']), \
                patch.object(cli, 'lock', side_effect=AssertionError('Only child locks')), \
                patch.object(bridge, 'command', return_value=1) as command:
            self.assertEqual(cli.main(), 1)
        self.assertEqual(command.call_args.kwargs, {'workflow': 'reddit'})
        self.assertEqual(command.call_args.args[0].arguments, ['--account', 'fixture', 'refresh', '--resume'])

    def test_unsigned_probe_never_loads_cookies_or_follows_redirects(self):
        with patch.object(probe.requests, 'Session') as session:
            http = session.return_value.__enter__.return_value
            http.get.return_value.__enter__.return_value.status_code = 302
            results = probe.reddit_probe(PROXY)
        self.assertFalse(http.trust_env)
        self.assertEqual(http.get.call_args.args[0], 'https://old.reddit.com/')
        self.assertFalse(http.get.call_args.kwargs['allow_redirects'])
        self.assertEqual(results[0]['status'], 302)

    def test_offline_bridge_and_cache_commands_cannot_invoke_aws(self):
        with patch.object(bridge.boto3, 'Session', side_effect=AssertionError('No AWS')):
            with self.assertRaises(RedditError):
                cli.service_bridge(types.SimpleNamespace(offline=True))
            for arguments in (['--offline', 'refresh'], ['login'], ['search', 'phrase']):
                with self.assertRaises(BridgeError):
                    bridge.run(types.SimpleNamespace(arguments=arguments), workflow='reddit')


if __name__ == '__main__':
    unittest.main()
