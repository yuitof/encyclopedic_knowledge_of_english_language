#!/usr/bin/env python3
"""Private YouTube history and transcript search with optional durable S3 cache."""
import argparse
from datetime import date, datetime, timedelta, timezone
import html
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.codex/tmp/youtube'
ID = re.compile(r'[-_A-Za-z0-9]{11}\Z')
REMOTE_CACHE = None


def remote_cache():
    global REMOTE_CACHE
    if REMOTE_CACHE is not None:
        return REMOTE_CACHE
    config = CACHE / 's3-config.json'
    bucket = os.environ.get('YOUTUBE_CACHE_BUCKET')
    if not bucket and config.exists():
        bucket = json.loads(config.read_text()).get('bucket')
    if bucket:
        from s3_cache import S3Cache
        REMOTE_CACHE = S3Cache(bucket)
    return REMOTE_CACHE


def save_index(index):
    # Always retain local progress first, including when S3 is temporarily down.
    atomic_json(CACHE / 'history.json', index)
    remote = remote_cache()
    if remote:
        remote.save(index, CACHE, valid_transcript)
        atomic_json(CACHE / 'history.json', index)


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load_index():
    path = CACHE / 'history.json'
    data = json.loads(path.read_text()) if path.exists() else {'metadata': {}, 'videos': []}
    if not isinstance(data.get('videos'), list):
        raise ValueError('Invalid history index; refusing to replace it')
    remote = remote_cache()
    if remote:
        data = remote.restore(data)
        atomic_json(path, data)
    return data


def text(value):
    if isinstance(value, str):
        return value
    value = value or {}
    return value.get('content') or value.get('simpleText') or ''.join(r.get('text', '') for r in value.get('runs', []))


def heading_date(label, today):
    label = label.strip()
    if label in ('Today', 'Yesterday'):
        return today - timedelta(days=label == 'Yesterday')
    weekdays = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
    if label in weekdays:
        return today - timedelta(days=(today.weekday() - weekdays.index(label)) % 7 or 7)
    for fmt in ('%b %d, %Y', '%B %d, %Y', '%b %d', '%B %d'):
        try:
            parsed = datetime.strptime(label, fmt).date()
            if '%Y' not in fmt:
                parsed = parsed.replace(year=today.year)
                if parsed > today:
                    parsed = parsed.replace(year=today.year - 1)
            return parsed
        except ValueError:
            pass
    return None


def sections(payload):
    """Read history sections, including continuation responses; never recommendations."""
    if isinstance(payload, list):
        for value in payload:
            yield from sections(value)
    elif isinstance(payload, dict):
        if 'itemSectionRenderer' in payload:
            section = payload['itemSectionRenderer']
            header = section.get('header', {}).get('itemSectionHeaderRenderer', {})
            yield text(header.get('title')), section.get('contents', [])
        else:
            for value in payload.values():
                yield from sections(value)


def cards(payload):
    if isinstance(payload, list):
        for value in payload:
            yield from cards(value)
    elif isinstance(payload, dict):
        if 'videoRenderer' in payload:
            v = payload['videoRenderer']
            yield v.get('videoId'), text(v.get('title')), text(v.get('ownerText') or v.get('shortBylineText'))
        elif 'lockupViewModel' in payload:
            v = payload['lockupViewModel']
            m = v.get('metadata', {}).get('lockupMetadataViewModel', {})
            channel = ''
            for row in m.get('metadata', {}).get('contentMetadataViewModel', {}).get('metadataRows', []):
                if row.get('lockupContentMetadataRowExtension', {}).get('contentType') == 'METADATA_ROW_CONTENT_TYPE_BYLINE':
                    channel = text((row.get('metadataParts') or [{}])[0].get('text'))
            yield v.get('contentId'), text(m.get('title')), channel
        elif 'shortsLockupViewModel' in payload:
            v = payload['shortsLockupViewModel']
            identifier = v.get('onTap', {}).get('innertubeCommand', {}).get('reelWatchEndpoint', {}).get('videoId')
            yield identifier, text(v.get('overlayMetadata', {}).get('primaryText')), ''
        elif 'reelItemRenderer' in payload:
            v = payload['reelItemRenderer']
            yield v.get('videoId'), text(v.get('headline')), ''
        else:
            for value in payload.values():
                yield from cards(value)


