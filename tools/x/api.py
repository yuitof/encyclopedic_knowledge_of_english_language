"""Read-only X web GraphQL client. Discover query IDs from the account's web build."""
import json
import re
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

READ_OPERATIONS = {'Viewer', 'Likes', 'Bookmarks', 'BookmarkFoldersSlice', 'BookmarkFolderTimeline',
                   'UserTweets', 'UserTweetsAndReplies', 'UserMedia', 'TweetResultByRestId'}
COLLECTIONS = {'likes': 'Likes', 'bookmarks': 'Bookmarks', 'posts': 'UserTweets',
               'replies': 'UserTweetsAndReplies', 'media': 'UserMedia'}
USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'


class XError(ValueError):
    pass


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def operations(source):
    result = {}
    pattern = r'queryId:"([-_A-Za-z0-9]+)",operationName:"([A-Za-z0-9_]+)",operationType:"query",metadata:\{featureSwitches:(\[[^\]]*\]),fieldToggles:(\[[^\]]*\])'
    for identifier, name, switches, toggles in re.findall(pattern, source):
        if name in READ_OPERATIONS:
            result[name] = {'query_id': identifier, 'switches': json.loads(switches), 'toggles': json.loads(toggles)}
    return result


def chunk_urls(source):
    """Read Webpack's name/hash tables as data; never evaluate site JavaScript."""
    pairs = re.findall(r'(\d+):"([^"\n]+)"', source)
    names = {key: value for key, value in pairs if value.startswith(('bundle.', 'shared~', 'ondemand.'))}
    hashes = {key: value for key, value in pairs if re.fullmatch(r'[a-f0-9]{8,32}', value)}
    return ['https://abs.twimg.com/responsive-web/client-web/' + name + '.' + hashes[key] + 'a.js'
            for key, name in names.items() if key in hashes and ('Bookmark' in name or name == 'ondemand.s')]


def initial_state(source):
    match = re.search(r'window\.__INITIAL_STATE__\s*=\s*', source)
    if not match:
        raise XError('X did not serve the supported authenticated web build; login, challenge, or frontend change. No empty result inferred.')
    try:
        data, _ = json.JSONDecoder().raw_decode(source[match.end():])
        return data
    except (ValueError, TypeError):
        raise XError('X initial state changed; API discovery needs updating.') from None


