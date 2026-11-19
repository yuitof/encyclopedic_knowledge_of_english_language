"""Opt-in client for the Access-protected, fixed-video Workers comparison API."""
from email.message import Message
import ipaddress
import os
import re
from urllib.parse import unquote, urlsplit

import requests
from requests.cookies import MockRequest, MockResponse

from transcripts import TranscriptClient, TranscriptRetryNeeded, TranscriptUnavailable

TEST_VIDEO = 'aircAruvnKk'
ROUTE = '/v1/signed-out-comparison/'
ACCESS_HEADERS = {
    'CF-Access-Client-Id': 'CF_ACCESS_CLIENT_ID',
    'CF-Access-Client-Secret': 'CF_ACCESS_CLIENT_SECRET',
}
ORIGIN_HEADERS = {'user-agent', 'accept-language', 'accept', 'content-type', 'cookie'}
OPERATIONS = {
    ('GET', '/watch'): 'watch',
    ('POST', '/youtubei/v1/player'): 'player',
    ('GET', '/api/timedtext'): 'timedtext',
}
YOUTUBE_HOSTS = {'www.youtube.com', 'youtube.com'}


class WorkersError(ValueError):
    """A diagnostic safe to show without dumping a request or response."""


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
        raise WorkersError('SERVICE_BRIDGE_WORKER_URL must be an HTTPS hostname on port 443.') from None
    return 'https://' + url.hostname


class WorkersTransport:
    def __init__(self):
        self.origin = worker_origin(os.environ.get('SERVICE_BRIDGE_WORKER_URL', ''))
        self.headers = {header: os.environ.get(key, '') for header, key in ACCESS_HEADERS.items()}
        for header, key in ACCESS_HEADERS.items():
            if not re.fullmatch(r'[!-~]+', self.headers[header]):
                raise WorkersError(f'Set {key} to a service-token value or Cloud HTTP-secret placeholder.')
        self.session = requests.Session()
        # Keep the configured HTTPS proxy and trust store for Cloud secret substitution.
        self.session.auth = lambda request: request

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.session.close()

    def request(self, method, path, **kwargs):
        self.session.cookies.clear()
        try:
            response = self.session.request(method, self.origin + path, headers=self.headers,
                                            allow_redirects=False, timeout=(10, 45), **kwargs)
        except requests.exceptions.ProxyError:
            raise WorkersError('Worker HTTPS proxy connection failed before the Worker responded.') from None
        except requests.exceptions.SSLError:
            raise WorkersError('Worker HTTPS certificate verification failed.') from None
        except requests.RequestException:
            raise WorkersError('Worker HTTPS request failed.') from None

        status = response.status_code
        if status == 200 and response.headers.get('X-Bridge-Version') == '1':
            return response
        reached_worker = response.headers.get('X-Bridge-Version') == '1'
        response.close()
        if not reached_worker and (status in (401, 403) or 300 <= status < 400):
            raise WorkersError(f'Worker HTTPS endpoint returned HTTP {status} before the Worker ran. '
                               'Check Cloudflare Access credentials and Cloud secret substitution.')
        raise WorkersError(f'Worker HTTPS endpoint returned HTTP {status} without a successful bridge response.')

    def probe(self):
        with self.request('GET', '/v1/health') as response:
            try:
                health = response.json()
                if not isinstance(health, dict) or health.get('ok') is not True:
                    raise ValueError
            except ValueError:
                raise WorkersError('Invalid Worker health response.') from None
        print('Worker HTTPS and Cloudflare Access verified.', flush=True)
        with self.request('GET', ROUTE + 'ip') as response:
            try:
                payload = response.json()
                if payload['status'] != 200 or not isinstance(payload['ip'], str):
                    raise ValueError
                address = ipaddress.ip_address(payload['ip'])
                if not address.is_global:
                    raise ValueError
            except (ValueError, KeyError, TypeError):
                raise WorkersError('Worker did not return a successful Gateway public-IP observation.') from None
        print(f'Gateway egress IP: {address}')


class WorkersCaptionClient(TranscriptClient):
    def __init__(self, transport):
        super().__init__()
        self.transport = transport

    def fetch(self, video_id):
        if video_id != TEST_VIDEO:
            raise WorkersError('The Workers comparison API supports only its public test video.')
        self.session.cookies.clear()
        return super().fetch(video_id)

    def _request(self, method, url, **kwargs):
        prepared = self.session.prepare_request(requests.Request(method, url, **kwargs))
        origin = urlsplit(prepared.url)
        stage = OPERATIONS.get((method, origin.path))
        if (stage is None or origin.scheme != 'https' or origin.hostname not in YOUTUBE_HOSTS
                or origin.port not in (None, 443) or origin.username is not None
                or origin.password is not None or origin.fragment):
            raise WorkersError('Unexpected origin for the Workers comparison API.')

        body = prepared.body
        response = self.transport.request('POST', ROUTE + stage, json={
            'headers': {key: value for key, value in prepared.headers.items() if key.lower() in ORIGIN_HEADERS},
            'search': origin.query,
            'host': origin.hostname,
            'body': body.decode('utf-8') if isinstance(body, bytes) else body,
        })
        status = response.headers.get('X-Origin-Http', '')
        if status != '200':
            response.close()
            if not re.fullmatch(r'[1-5][0-9]{2}', status):
                raise WorkersError(f'Invalid upstream status at {stage}.')
            raise WorkersError(f'YouTube returned HTTP {status} at {stage}.')

        # The worker returns UTF-8 text and percent-encoded YouTube guest cookies.
        # Apply those cookies against the original YouTube URL, never the Worker.
        response.encoding = 'utf-8'
        cookies = Message()
        encoded = response.headers.get('X-Origin-Set-Cookie')
        if encoded:
            for value in encoded.split(','):
                cookies.add_header('Set-Cookie', unquote(value.strip()))
            self.session.cookies.extract_cookies(MockResponse(cookies), MockRequest(prepared))
        return response


def run(args):
    with WorkersTransport() as transport:
        if args.operation == 'probe':
            transport.probe()
            return
        with WorkersCaptionClient(transport) as client:
            try:
                result = client.fetch(TEST_VIDEO)
            except (TranscriptRetryNeeded, TranscriptUnavailable) as error:
                raise WorkersError(f'YouTube caption test failed: {error.reason}.') from None
        if result['caption_type'] != 'manual':
            raise WorkersError('YouTube returned automatic captions. The test requires a manual English track.')
        print(f'Verified {len(result["segments"])} manual English caption segments ({result["language"]}).')