def merge_observations(index, observations):
    videos = {v['video_id']: v for v in index['videos']}
    for item in observations:
        identifier = item['video_id']
        if not ID.fullmatch(identifier):
            raise ValueError('Invalid video ID')
        video = videos.setdefault(identifier, {
            'video_id': identifier, 'title': '', 'channel': None,
            'url': 'https://www.youtube.com/watch?v=' + identifier,
            'watched_at': [], 'watched_on': [], 'history_sources': [],
            'transcript': {'status': 'unchecked'},
        })
        for key in ('title', 'channel'):
            if item.get(key):
                video[key] = item[key]
        video['watched_on'] = sorted(set(video.get('watched_on', [])) | {item['watched_on']})
        source = 'YouTube account watch-history feed'
        if source not in video.setdefault('history_sources', []):
            video['history_sources'].append(source)
    index['videos'] = sorted(videos.values(), key=lambda v: max(v.get('watched_on', []) + v.get('watched_at', []), default=''), reverse=True)


def session_state():
    raw = os.environ.get('YOUTUBE_STORAGE_STATE_JSON')
    path = CACHE / 'auth/storage-state.json'
    if raw:
        data = json.loads(raw)
    elif path.exists():
        data = json.loads(path.read_text())
    else:
        raise ValueError('YouTube login missing. See docs/youtube-cloud.md; never put session cookies in Git or chat.')
    cookies = [c for c in data.get('cookies', []) if c.get('domain', '').lstrip('.') in ('youtube.com', 'www.youtube.com')]
    if not cookies:
        raise ValueError('No YouTube cookies in the configured session')
    return {'cookies': cookies, 'origins': []}


def convert_cookies(jar, flags, current_time):
    cookies = []
    for cookie in jar:
        if cookie.domain.lstrip('.') not in ('youtube.com', 'www.youtube.com'):
            continue
        if not cookie.value:
            continue
        key = (cookie.domain, cookie.name, cookie.path)
        # Preserve HttpOnly/SameSite from Chrome rather than guessing them.
        if key not in flags:
            raise ValueError('Cookie metadata changed during export; retry with the same Chrome profile')
        httponly, samesite, chrome_expires = flags[key]
        expires = chrome_expires / 1_000_000 - 11_644_473_600 if chrome_expires else -1
        if expires != -1 and expires <= current_time:
            continue
        converted = {'name': cookie.name, 'value': cookie.value, 'domain': cookie.domain,
            'path': cookie.path or '/', 'secure': bool(cookie.secure),
            'expires': expires, 'httpOnly': bool(httponly)}
        if samesite in (0, 1, 2):
            converted['sameSite'] = {0: 'None', 1: 'Lax', 2: 'Strict'}[samesite]
        cookies.append(converted)
    names = {c['name'] for c in cookies}
    if not cookies or not names.intersection({'SID', '__Secure-1PSID', '__Secure-3PSID'}):
        raise ValueError('No signed-in YouTube session found. Sign in normally at youtube.com in the selected Chrome profile first.')
    return {'cookies': cookies, 'origins': []}


def login(args):
    """Export an explicitly authorized local Chrome session; never automate Google sign-in."""
    if sys.platform != 'darwin':
        raise ValueError('This local Chrome exporter supports macOS. Supply the private session separately in Cloud.')
    if not re.fullmatch(r'Default|Profile [0-9]+', args.profile):
        raise ValueError('Use an explicit Chrome profile name: Default or Profile N')
    if not args.authorize_export:
        if not sys.stdin.isatty():
            raise ValueError('Export needs interactive consent or explicit --authorize-export')
        answer = input(f'Read Chrome {args.profile} cookies locally and save only YouTube cookies? [y/N] ')
        if answer.strip().lower() not in ('y', 'yes'):
            raise ValueError('Cookie export canceled; no session was saved')
    from yt_dlp.cookies import extract_cookies_from_browser
    base = Path.home() / 'Library/Application Support/Google/Chrome' / args.profile
    database = next((p for p in (base / 'Cookies', base / 'Network/Cookies') if p.exists()), None)
    if database is None:
        raise ValueError('Cookie database not found in the selected Chrome profile')
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=10) as connection:
        rows = connection.execute("SELECT host_key, name, path, is_httponly, samesite, expires_utc FROM cookies WHERE host_key IN ('.youtube.com', 'youtube.com', 'www.youtube.com', '.www.youtube.com')").fetchall()
    flags = {(domain, name, path): (httponly, samesite, expiry) for domain, name, path, httponly, samesite, expiry in rows}
    class QuietLogger:
        def debug(self, *args, **kwargs): pass
        def info(self, *args, **kwargs): pass
        def warning(self, *args, **kwargs): pass
        def error(self, *args, **kwargs): pass
    temporary = CACHE / 'auth/tmp'
    temporary.mkdir(parents=True, exist_ok=True)
    previous = tempfile.tempdir
    try:
        tempfile.tempdir = str(temporary)
        jar = extract_cookies_from_browser('chrome', profile=args.profile, logger=QuietLogger())
        state = convert_cookies(jar, flags, datetime.now(timezone.utc).timestamp())
    except ValueError:
        raise
    except Exception:
        raise ValueError('Chrome cookie export failed. Check the selected profile and approve the Keychain request yourself if prompted.') from None
    finally:
        tempfile.tempdir = previous
    atomic_json(CACHE / 'auth/storage-state.json', state)
    print('Saved private YouTube session under the ignored cache. No cookies were printed or uploaded.')


