"""Read-only YouTube history transport. Session data never leaves youtube.com."""
import copy
from datetime import datetime
import hashlib
import json
import re
import time
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit

import requests

ORIGIN = 'https://www.youtube.com'
HISTORY_URL = ORIGIN + '/feed/history?hl=en'
BROWSE_PATH = '/youtubei/v1/browse'
USER_AGENT = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
              'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')


class HistoryError(ValueError):
    """Only fixed, credential-free diagnostics may be surfaced to the CLI."""


def bootstrap_config(source):
    config = {}
    decoder = json.JSONDecoder()
    for match in re.finditer(r'ytcfg\.set\(\s*', source):
        try:
            value, _ = decoder.raw_decode(source[match.end():])
        except ValueError:
            continue
        if isinstance(value, dict):
            config.update(value)
    if not config:
        raise HistoryError('YouTube client configuration missing; access may be blocked or awaiting consent')
    if config.get('LOGGED_IN') is not True:
        raise HistoryError('YouTube session expired or signed out; renew the private session with login')
    context = config.get('INNERTUBE_CONTEXT')
    client = context.get('client') if isinstance(context, dict) else None
    if not isinstance(client, dict) or not client.get('clientVersion') or client.get('clientName') != 'WEB':
        raise HistoryError('Unrecognized YouTube web client configuration')
    return config


def history_items(payload):
    """Accept only the selected history body or a single continuation body."""
    try:
        if 'contents' in payload:
            tabs = payload['contents']['twoColumnBrowseResultsRenderer']['tabs']
            selected = [t['tabRenderer'] for t in tabs if t.get('tabRenderer', {}).get('selected')]
            if len(selected) != 1:
                raise HistoryError('Ambiguous YouTube history tab')
            items = selected[0]['content']['sectionListRenderer']['contents']
        else:
            batches = []
            for key in ('onResponseReceivedActions', 'onResponseReceivedEndpoints', 'onResponseReceivedCommands'):
                for action in payload.get(key, []):
                    for name in ('appendContinuationItemsAction', 'reloadContinuationItemsCommand'):
                        if name in action:
                            batches.append(action[name]['continuationItems'])
            if len(batches) != 1:
                raise HistoryError('Missing or ambiguous YouTube history continuation body')
            items = batches[0]
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise TypeError
        return items
    except (KeyError, TypeError, AttributeError):
        raise HistoryError('Unrecognized YouTube history response structure') from None


def continuation_token(items):
    tokens = set()

    def walk(value):
        if isinstance(value, list):
            for child in value:
                walk(child)
        elif isinstance(value, dict):
            if 'continuationItemRenderer' in value:
                endpoint = value['continuationItemRenderer'].get('continuationEndpoint', {})
                path = endpoint.get('commandMetadata', {}).get('webCommandMetadata', {}).get('apiUrl', BROWSE_PATH)
                token = endpoint.get('continuationCommand', {}).get('token')
                if path != BROWSE_PATH or not isinstance(token, str) or not token:
                    raise HistoryError('Unrecognized YouTube history continuation endpoint')
                tokens.add(token)
            elif 'continuationItemView' in value:
                raise HistoryError('Unrecognized YouTube history continuation format')
            else:
                for key, child in value.items():
                    if key not in ('header', 'menu', 'secondaryContents'):
                        walk(child)

    try:
        walk(items)
    except (AttributeError, TypeError):
        raise HistoryError('Unrecognized YouTube history continuation structure') from None
    if len(tokens) > 1:
        raise HistoryError('Ambiguous YouTube history continuation tokens')
    return next(iter(tokens), None)


