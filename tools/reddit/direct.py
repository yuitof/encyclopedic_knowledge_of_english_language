"""Direct macOS reads using the verified cookie-authenticated website routes."""
from contextlib import closing
import http.client
import json
import os
import re
import ssl
import sys
import time
from urllib.parse import quote, urlencode, urlsplit

from api import HTMLClient, check_response, listing_query, validate_path
from auth import DOMAINS
from pages import ORIGIN, RedditError, json_account, json_listing

HOST = urlsplit(ORIGIN).hostname
USER_AGENT = 'english-vault-personal-archive/1.0 (read-only diagnostic)'
COOKIE_NAME = re.compile(r"[A-Za-z0-9!#$%&'*+.^_`|~-]+\Z")
COOKIE_VALUE = re.compile(r'[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*\Z')


class DirectClient(HTMLClient):
    def __init__(self, cookies, proxy=None, delay=2.0):
        if sys.platform != 'darwin' or proxy:
            raise RedditError('Direct local mode requires macOS and cannot be combined with a proxy.')
        self.cookies = cookies
        self.delay, self.previous = delay, None
        self.account_id = None
        self._session_cookie = None
        self.context = None
        ca_bundle = os.environ.get('REQUESTS_CA_BUNDLE') or os.environ.get('CURL_CA_BUNDLE')
        if ca_bundle:
            ca_option = 'capath' if os.path.isdir(ca_bundle) else 'cafile'
            self.context = ssl.create_default_context(**{ca_option: ca_bundle})
            self.context.set_alpn_protocols(['http/1.1'])

    def _cookie_header(self, path):
        pairs = {}
        for cookie in self.cookies:
            domain = cookie['domain'].lower()
            if domain.lstrip('.') not in DOMAINS or not (domain == HOST or (domain.startswith('.') and HOST.endswith(domain))):
                continue
            scope = cookie.get('path') or '/'
            if scope != path and not path.startswith(scope.rstrip('/') + '/'):
                continue
            expiry = cookie.get('expires', -1)
            if expiry > 0 and expiry <= time.time():
                continue
            name, value = cookie['name'], cookie['value']
            if COOKIE_NAME.fullmatch(name) and COOKIE_VALUE.fullmatch(value):
                pairs[name] = value
        session_cookie = pairs.get('reddit_session')
        if not session_cookie:
            raise RedditError('No valid Reddit session cookie is scoped to this Old Reddit read.')
        if self._session_cookie is not None and session_cookie != self._session_cookie:
            raise RedditError('The scoped Reddit session differs from the verified session.')
        return '; '.join(f'{name}={value}' for name, value in pairs.items()), session_cookie

    def _request(self, path, content_type):
        if self.previous is not None:
            time.sleep(max(0, self.delay - (time.monotonic() - self.previous)))
        cookie, session_cookie = self._cookie_header(urlsplit(path).path)
        accept = 'text/html,application/xhtml+xml' if content_type == 'text/html' else content_type
        try:
            self.previous = time.monotonic()
            with closing(http.client.HTTPSConnection(HOST, timeout=30, context=self.context)) as conn:
                conn.request('GET', quote(path, safe='/%?=&'), headers={
                    'User-Agent': USER_AGENT, 'Accept': accept, 'Cookie': cookie,
                })
                with closing(conn.getresponse()) as response:
                    prefix = response.read(262144) if response.status == 403 else b''
                    check_response(response.status, prefix)
                    actual = response.getheader('Content-Type', '').split(';', 1)[0].strip().lower()
                    if actual != content_type:
                        raise RedditError('Reddit returned an unexpected content type. Access or frontend may have changed.')
                    body = response.read(12_000_001)
                    if len(body) > 12_000_000:
                        raise RedditError('Reddit response exceeds the supported page size.')
                    if path == '/api/me.json':
                        self._session_cookie = session_cookie
                    return body
        except (OSError, http.client.HTTPException):
            raise RedditError('Direct Reddit HTTPS request failed with no automatic retry or route fallback.') from None

    def _json(self, path):
        body = self._request(path, 'application/json')
        try:
            return json.loads(body)
        except (ValueError, RecursionError):
            raise RedditError('Reddit returned invalid JSON. Cached progress was retained.') from None

    def read(self, path):
        validate_path(path)
        return self._request(path, 'text/html').decode('utf-8', errors='replace')

    def account(self):
        self.account_id = json_account(self._json('/api/me.json'))
        return {'id': self.account_id}

    def page(self, account, collection, cursor=None):
        query = listing_query(account, collection, cursor)
        if account != self.account_id:
            raise RedditError('Reddit listing account differs from the verified identity.')
        query['raw_json'] = 1
        return json_listing(self._json(f'/user/{account}/{collection}.json?' + urlencode(query)))

    def close(self):
        # Each request owns and closes its own HTTPS connection.
        pass