def refresh(args):
    from playwright.sync_api import sync_playwright
    tz = ZoneInfo(args.timezone)
    started = datetime.now(tz)
    index = load_index()
    # Initial 30-day window; subsequent refreshes overlap the last observed day.
    prior = index['metadata'].get('cloud_history', {})
    cutoff = date.fromisoformat(args.since) if args.since else started.date() - timedelta(days=30)
    if not args.since and prior.get('range_complete') and prior.get('timezone') == args.timezone:
        cutoff = date.fromisoformat(prior['coverage_end_date'])
    if cutoff > started.date():
        raise ValueError('History cutoff is in the future')
    observations, unknown = {}, set()
    oldest = None
    saw_section = False

    def consume(payload):
        nonlocal oldest, saw_section
        for label, contents in sections(payload):
            records = list(cards(contents))
            day = heading_date(label, started.date())
            if day is None:
                if records:
                    unknown.add(label or '(missing date heading)')
                continue
            saw_section = True
            oldest = min(oldest, day) if oldest else day
            if day < cutoff:
                continue
            for identifier, title, channel in records:
                if not identifier or not ID.fullmatch(identifier) or not title:
                    unknown.add('(unrecognized history card)')
                    continue
                observations[(identifier, str(day))] = {
                    'video_id': identifier, 'title': title, 'channel': channel,
                    'watched_on': str(day),
                }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state=session_state(), locale='en-GB', timezone_id=args.timezone)
        page = context.new_page()
        failures = []

        def response_received(response):
            if '/youtubei/v1/browse' in response.url:
                try:
                    if response.status != 200:
                        failures.append('History continuation HTTP failure')
                    else:
                        consume(response.json())
                except Exception:
                    failures.append('Could not parse history continuation')

        page.on('response', response_received)
        page.goto('https://www.youtube.com/feed/history?hl=en', wait_until='domcontentloaded', timeout=60000)
        page.wait_for_function('typeof ytInitialData !== "undefined"', timeout=30000)
        if not page.evaluate('Boolean(window.ytcfg && ytcfg.get("LOGGED_IN"))'):
            raise ValueError('YouTube session expired, blocked, or awaiting consent. Refresh the private session and retry.')
        consume(page.evaluate('ytInitialData'))
        complete = False
        stale = 0
        previous = None
        for _ in range(args.max_pages):
            complete = bool(saw_section and oldest and oldest < cutoff and not unknown and not failures)
            merge_observations(index, list(observations.values()))
            coverage = {
                'source_url': 'https://www.youtube.com/feed/history', 'timezone': args.timezone,
                'coverage_start_date': str(cutoff), 'coverage_end_date': str(started.date()),
                'updated_at': now(), 'range_complete': complete,
                'oldest_loaded_date': str(oldest) if oldest else None,
                'date_resolution': 'day', 'unparsed_headings': sorted(unknown),
                'errors': failures,
                'coverage_note': 'Account feed date headings; exact watch times and repeated watches within a day are not exposed. Older than cutoff must load before range is called complete.',
            }
            index['metadata']['cloud_history'] = coverage
            index['metadata']['updated_at'] = now()
            save_index(index)
            if complete:
                break
            state = (len(observations), oldest)
            stale = stale + 1 if state == previous else 0
            if stale >= 5:
                break
            previous = state
            page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
            page.wait_for_timeout(1500)
        browser.close()
    print(json.dumps(coverage))
    if not complete:
        raise ValueError('History coverage incomplete; gathered progress saved. Do not claim the requested range was exhausted.')


def valid_transcript(data, identifier):
    if data.get('video_id') != identifier or not data.get('language') or not isinstance(data.get('segments'), list) or not data['segments']:
        return False
    for seg in data['segments']:
        if not isinstance(seg, dict) or not isinstance(seg.get('text'), str):
            return False
        start = seg.get('start')
        if not isinstance(start, (int, float)) or not math.isfinite(start) or start < 0:
            return False
    return True