class HistoryClient:
    def __init__(self, state, timezone, proxy=None):
        self.timezone = timezone
        self.session = requests.Session()
        if proxy:
            try:
                parsed = urlsplit(proxy)
                if parsed.scheme not in ('http', 'https') or not parsed.hostname:
                    raise ValueError
                parsed.port
            except ValueError:
                self.session.close()
                raise HistoryError('Invalid history proxy configuration') from None
            self.session.proxies.update(http=proxy, https=proxy)
        self.session.headers.update({'User-Agent': USER_AGENT, 'Accept-Language': 'en-GB,en;q=0.9'})
        for cookie in state['cookies']:
            if cookie.get('domain', '').lstrip('.') not in ('youtube.com', 'www.youtube.com'):
                continue
            expires = cookie.get('expires', -1)
            if expires != -1 and expires <= time.time():
                continue
            self.session.cookies.set(cookie['name'], cookie['value'], domain=cookie['domain'],
                path=cookie.get('path', '/'), secure=cookie.get('secure', True),
                expires=None if expires == -1 else int(expires))

    def __enter__(self):
        try:
            response = self._request('GET', HISTORY_URL)
            try:
                config = bootstrap_config(response.text)
            finally:
                response.close()
            self.context = copy.deepcopy(config['INNERTUBE_CONTEXT'])
            client = self.context['client']
            client.update(hl='en', timeZone=self.timezone,
                utcOffsetMinutes=int(datetime.now(ZoneInfo(self.timezone)).utcoffset().total_seconds() / 60))
            self.api_key = config.get('INNERTUBE_API_KEY')
            self.session.headers.update({'Origin': ORIGIN, 'X-Origin': ORIGIN, 'Referer': HISTORY_URL,
                'X-Goog-Authuser': str(config.get('SESSION_INDEX', 0)),
                'X-Youtube-Client-Name': str(config.get('INNERTUBE_CONTEXT_CLIENT_NAME', 1)),
                'X-Youtube-Client-Version': client['clientVersion'],
                'X-Goog-Visitor-Id': client.get('visitorData', '')})
            if config.get('DELEGATED_SESSION_ID'):
                self.session.headers['X-Goog-PageId'] = config['DELEGATED_SESSION_ID']
            return self
        except Exception:
            self.session.close()
            raise

    def __exit__(self, *args):
        self.session.close()

    def _authorize(self):
        # Scope cookie lookup to the actual destination, honoring path and expiry.
        prepared = self.session.prepare_request(requests.Request('POST', ORIGIN + BROWSE_PATH))
        cookies = dict(re.findall(r'(?:^|;\s*)([^=;]+)=([^;]*)', prepared.headers.get('Cookie', '')))
        sid = cookies.get('SAPISID') or cookies.get('__Secure-3PAPISID')
        if not sid:
            raise HistoryError('YouTube authorization cookie missing or expired; renew the private session with login')
        stamp = str(int(time.time()))
        digest = hashlib.sha1(f'{stamp} {sid} {ORIGIN}'.encode()).hexdigest()
        self.session.headers['Authorization'] = f'SAPISIDHASH {stamp}_{digest}'

    def _request(self, method, url, **kwargs):
        for attempt in range(3):
            if method == 'POST':
                self._authorize()
            try:
                response = self.session.request(method, url, timeout=(15, 45), allow_redirects=False,
                    **({'proxies': self.session.proxies} if self.session.proxies else {}), **kwargs)
            except requests.RequestException:
                if attempt == 2:
                    raise HistoryError('YouTube network request failed after 3 attempts; check connectivity or proxy access') from None
            else:
                if response.status_code == 200:
                    return response
                status = response.status_code
                response.close()
                if status not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise HistoryError(f'YouTube history HTTP {status}; session, consent, rate limit, or network access may need attention')
            time.sleep(0.5 * 2 ** attempt)

    def browse(self, token=None):
        body = {'context': self.context, **({'continuation': token} if token else {'browseId': 'FEhistory'})}
        response = self._request('POST', ORIGIN + BROWSE_PATH,
            params={'prettyPrint': 'false', **({'key': self.api_key} if self.api_key else {})}, json=body)
        try:
            payload = response.json()
            if not isinstance(payload, dict) or payload.get('error'):
                raise HistoryError('YouTube history API returned an error or invalid response')
            if payload.get('responseContext', {}).get('mainAppWebResponseContext', {}).get('loggedOut') is not False:
                raise HistoryError('YouTube history authentication could not be verified; renew the private session with login')
            return payload
        except (ValueError, TypeError, AttributeError) as error:
            if isinstance(error, HistoryError):
                raise
            raise HistoryError('YouTube history API returned invalid JSON or response structure') from None
        finally:
            response.close()
