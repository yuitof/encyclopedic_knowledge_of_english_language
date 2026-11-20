"""Cookie-authenticated Old Reddit reads through the fixed Workers relay."""
import json
import time

import requests

from api import HTMLClient, check_response, listing_query
from pages import ORIGIN, RedditError, json_account, json_listing, source, source_url

USER_AGENT = 'english-vault-personal-archive/1.0 (read-only Old Reddit client)'


class WorkersRelayClient(HTMLClient):
    def __init__(self, cookies, transport, delay=2.0):
        self.transport = transport
        self.delay, self.previous = delay, None
        self.account_id = None
        self.session = requests.Session()
        self.session.auth = lambda request: request
        self.session.trust_env = False
        for cookie in cookies:
            self.session.cookies.set(
                cookie['name'],
                cookie['value'],
                domain=cookie['domain'],
                path=cookie.get('path', '/'),
                secure=True,
            )

    def _headers(self, url, accept):
        from cloud_bridge.workers import prepared_headers
        return prepared_headers(
            self.session,
            url,
            {'User-Agent': USER_AGENT, 'Accept': accept},
        )

    def _relay(self, operation, parameters, url, accept):
        from cloud_bridge.workers import WorkersError, apply_origin_cookies
        if self.previous is not None:
            time.sleep(
                max(0, self.delay - (time.monotonic() - self.previous))
            )
        self.previous = time.monotonic()
        try:
            response = self.transport.relay(
                'reddit',
                operation,
                parameters,
                headers=self._headers(url, accept),
                url=url,
            )
        except WorkersError as error:
            raise RedditError(str(error)) from None
        check_response(response.status_code, response.content[:262144])
        apply_origin_cookies(self.session, response, url)
        return response

    def account(self):
        url = ORIGIN + '/api/me.json'
        response = self._relay('identity', {}, url, 'application/json')
        if 'application/json' not in response.content_type.lower():
            raise RedditError(
                'Reddit identity response was not JSON; access or frontend may have changed.'
            )
        try:
            payload = json.loads(response.text)
        except (ValueError, RecursionError):
            raise RedditError('Reddit identity response was invalid JSON.') from None
        self.account_id = json_account(payload)
        return {'id': self.account_id}

    def page(self, account, collection, cursor=None):
        if account != self.account_id:
            raise RedditError(
                'Reddit listing account differs from the verified identity.'
            )
        listing_query(account, collection, cursor)
        url = f'{ORIGIN}/user/{account}/{collection}.json'
        response = self._relay(
            'listing',
            {'account': account, 'collection': collection, 'after': cursor},
            url,
            'application/json',
        )
        if 'application/json' not in response.content_type.lower():
            raise RedditError(
                'Reddit listing response was not JSON; access or frontend may have changed.'
            )
        try:
            payload = json.loads(response.text)
        except (ValueError, RecursionError):
            raise RedditError('Reddit listing response was invalid JSON.') from None
        return json_listing(payload)

    def post(self, url, retrieved_at, account):
        identifier, canonical = source_url(url)
        response = self._relay(
            'comments',
            {'permalink': canonical},
            canonical,
            'text/html',
        )
        if 'text/html' not in response.content_type.lower():
            raise RedditError(
                'Reddit source response was not HTML; access or frontend may have changed.'
            )
        return source(response.text, identifier, retrieved_at, account)

    def close(self):
        self.session.close()
        self.transport.close()