def read_transcript(video):
    state = video.get('transcript', {})
    if state.get('status') != 'cached':
        return None
    try:
        path = (CACHE / state['path']).resolve()
        if not path.is_relative_to((CACHE / 'transcripts').resolve()):
            raise ValueError('Unsafe transcript path')
        data = json.loads(path.read_text())
        if not valid_transcript(data, video['video_id']):
            raise ValueError('Invalid transcript')
        return data
    except (OSError, ValueError, KeyError, TypeError):
        remote = remote_cache()
        if remote:
            restored = remote.download(video, CACHE, valid_transcript, atomic_json)
            if restored is not None:
                return restored
        video['transcript'] = {'status': 'retry_needed', 'error': 'Missing or invalid cached transcript', 'attempted_at': now()}
        return None


def fetch(video, index, retry=False):
    data = read_transcript(video)
    if data is not None:
        return data
    state = video.get('transcript', {})
    invalid_cache = state.get('error') == 'Missing or invalid cached transcript'
    if state.get('status') == 'unavailable' or (state.get('status') == 'retry_needed' and not retry and not invalid_cache):
        return None
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled, VideoUnavailable
    from youtube_transcript_api.proxies import GenericProxyConfig
    from requests import Session
    class TimedSession(Session):
        def request(self, *args, **kwargs):
            kwargs.setdefault('timeout', 30)
            return super().request(*args, **kwargs)
    try:
        proxy = os.environ.get('YOUTUBE_TRANSCRIPT_PROXY')
        options = {'proxy_config': GenericProxyConfig(http_url=proxy, https_url=proxy)} if proxy else {}
        api = YouTubeTranscriptApi(http_client=TimedSession(), **options)
        tracks = [t for t in api.list(video['video_id']) if t.language_code.lower().split('-')[0] == 'en']
        if not tracks:
            video['transcript'] = {'status': 'unavailable', 'reason': 'No English caption track', 'checked_at': now()}
            return None
        track = sorted(tracks, key=lambda t: t.is_generated)[0]
        fetched = track.fetch()
        data = {
            'video_id': video['video_id'], 'language': fetched.language_code,
            'caption_type': 'automatic' if fetched.is_generated else 'manual',
            'retrieved_at': now(), 'source_url': video['url'],
            'retrieval_method': 'youtube-transcript-api', 'audio_verified': False,
            'segments': fetched.to_raw_data(),
        }
        if not valid_transcript(data, video['video_id']):
            raise ValueError('Invalid response')
        relative = f"transcripts/{video['video_id']}.{fetched.language_code}.json"
        atomic_json(CACHE / relative, data)
        # Read back before marking cached; transcript always lands before index.
        if not valid_transcript(json.loads((CACHE / relative).read_text()), video['video_id']):
            raise ValueError('Transcript read-back failed')
        video['transcript'] = {'status': 'cached', 'path': relative, 'language': data['language'], 'caption_type': data['caption_type'], 'retrieved_at': data['retrieved_at']}
        return data
    except (NoTranscriptFound, TranscriptsDisabled, VideoUnavailable) as error:
        video['transcript'] = {'status': 'unavailable', 'reason': type(error).__name__, 'checked_at': now()}
    except Exception as error:
        # Exception text can include proxy credentials or response bodies; store only type.
        video['transcript'] = {'status': 'retry_needed', 'error': type(error).__name__, 'attempted_at': now()}
    finally:
        save_index(index)
    return None


def selected(index, day):
    for video in index['videos']:
        # Account dates are kept separate from browser visits; no silent conflation.
        if day is None or day in video.get('watched_on', []):
            yield video


def matches(data, phrase):
    words = re.split(r'\s+', phrase.strip())
    pattern = re.compile(r'(?<!\w)' + r'\s+'.join(re.escape(w) for w in words) + r'(?!\w)', re.I)
    segments = data['segments']
    combined, offsets = '', []
    for segment in segments:
        offsets.append(len(combined))
        combined += html.unescape(segment['text']) + ' '
    for match in pattern.finditer(combined):
        first = max(i for i, offset in enumerate(offsets) if offset <= match.start())
        last = max(i for i, offset in enumerate(offsets) if offset < match.end())
        yield {'start': segments[first]['start'], 'matched_text': match.group(),
               'context_segments': segments[max(0, first - 3):last + 4]}


