"""Explicit local Chrome transport, with an isolated profile and no stealth overrides."""
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit, parse_qs

from api import HTMLClient, check_response, validate_path
from auth import DOMAINS
from pages import ORIGIN, RedditError, source_url

ASSET_HOSTS = {'old.reddit.com', 'www.redditstatic.com'}
ASSET_TYPES = {'stylesheet', 'script', 'image', 'font'}


class BrowserClient(HTMLClient):
    def __init__(self, cookies, root, proxy=None, delay=2.0, *, factory=None):
        if sys.platform != 'darwin' or proxy:
            raise RedditError('Local Chrome mode requires macOS and cannot use a proxy or the Cloud bridge.')
        if any(c.get('domain', '').lstrip('.') not in DOMAINS for c in cookies):
            raise RedditError('Refusing non-Reddit cookies in the isolated browser profile.')
        self.driver = self.context = None
        self.previous, self.delay = None, delay
        self.target = None
        self.navigation_blocked = False
        runtime = Path(root) / 'browser'
        (runtime / 'tmp').mkdir(parents=True, exist_ok=True, mode=0o700)
        if factory is None:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError:
                raise RedditError('Local Chrome support is not installed; run bash tools/reddit/setup.sh --browser.') from None
            factory = sync_playwright
        # The Playwright driver creates its Chrome temporary files below this
        # ignored directory. Restore the caller environment after driver startup.
        previous_tmp = os.environ.get('TMPDIR')
        try:
            os.environ['TMPDIR'] = str((runtime / 'tmp').resolve())
            self.driver = factory().start()
        finally:
            if previous_tmp is None:
                os.environ.pop('TMPDIR', None)
            else:
                os.environ['TMPDIR'] = previous_tmp
        try:
            self.context = self.driver.chromium.launch_persistent_context(
                str((runtime / 'profile').resolve()), channel='chrome', headless=False,
                chromium_sandbox=True, accept_downloads=False, ignore_https_errors=False,
                service_workers='block')
            self.context.add_cookies(cookies)
            self._page = self.context.pages[0] if self.context.pages else self.context.new_page()
            self.context.route('**/*', self._route)
        except Exception:
            self.close()
            raise RedditError('Could not start isolated local Chrome; check Chrome installation and close any previous collector browser.') from None

    def _route(self, route):
        request = route.request
        url = urlsplit(request.url)
        main = request.is_navigation_request() and request.frame == self._page.main_frame
        if main:
            allowed = request.method == 'GET' and request.url == self.target
            if not allowed and request.method == 'GET':
                try:
                    # Chrome can percent-encode a title slug or Reddit can
                    # canonicalize it. Keep the exact post/comment identity,
                    # origin and read-only query scope; never follow auth gates.
                    allowed = (url.scheme == 'https' and url.hostname == 'old.reddit.com'
                               and url.port in (None, 443) and not url.username and not url.password
                               and set(parse_qs(url.query, keep_blank_values=True)) <= {'context'}
                               and source_url(request.url)[0] == source_url(self.target)[0])
                except (ValueError, TypeError):
                    allowed = False
            if allowed:
                self.target = request.url
            if not allowed:
                self.navigation_blocked = True
        else:
            # No API mutations, analytics fetches, embedded pages or media loads.
            allowed = (request.method == 'GET' and url.scheme == 'https' and url.port in (None, 443)
                       and not url.username and not url.password and url.hostname in ASSET_HOSTS
                       and not url.path.startswith('/api/') and request.resource_type in ASSET_TYPES)

        if allowed:
            route.continue_()
        else:
            route.abort()

    def read(self, path):
        validate_path(path)
        if self.previous is not None:
            time.sleep(max(0, self.delay - (time.monotonic() - self.previous)))
        self.target, self.navigation_blocked = ORIGIN + path, False
        self.previous = time.monotonic()
        try:
            response = self._page.goto(self.target, wait_until='domcontentloaded', timeout=30000)
            if self.navigation_blocked or self._page.url != self.target:
                raise RedditError('Local Chrome encountered a redirect, login or challenge; no navigation fallback was attempted.')
            if response is None:
                raise RedditError('Local Chrome returned no Reddit document.')
            markup = self._page.content()
            data = markup.encode('utf-8')
            check_response(response.status, data[:262144])
            if 'text/html' not in response.headers.get('content-type', '').lower() or len(data) > 12_000_000:
                raise RedditError('Local Chrome returned an unsupported Reddit document.')
            return markup
        except RedditError:
            raise
        except Exception:
            if self.navigation_blocked:
                raise RedditError('Local Chrome encountered a redirect, login or challenge; no navigation fallback was attempted.') from None
            raise RedditError('Local Chrome could not read Reddit; no retry, challenge solving or route fallback was attempted.') from None

    def close(self):
        try:
            if self.context is not None:
                self.context.close()
        finally:
            self.context = None
            if self.driver is not None:
                self.driver.stop()
                self.driver = None
