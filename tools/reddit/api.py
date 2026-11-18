"""Read-only, cookie-authenticated Old Reddit HTML transport."""
import os
import re
import time
from urllib.parse import urlencode, urlsplit

import requests

from pages import ACCOUNT, COLLECTIONS, ID, ORIGIN, RedditError, Unavailable, document, listing, source, source_url


class Client:
    def __init__(self, cookies, proxy=None, delay=2.0):
        if not proxy:
            raise RedditError('Reddit live reads require the private bridge: use bridge -- probe, then bridge -- refresh/get.')
        try:
            target = urlsplit(proxy)
            if target.scheme != 'http' or not target.hostname or not target.port or target.username or target.password:
                raise ValueError
        except ValueError:
            raise RedditError('Invalid Reddit proxy; use the temporary bridge relay or an explicitly authorized HTTP proxy.') from None
        self.http = requests.Session()
        # Explicit proxy only. Preserve CA verification even when trust_env is disabled.
        self.http.trust_env = False
        self.http.verify = os.environ.get('REQUESTS_CA_BUNDLE') or os.environ.get('CURL_CA_BUNDLE') or True
        self.http.headers['User-Agent'] = 'english-vault-personal-archive/1.0 (read-only Old Reddit client)'
        self.proxy = proxy
        self.delay, self.previous = delay, None
        for c in cookies:
            self.http.cookies.set(c['name'], c['value'], domain=c['domain'], path=c.get('path', '/'), secure=True)

    def read(self, path):
        if not (path == '/' or re.fullmatch(r'/user/[a-z0-9_-]{3,20}/(?:upvoted|saved|downvoted|hidden|submitted|comments)/\?[^\s]*', path)
                or re.fullmatch(r'/(?:r/[A-Za-z0-9_]+/)?comments/[a-z0-9]+/[^?]*\?context=0', path)):
            raise RedditError('Unsupported Reddit read path.')
        if self.previous is not None:
            time.sleep(max(0, self.delay - (time.monotonic() - self.previous)))
        try:
            self.previous = time.monotonic()
            with self.http.get(ORIGIN + path, timeout=(10, 30), allow_redirects=False,
                               proxies={'http': self.proxy, 'https': self.proxy} if self.proxy else {}, stream=True) as response:
                if 300 <= response.status_code < 400:
                    raise RedditError('Reddit redirected the read; sign-in, consent, or a challenge may be required.')
                if response.status_code == 429:
                    raise RedditError('Reddit rate limit reached; retry later (no automatic retry).')
                if response.status_code in (404, 410):
                    raise Unavailable(f'Reddit explicitly returned HTTP {response.status_code}.')
                if response.status_code != 200:
                    raise RedditError(f'Reddit returned HTTP {response.status_code}; cached progress retained.')
                if 'text/html' not in response.headers.get('Content-Type', '').lower():
                    raise RedditError('Reddit did not return HTML; frontend or access conditions changed.')
                data = bytearray()
                for chunk in response.iter_content(65536):
                    data.extend(chunk)
                    if len(data) > 12_000_000:
                        raise RedditError('Reddit response exceeds the supported page size.')
                return data.decode('utf-8', errors='replace')
        except requests.RequestException:
            raise RedditError('Reddit network/proxy/TLS request failed; no direct fallback or automatic retry.') from None

    def account(self):
        _, account = document(self.read('/'))
        return {'id': account}

    def page(self, account, collection, cursor=None):
        if not ACCOUNT.fullmatch(account) or collection not in COLLECTIONS or (cursor and not ID.fullmatch(cursor)):
            raise RedditError('Invalid Reddit account, collection, or cursor.')
        query = {'limit': 100}
        if cursor:
            query['after'] = cursor
        return listing(self.read(f'/user/{account}/{collection}/?' + urlencode(query)), account, collection)

    def post(self, url, retrieved_at, account):
        identifier, canonical = source_url(url)
        return source(self.read(canonical[len(ORIGIN):] + '?context=0'), identifier, retrieved_at, account)