class Client:
    def __init__(self, cookies, root, atomic, proxy=None, workers_transport=None):
        self.root, self.atomic = root, atomic
        self.workers_transport = workers_transport
        self.http = requests.Session()
        if proxy and workers_transport is not None:
            self.http.close()
            raise XError('Select one explicit X transport.')
        if proxy:
            try:
                parsed = urlparse(proxy)
                if parsed.scheme not in ('http', 'https') or not parsed.hostname:
                    raise ValueError
                parsed.port
            except ValueError:
                self.http.close()
                raise XError('Invalid X proxy configuration.') from None
            self.http.proxies.update(http=proxy, https=proxy)
        self.http.headers.update({'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9'})
        for c in cookies:
            if c['domain'].lstrip('.') in ('x.com', 'www.x.com'):
                self.http.cookies.set(c['name'], c['value'], domain=c['domain'], path=c.get('path', '/'))
        csrf = [c['value'] for c in cookies if c['name'] == 'ct0' and c['domain'].lstrip('.') in ('x.com', 'www.x.com')]
        if not csrf:
            raise XError('No X-domain CSRF cookie; sign in at x.com and renew the session.')
        self.csrf = csrf[-1]
        self.ready = False

    def _workers_get(self, url, **kwargs):
        params = kwargs.pop('params', None)
        headers = kwargs.pop('headers', None)
        if kwargs:
            raise XError('Unsupported X Workers request option.')
        prepared = self.http.prepare_request(
            requests.Request('GET', url, params=params, headers=headers or {})
        )
        parsed = urlparse(prepared.url)
        if parsed.hostname == 'abs.twimg.com':
            operation = 'asset'
            parameters = {'asset': parsed.path.rsplit('/', 1)[-1]}
            query = ''
        elif parsed.hostname == 'x.com' and parsed.path == '/home':
            operation = 'home'
            parameters = {}
            query = ''
        elif parsed.hostname == 'x.com':
            match = re.fullmatch(
                r'/i/api/graphql/([-_A-Za-z0-9]+)/([A-Za-z0-9_]+)',
                parsed.path,
            )
            if match is None or match[2] not in READ_OPERATIONS:
                raise XError('Refusing unexpected X GraphQL operation.')
            operation = 'graphql'
            parameters = {
                'queryId': match[1],
                'operationName': match[2],
            }
            query = parsed.query
        else:
            raise XError('Refusing unexpected X Workers destination.')
        dispatch_headers = {
            name: value
            for name, value in prepared.headers.items()
            if name.lower() in {
                'accept',
                'accept-language',
                'authorization',
                'cookie',
                'referer',
                'user-agent',
                'x-client-transaction-id',
                'x-csrf-token',
                'x-twitter-active-user',
                'x-twitter-auth-type',
                'x-twitter-client-language',
            }
        }
        from cloud_bridge.workers import WorkersError, apply_origin_cookies
        try:
            response = self.workers_transport.relay(
                'x',
                operation,
                parameters,
                query=query,
                headers=dispatch_headers,
                url=url,
            )
        except WorkersError as error:
            raise XError(str(error)) from None
        if parsed.hostname == 'x.com':
            apply_origin_cookies(self.http, response, url)
        return response

    def get(self, url, **kwargs):
        parsed = urlparse(url)
        if (parsed.scheme != 'https' or parsed.hostname not in ('x.com', 'abs.twimg.com')
                or parsed.username or parsed.password or parsed.port not in (None, 443)):
            raise XError('Refusing unexpected X asset/API destination.')
        if self.workers_transport is not None:
            response = self._workers_get(url, **kwargs)
        else:
            try:
                response = self.http.get(url, timeout=(10, 45), allow_redirects=False,
                    **({'proxies': self.http.proxies} if self.http.proxies else {}), **kwargs)
            except requests.RequestException:
                raise XError('X network/TLS request failed; local progress retained. Retry later.') from None
        if response.status_code == 429:
            reset = response.headers.get('x-rate-limit-reset', '')
            reset = reset if reset.isdigit() else 'unknown'
            raise XError(f'X rate limit (429); reset epoch: {reset}. Resume later; no automatic retry loop.')
        if response.status_code in (301, 302, 303, 307, 308, 401, 403):
            raise XError(f'X login expired, access denied, or challenge (HTTP {response.status_code}); renew/check session normally.')
        if response.status_code != 200:
            raise XError(f'X HTTP {response.status_code}; endpoint may have changed. No empty result inferred.')
        return response

    def bootstrap(self):
        if self.ready:
            return
        home = self.get('https://x.com/home').text
        state = initial_state(home)
        self.account_id = str(state.get('session', {}).get('user_id', ''))
        if not re.fullmatch(r'[0-9]+', self.account_id):
            raise XError('No authenticated account identity in X home; renew session.')
        # The response may include session data. Retain no HTML or full state in the API manifest.
        config = state.get('featureSwitch', {})
        self.features = {}
        for values in (config.get('defaultConfig', {}), config.get('user', {}).get('config', {})):
            for name, value in values.items():
                value = value.get('value') if isinstance(value, dict) else value
                if isinstance(value, bool):
                    self.features[name] = value
        scripts = re.findall(r'https://abs\.twimg\.com/responsive-web/client-web/main\.[a-zA-Z0-9]+\.js', home)
        if not scripts:
            raise XError('Authenticated X web bundle changed; update discovery before collecting.')
        main = self.get(scripts[0]).text
        self.ops = operations(main)
        assets = chunk_urls(home)
        ondemand = None
        for url in assets:
            source = self.get(url).text
            self.ops.update(operations(source))
            if '/ondemand.s.' in url:
                ondemand = source
        bearer = re.search(r'AAAA[A-Za-z0-9%_-]{50,}', main)
        if not bearer or not ondemand:
            raise XError('X bearer/transaction assets changed; cannot initialize authenticated reads.')
        from x_client_transaction import ClientTransaction
        try:
            self.transaction = ClientTransaction(BeautifulSoup(home, 'html.parser'), ondemand)
        except Exception:
            raise XError('X transaction-header algorithm changed; update the pinned adapter. No challenge bypass attempted.') from None
        self.headers = {'Authorization': 'Bearer ' + bearer.group(), 'x-csrf-token': self.csrf,
                        'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes',
                        'x-twitter-client-language': 'en', 'Referer': 'https://x.com/'}
        self.atomic(self.root / 'api/operations.json', {'source': scripts[0], 'operations': self.ops})
        self.ready = True

    def query(self, operation, variables):
        if operation not in READ_OPERATIONS:
            raise XError('Only allowlisted read operations are supported.')
        self.bootstrap()
        spec = self.ops.get(operation)
        if not spec:
            raise XError(f'{operation} was not discovered in this X web build; no stale query ID used.')
        path = f'/i/api/graphql/{spec["query_id"]}/{operation}'
        headers = dict(self.headers)
        try:
            headers['x-client-transaction-id'] = self.transaction.generate_transaction_id(method='GET', path=path)
        except Exception:
            raise XError('Could not generate X transaction header; adapter needs updating.') from None
        toggles = {k: False for k in spec['toggles']}
        toggles.update({k: True for k in ('withArticleRichContentState', 'withArticlePlainText') if k in toggles})
        params = {'variables': json.dumps(variables, separators=(',', ':')),
                  'features': json.dumps({k: self.features.get(k, False) for k in spec['switches']}, separators=(',', ':')),
                  'fieldToggles': json.dumps(toggles, separators=(',', ':'))}
        response = self.get('https://x.com' + path, params=params, headers=headers)
        try:
            data = response.json()
        except ValueError:
            raise XError('X returned a non-JSON response; login/challenge or API change.') from None
        if not isinstance(data, dict):
            raise XError('Unexpected X JSON response.')
        errors = data.get('errors', [])
        if errors:
            codes = [e.get('code') for e in errors if isinstance(e, dict) and isinstance(e.get('code'), int)]
            if operation in ('BookmarkFoldersSlice', 'BookmarkFolderTimeline') and 37 in codes:
                raise XError('X has not authorized bookmark collections for this account (GraphQL 37).')
            raise XError(f'X {operation} GraphQL error codes {codes}; partial data is not treated as a complete page.')
        if not isinstance(data.get('data'), dict):
            raise XError('X response has no data object.')
        return data['data']

    def account(self):
        data = self.query('Viewer', {'withCommunitiesMemberships': False})
        user = data.get('viewer', {}).get('user_results', {}).get('result', {})
        identifier = user.get('rest_id')
        if identifier != self.account_id:
            raise XError('Viewer identity differs from authenticated home; refusing account cache mixing.')
        legacy, core = user.get('legacy', {}), user.get('core', {})
        return {'id': identifier, 'screen_name': core.get('screen_name') or legacy.get('screen_name', ''),
                'name': core.get('name') or legacy.get('name', '')}

    def page(self, collection, account_id, cursor=None, folder=None):
        variables = {'count': 100, 'includePromotedContent': False}
        if cursor:
            variables['cursor'] = cursor
        if folder:
            operation = 'BookmarkFolderTimeline'
            variables['bookmark_collection_id'] = folder
        else:
            operation = COLLECTIONS[collection]
        if operation in ('Likes', 'UserTweets', 'UserTweetsAndReplies', 'UserMedia'):
            variables.update(userId=account_id, withQuickPromoteEligibilityTweetFields=True, withVoice=True, withV2Timeline=True)
        return self.query(operation, variables)

    def post(self, identifier):
        return self.query('TweetResultByRestId', {'tweetId': identifier, 'withCommunity': True,
                          'includePromotedContent': False, 'withVoice': True})

    def close(self):
        self.http.close()
        if self.workers_transport is not None:
            self.workers_transport.close()
