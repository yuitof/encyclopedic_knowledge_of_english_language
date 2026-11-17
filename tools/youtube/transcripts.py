"""Signed-out English captions via InnerTube player and timedtext endpoints."""
import html
import json
import math
import re
import time
from urllib.parse import parse_qs, urlsplit

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
import requests

from innertube import ORIGIN, USER_AGENT

VIDEO_ID = re.compile(r'[-_A-Za-z0-9]{11}\Z')
# Android player responses currently expose caption URLs without web-player attestation.
PLAYER_CONTEXT = {'client': {'clientName': 'ANDROID', 'clientVersion': '20.10.38', 'hl': 'en'}}


class TranscriptUnavailable(Exception):
    """Confirmed absence, with a fixed safe reason for the private index."""
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


class TranscriptRetryNeeded(Exception):
    """Access or parsing failed; caption absence has not been established."""
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def seconds(value, scale=1):
    if isinstance(value, bool):
        raise ValueError
    result = float(value) / scale
    if not math.isfinite(result) or result < 0:
        raise ValueError
    return result


def caption_text(value):
    # XML/JSON may contain a second layer of HTML entities and formatting tags.
    return re.sub(r'<[^>]*>', '', html.unescape(value))


def parse_segments(source):
    """Preserve caption boundaries, timestamps and durations; never rewrite speech."""
    segments = []
    try:
        if source.lstrip().startswith('{'):
            data = json.loads(source)
            if not isinstance(data.get('events'), list):
                raise ValueError
            for event in data['events']:
                if 'segs' not in event:
                    continue  # JSON3 also carries screen-clear events.
                text = ''.join(part['utf8'] for part in event['segs'])
                if text:
                    segments.append({'start': seconds(event['tStartMs'], 1000),
                        'duration': seconds(event.get('dDurationMs', 0), 1000), 'text': caption_text(text)})
        else:
            root = ElementTree.fromstring(source)
            if root.tag == 'transcript':
                for item in root:
                    if item.tag != 'text':
                        raise ValueError
                    text = ''.join(item.itertext())
                    if text:
                        segments.append({'start': seconds(item.attrib['start']),
                            'duration': seconds(item.attrib.get('dur', 0)), 'text': caption_text(text)})
            elif root.tag == 'timedtext':
                body = root.find('body')
                if body is None:
                    raise ValueError
                for item in body:
                    if item.tag == 'w':
                        continue  # SRV3 window-position/style declarations carry no captions.
                    if item.tag != 'p':
                        raise ValueError
                    text = ''.join(item.itertext())
                    if text and not text.isspace():
                        segments.append({'start': seconds(item.attrib['t'], 1000),
                            'duration': seconds(item.attrib.get('d', 0), 1000), 'text': caption_text(text)})
            else:
                raise ValueError
        if not segments or any(not segment['text'] for segment in segments):
            raise ValueError
        return segments
    except (ValueError, KeyError, TypeError, AttributeError, ElementTree.ParseError, DefusedXmlException):
        raise TranscriptRetryNeeded('InvalidCaptionResponse') from None


def english_track(payload):
    try:
        if payload.get('error'):
            raise TranscriptRetryNeeded('InvalidPlayerResponse')
        status = payload['playabilityStatus']
        if status['status'] != 'OK':
            if status['status'] == 'ERROR' and status.get('reason') == 'This video is unavailable':
                raise TranscriptUnavailable('Video unavailable')
            raise TranscriptRetryNeeded('VideoAccessRestricted')
        captions = payload.get('captions', {}).get('playerCaptionsTracklistRenderer')
        if captions is None:
            raise TranscriptUnavailable('Captions disabled')
        tracks = captions['captionTracks']
        if not isinstance(tracks, list):
            raise ValueError
        if not tracks:
            raise TranscriptUnavailable('Captions disabled')
        if any(not isinstance(t, dict) or not isinstance(t.get('languageCode'), str)
               or not re.fullmatch(r'[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*', t['languageCode']) for t in tracks):
            raise ValueError
        english = [t for t in tracks if t['languageCode'].lower().split('-')[0] == 'en']
        if not english:
            raise TranscriptUnavailable('No English caption track')
        selected = min(english, key=lambda t: t.get('kind') == 'asr')
        if selected.get('kind') not in (None, 'asr') or not isinstance(selected.get('baseUrl'), str):
            raise ValueError
        return selected
    except (KeyError, TypeError, AttributeError, ValueError):
        raise TranscriptRetryNeeded('InvalidPlayerResponse') from None


def caption_url(url):
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or parsed.hostname not in ('www.youtube.com', 'youtube.com')
                or parsed.port not in (None, 443) or parsed.username or parsed.password
                or parsed.path != '/api/timedtext' or parsed.fragment):
            raise ValueError
        if 'xpe' in parse_qs(parsed.query).get('exp', []):
            raise TranscriptRetryNeeded('PoTokenRequired')
        return url
    except (ValueError, TypeError):
        raise TranscriptRetryNeeded('InvalidCaptionURL') from None


class TranscriptClient:
    def __init__(self, proxy=None):
        self.session = requests.Session()
        # An explicit no-op auth handler prevents ambient .netrc authentication.
        self.session.auth = lambda request: request
        self.session.headers.update({'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9'})
        if proxy:
            try:
                parsed = urlsplit(proxy)
                if parsed.scheme not in ('http', 'https') or not parsed.hostname:
                    raise ValueError
                parsed.port
            except ValueError:
                self.session.close()
                raise TranscriptRetryNeeded('InvalidTranscriptProxy') from None
            self.session.proxies.update(http=proxy, https=proxy)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.session.close()

    def _request(self, method, url, **kwargs):
        for attempt in range(3):
            try:
                # Explicit proxies override ambient proxy variables when supplied.
                response = self.session.request(method, url, timeout=(15, 30), allow_redirects=False,
                    **({'proxies': self.session.proxies} if self.session.proxies else {}), **kwargs)
            except requests.RequestException:
                if attempt == 2:
                    raise TranscriptRetryNeeded('CaptionNetworkFailure') from None
            else:
                if response.status_code == 200:
                    return response
                status = response.status_code
                response.close()
                if status not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise TranscriptRetryNeeded('CaptionHTTP' + str(status))
            time.sleep(0.5 * 2 ** attempt)

    def fetch(self, video_id):
        if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
            raise TranscriptRetryNeeded('InvalidVideoID')
        response = self._request('GET', ORIGIN + '/watch', params={'v': video_id, 'hl': 'en'})
        try:
            match = re.search(r'"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]+)"', response.text)
            if not match:
                raise TranscriptRetryNeeded('PlayerConfigurationMissing')
            api_key = match[1]
        finally:
            response.close()
        response = self._request('POST', ORIGIN + '/youtubei/v1/player', params={'key': api_key},
            json={'context': PLAYER_CONTEXT, 'videoId': video_id})
        try:
            try:
                payload = response.json()
            except ValueError:
                raise TranscriptRetryNeeded('InvalidPlayerResponse') from None
            track = english_track(payload)
        finally:
            response.close()
        response = self._request('GET', caption_url(track['baseUrl']))
        try:
            segments = parse_segments(response.text)
        finally:
            response.close()
        return {'language': track['languageCode'], 'caption_type': 'automatic' if track.get('kind') == 'asr' else 'manual',
                'segments': segments}