def search(args):
    index = load_index()
    tz = ZoneInfo(args.timezone)
    day = str(datetime.now(tz).date() - timedelta(days=1)) if args.day == 'yesterday' else args.day
    if day:
        date.fromisoformat(day)
    videos = list(selected(index, day))
    states, hits = {}, 0
    for video in videos:
        data = read_transcript(video)
        if data is None and args.fetch:
            data = fetch(video, index, args.retry)
        state = video.get('transcript', {}).get('status', 'unchecked')
        states[state] = states.get(state, 0) + 1
        if data:
            for hit in matches(data, args.phrase):
                hits += 1
                print(json.dumps({'video_id': video['video_id'], 'title': video['title'],
                                  'url': video['url'] + '&t=' + str(int(hit['start'])),
                                  'caption_type': data.get('caption_type'), 'audio_verified': data.get('audio_verified', False), **hit}, ensure_ascii=False))
    save_index(index)
    print(json.dumps({'summary': {'day': day, 'timezone': args.timezone, 'videos_in_scope': len(videos),
          'transcripts': states, 'matches': hits, 'history_coverage': index['metadata'].get('cloud_history'),
          'note': 'Matches are candidates. Inspect surrounding sentences and verify source before quoting.'}}))


def doctor(args):
    index = load_index()
    invalid = 0
    for video in index['videos']:
        state = video.get('transcript', {})
        if state.get('s3_key') and not (CACHE / state.get('path', '')).exists():
            continue  # Remote-only transcripts are downloaded when searched.
        if video.get('transcript', {}).get('status') == 'cached' and read_transcript(video) is None:
            invalid += 1
    atomic_json(CACHE / 'history.json', index)
    print(json.dumps({'history_videos': len(index['videos']), 'invalid_transcripts': invalid,
          'session_available': bool(os.environ.get('YOUTUBE_STORAGE_STATE_JSON') or (CACHE / 'auth/storage-state.json').exists()),
          'cache_scope': 'Private S3 cache shared across tasks' if remote_cache() else 'This workspace only; resume the same Cloud task.',
          'cloud_history': index['metadata'].get('cloud_history')}))


def sync(args):
    if not remote_cache():
        raise ValueError('Set YOUTUBE_CACHE_BUCKET or private .codex/tmp/youtube/s3-config.json first')
    index = load_index()
    save_index(index)
    print(json.dumps({'synced_videos': len(index['videos']), 'region': 'us-west-1',
                      'uploaded': 'history index and validated transcript JSON only; no sessions or tooling'}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('login', help='Local Mac only: export YouTube cookies after normal Chrome sign-in')
    p.add_argument('--profile', default='Default', help='Explicit authorized Chrome profile: Default or Profile N')
    p.add_argument('--authorize-export', action='store_true', help='Explicit consent to read this Chrome profile locally and save only its YouTube cookies')
    p.set_defaults(run=login)
    p = sub.add_parser('refresh', help='Refresh authenticated account history (no video playback)')
    p.add_argument('--since', help='YYYY-MM-DD; defaults to 30 days initially, then incremental')
    p.add_argument('--max-pages', type=int, default=100)
    p.add_argument('--timezone', default=os.environ.get('YOUTUBE_TIMEZONE', 'Europe/London'))
    p.set_defaults(run=refresh)
    p = sub.add_parser('search', help='Search cached transcripts; optionally fetch unchecked candidates')
    p.add_argument('phrase')
    p.add_argument('--day', help='YYYY-MM-DD or yesterday; omit for all indexed account dates')
    p.add_argument('--timezone', default=os.environ.get('YOUTUBE_TIMEZONE', 'Europe/London'))
    p.add_argument('--fetch', action='store_true')
    p.add_argument('--retry', action='store_true', help='Retry temporary failures; never retries confirmed unavailable captions')
    p.set_defaults(run=search)
    p = sub.add_parser('doctor', help='Check cache without network requests or credential output')
    p.set_defaults(run=doctor)
    p = sub.add_parser('sync', help='Merge S3 history and upload only validated cached transcripts; no YouTube calls')
    p.set_defaults(run=sync)
    args = parser.parse_args()
    if getattr(args, 'phrase', 'x').strip() == '':
        parser.error('Phrase must not be empty')
    if getattr(args, 'max_pages', 1) < 1:
        parser.error('--max-pages must be positive')
    try:
        args.run(args)
    except Exception as error:
        # Do not dump authenticated browser/network objects or secrets in logs.
        code = getattr(error, 'response', {}).get('Error', {}).get('Code')
        safe = str(error) if isinstance(error, (ValueError, ModuleNotFoundError)) else (code or 'See setup guide; workflow operation failed.')
        print(f'{type(error).__name__}: {safe}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
