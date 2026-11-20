"""Access-protected Cloudflare Workers transport for supported collectors."""
from dataclasses import dataclass
from email.message import Message
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
from urllib.parse import unquote, urlsplit

import requests
from requests.cookies import MockRequest, MockResponse
from requests.structures import CaseInsensitiveDict

ROOT = Path(__file__).resolve().parents[2]
ACCESS_HEADERS = {
    'CF-Access-Client-Id': 'CF_ACCESS_CLIENT_ID',
    'CF-Access-Client-Secret': 'CF_ACCESS_CLIENT_SECRET',
}
RELAY_HEADERS = {
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
RELAY_OPERATIONS = {
    'x': {'home', 'graphql', 'asset'},
    'reddit': {'home', 'identity', 'listing', 'comments'},
}
WORKFLOWS = {
    'x': {
        'script': ROOT / 'tools/x/x.py',
        'commands': {'probe', 'refresh', 'get', 'folders'},
        'proxy': 'X_PROXY',
        'marker': 'X_TRANSPORT',
    },
    'reddit': {
        'script': ROOT / 'tools/reddit/reddit.py',
        'commands': {'probe', 'refresh', 'get', 'verify'},
        'proxy': 'REDDIT_PROXY',
        'marker': 'REDDIT_TRANSPORT',
    },
}
MAX_RESPONSE = 12_000_000
SYSTEM_TRUST_ENABLED = False


class WorkersError(ValueError):
    """A fixed diagnostic that never includes credentials or upstream bodies."""


def enable_system_trust():
    """Use the OS certificate store when truststore is installed."""
    global SYSTEM_TRUST_ENABLED
    if SYSTEM_TRUST_ENABLED:
        return
    try:
        import truststore
    except ImportError:
        return
    truststore.inject_into_ssl()
    SYSTEM_TRUST_ENABLED = True


def worker_origin(value):
    try:
        url = urlsplit(value)
        if (url.scheme != 'https' or not url.hostname
                or not re.fullmatch(r'(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*', url.hostname)
                or url.port not in (None, 443) or url.username is not None
                or url.password is not None or url.path not in ('', '/')
                or re.search(r'[\x00-\x20\x7f\\?#]', value)):
            raise ValueError
    except ValueError:
        raise WorkersError(
            'SERVICE_BRIDGE_WORKER_URL must be an HTTPS hostname on port 443.'
        ) from None
    return 'https://' + url.hostname


@dataclass
class RelayResponse:
    status_code: int
    content: bytes
    content_type: str
    url: str
    set_cookies: list[str]

    @property
    def headers(self):
        return CaseInsensitiveDict({'Content-Type': self.content_type})

    @property
    def text(self):
        return self.content.decode('utf-8', errors='replace')

    def json(self):
        return json.loads(self.text)

    def close(self):
        self.content = b''

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class WorkersTransport:
    """Small HTTPS client for the Worker's fixed read-only relay."""

    def __init__(self):
        enable_system_trust()
        self.origin = worker_origin(os.environ.get('SERVICE_BRIDGE_WORKER_URL', ''))
        self.access_headers = {
            header: os.environ.get(setting, '')
            for header, setting in ACCESS_HEADERS.items()
        }
        for header, setting in ACCESS_HEADERS.items():
            if not re.fullmatch(r'[!-~]+', self.access_headers[header]):
                raise WorkersError(
                    f'Set {setting} to a service-token value or Cloud HTTP-secret placeholder.'
                )
        self.session = requests.Session()
        self.session.auth = lambda request: request
        ca_bundle = os.environ.get('SSL_CERT_FILE')
        if not ca_bundle and sys.platform.startswith('linux'):
            ca_bundle = ssl.get_default_verify_paths().cafile
        if ca_bundle:
            self.session.verify = ca_bundle

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def close(self):
        self.session.close()

    def _send(self, method, path, **kwargs):
        self.session.cookies.clear()
        try:
            return self.session.request(
                method,
                self.origin + path,
                headers=self.access_headers,
                allow_redirects=False,
                timeout=(10, 55),
                **kwargs,
            )
        except requests.exceptions.ProxyError:
            raise WorkersError(
                'Worker HTTPS proxy connection failed before the Worker responded.'
            ) from None
        except requests.exceptions.SSLError:
            raise WorkersError('Worker HTTPS certificate verification failed.') from None
        except requests.RequestException:
            raise WorkersError('Worker HTTPS request failed.') from None

    def _checked(self, method, path, **kwargs):
        response = self._send(method, path, **kwargs)
        if (response.status_code == 200
                and response.headers.get('X-Bridge-Version') == '1'):
            return response
        reached_worker = response.headers.get('X-Bridge-Version') == '1'
        status = response.status_code
        response.close()
        if not reached_worker and (status in (401, 403) or 300 <= status < 400):
            raise WorkersError(
                f'Worker HTTPS endpoint returned HTTP {status} before the Worker ran. '
                'Check Cloudflare Access credentials and Cloud secret substitution.'
            )
        raise WorkersError(
            f'Worker HTTPS endpoint returned HTTP {status} without a successful bridge response.'
        )

    def health(self):
        with self._checked('GET', '/v1/health') as response:
            try:
                payload = response.json()
                if not isinstance(payload, dict) or payload.get('ok') is not True:
                    raise ValueError
            except ValueError:
                raise WorkersError('Invalid Worker health response.') from None

    def relay(self, service, operation, parameters, *, query='', headers=None, url=''):
        if service not in RELAY_OPERATIONS:
            raise WorkersError('Unsupported Worker relay service.')
        if operation not in RELAY_OPERATIONS[service]:
            raise WorkersError('Unsupported Worker relay operation.')
        if not isinstance(parameters, dict) or not isinstance(query, str):
            raise WorkersError('Invalid Worker relay envelope.')
        response = self._send(
            'POST',
            f'/v1/relay/{service}/{operation}',
            json={
                'parameters': parameters,
                'query': query,
                'headers': filtered_headers(headers or {}),
                'body': None,
            },
            stream=True,
        )
        try:
            if (response.status_code != 200
                    or response.headers.get('X-Bridge-Version') != '1'
                    or response.headers.get('X-Bridge-Response') != 'upstream'):
                status = response.status_code
                reached_worker = response.headers.get('X-Bridge-Version') == '1'
                if not reached_worker and (status in (401, 403) or 300 <= status < 400):
                    raise WorkersError(
                        f'Worker HTTPS endpoint returned HTTP {status} before the Worker ran. '
                        'Check Cloudflare Access credentials and Cloud secret substitution.'
                    )
                code = ''
                try:
                    error = json.loads(response.text)
                    candidate = error.get('error') if isinstance(error, dict) else ''
                    if isinstance(candidate, str) and re.fullmatch(r'[a-z0-9_]{1,64}', candidate):
                        code = candidate
                except ValueError:
                    pass
                detail = f': {code}' if code else ''
                raise WorkersError(f'Worker relay failed with HTTP {status}{detail}.')

            origin_status = response.headers.get('X-Origin-Http', '')
            if not re.fullmatch(r'[1-5][0-9]{2}', origin_status):
                raise WorkersError('Worker relay returned an invalid upstream status.')
            content = bytearray()
            try:
                for chunk in response.iter_content(65536):
                    content.extend(chunk)
                    if len(content) > MAX_RESPONSE:
                        raise WorkersError(
                            'Worker relay response exceeds the supported size.'
                        )
            except WorkersError:
                raise
            except requests.RequestException:
                raise WorkersError('Worker relay response stream failed.') from None
            set_cookies = [
                unquote(value.strip())
                for value in response.headers.get('X-Origin-Set-Cookie', '').split(',')
                if value.strip()
            ]
            return RelayResponse(
                status_code=int(origin_status),
                content=bytes(content),
                content_type=response.headers.get(
                    'Content-Type', 'application/octet-stream'
                ),
                url=url,
                set_cookies=set_cookies,
            )
        finally:
            response.close()


def filtered_headers(headers):
    return {
        name: value
        for name, value in headers.items()
        if name.lower() in RELAY_HEADERS
    }


def prepared_headers(session, url, headers=None):
    prepared = session.prepare_request(
        requests.Request('GET', url, headers=headers or {})
    )
    return filtered_headers(prepared.headers)


def apply_origin_cookies(session, response, url):
    if not response.set_cookies:
        return
    prepared = session.prepare_request(requests.Request('GET', url))
    message = Message()
    for value in response.set_cookies:
        message.add_header('Set-Cookie', value)
    session.cookies.extract_cookies(
        MockResponse(message), MockRequest(prepared)
    )


def _normalized_arguments(args):
    arguments = list(args.arguments)
    if arguments[:1] == ['--']:
        arguments = arguments[1:]
    command_arguments = arguments
    if arguments[:1] == ['--account']:
        if len(arguments) < 3:
            raise WorkersError(
                'Expected --account ID followed by a collector command.'
            )
        command_arguments = arguments[2:]
    if not command_arguments or command_arguments[0] not in WORKFLOWS[args.workflow]['commands']:
        raise WorkersError(
            'Use workers -- with a supported live command; cached and offline commands do not need a bridge.'
        )
    if args.workflow == 'reddit' and any(
        value in ('--direct-local', '--browser-local')
        for value in command_arguments
    ):
        raise WorkersError(
            'Local Reddit transports cannot be combined with the Workers transport.'
        )
    return arguments, command_arguments


def _probe(workflow):
    with WorkersTransport() as transport:
        transport.health()
        print(json.dumps({'workers_access': 'verified'}), flush=True)
        if workflow == 'x':
            headers = {
                'User-Agent': (
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/131.0.0.0 Safari/537.36'
                ),
                'Accept': 'text/html',
            }
            response = transport.relay(
                'x', 'home', {}, headers=headers, url='https://x.com/home'
            )
        else:
            headers = {
                'User-Agent': (
                    'english-vault-personal-archive/1.0 '
                    '(read-only Old Reddit client)'
                ),
                'Accept': 'text/html',
            }
            response = transport.relay(
                'reddit', 'home', {}, headers=headers,
                url='https://old.reddit.com/',
            )
        print(json.dumps({
            'workers_' + workflow + '_probe': {
                'url': response.url,
                'status': response.status_code,
            },
        }), flush=True)
        return 0 if 200 <= response.status_code < 400 else 1


def command(args, workflow):
    """Run one supported X or Reddit collector command through Workers."""
    if workflow not in WORKFLOWS:
        raise WorkersError('Unsupported Workers bridge workflow.')
    if getattr(args, 'offline', False):
        raise WorkersError('Offline commands do not use the Workers bridge.')
    args.workflow = workflow
    arguments, command_arguments = _normalized_arguments(args)
    if command_arguments[0] == 'probe':
        if len(command_arguments) != 1:
            raise WorkersError('The unsigned probe does not accept additional arguments.')
        return _probe(workflow)

    child_arguments = list(arguments)
    if args.account and child_arguments[:1] == ['--account']:
        raise WorkersError(
            'Select the X/Reddit account once, either before workers or after --.'
        )
    if args.account:
        child_arguments = ['--account', args.account, *child_arguments]
    environment = os.environ.copy()
    spec = WORKFLOWS[workflow]
    environment[spec['marker']] = 'workers'
    environment.pop(spec['proxy'], None)
    try:
        return subprocess.call(
            [sys.executable, str(spec['script']), *child_arguments],
            env=environment,
        )
    except OSError:
        raise WorkersError(
            'Could not start the collector process for the Workers transport.'
        ) from None
