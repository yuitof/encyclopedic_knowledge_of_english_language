#!/usr/bin/env python3
"""Private X collections and cache-first post search. All X operations are reads."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import sys
import time

from api import Client, COLLECTIONS, XError, walk
from auth import state, login
from cache import Cache, ID, atomic_json, now, union
from posts import embedded_posts, post_id, timeline

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.codex/tmp/x'


def emit(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def bucket():
    config = CACHE / 's3-config.json'
    return os.environ.get('X_CACHE_BUCKET') or (json.loads(config.read_text()).get('bucket') if config.exists() else None)


def remote(args):
    if args.offline or not bucket():
        return None
    from s3_cache import S3Cache
    return S3Cache(bucket())


def selected_account(args):
    identifier = args.account or os.environ.get('X_ACCOUNT_ID')
    if not identifier and (CACHE / 'account.json').exists():
        identifier = json.loads((CACHE / 'account.json').read_text()).get('id')
    if not isinstance(identifier, str) or not ID.fullmatch(identifier):
        raise ValueError('No selected account. Run refresh online, or set --account/X_ACCOUNT_ID for an existing private archive.')
    return identifier


def authenticated(args):
    if args.offline:
        raise ValueError('This operation needs X access; omit --offline.')
    client = Client(state(CACHE), CACHE, atomic_json, proxy=os.environ.get('X_PROXY'))
    account = client.account()
    expected = args.account or os.environ.get('X_ACCOUNT_ID')
    if expected and account['id'] != expected:
        raise ValueError('Signed-in X identity differs from --account/X_ACCOUNT_ID; refusing cache mixing.')
    atomic_json(CACHE / 'account.json', account)
    return client, account


def cache_for(args, identifier=None):
    return Cache(CACHE, identifier or selected_account(args), remote(args))


@contextmanager
def lock():
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (CACHE / 'workflow.lock').open('a') as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another X workflow command is running; use one command at a time.') from None
        try:
            yield
        finally:
            fcntl.flock(file, fcntl.LOCK_UN)


def refresh(args):
    if args.max_pages is not None and args.max_pages < 1:
        raise ValueError('--max-pages must be positive.')
    if args.delay < 0:
        raise ValueError('--delay must be nonnegative.')
    if args.folder and (not ID.fullmatch(args.folder) or args.collections != ['bookmarks']):
        raise ValueError('--folder needs a numeric folder ID and --collections bookmarks.')
    client, account = authenticated(args)
    cache = cache_for(args, account['id'])
    summaries, failures = [], []
    for name in args.collections:
        key = 'folder-' + args.folder if args.folder else name
        collection = cache.index['collections'].setdefault(key, {'post_ids': []})
        previous = collection.get('scan', {})
        if args.resume:
            if previous.get('status') != 'partial' or not previous.get('cursor'):
                raise ValueError(f'{key} has no resumable scan; start a fresh refresh.')
            scan = previous
            scan.update(reason='in_progress', updated_at=now())
        else:
            scan = {'started_at': now(), 'updated_at': now(), 'pages': 0, 'status': 'partial',
                    'reason': 'in_progress', 'cursor': None, 'post_ids': [], 'unavailable_ids': []}
        collection['scan'] = scan
        cursor, seen_cursors, pages_this_run = scan['cursor'], set(), 0
        cache.save_local()
        try:
            while True:
                page = timeline(client.page(name, account['id'], cursor, args.folder), now())
                # Save each source once before publishing the page's memberships or continuation.
                for post in page['posts'].values():
                    existing = cache.get(post['id'])
                    if not existing:
                        cache.put(post, checkpoint=False)
                scan['post_ids'] = union(scan['post_ids'], page['members'])
                scan['unavailable_ids'] = union(scan['unavailable_ids'], page['unavailable'])
                collection['post_ids'] = union(collection['post_ids'], page['members'])
                scan['pages'] += 1
                pages_this_run += 1
                next_cursor = page['cursor']
                scan.update(cursor=next_cursor, updated_at=now())
                if not next_cursor or page['cursor_only']:
                    scan.update(status='reachable_end', reason='X returned a cursor-only terminal page' if next_cursor else 'X returned no bottom continuation')
                    collection['latest_post_ids'] = list(scan['post_ids'])
                    collection['last_completed_at'] = now()
                elif next_cursor == cursor or next_cursor in seen_cursors:
                    scan.update(status='partial', reason='repeated_cursor')
                elif args.max_pages and pages_this_run >= args.max_pages:
                    scan.update(status='partial', reason='requested_page_limit')
                cache.save()
                # save() can merge in concurrent remote membership observations.
                collection = cache.index['collections'][key]
                scan = collection['scan']
                if scan['status'] == 'reachable_end' or scan.get('reason') in ('repeated_cursor', 'requested_page_limit'):
                    break
                seen_cursors.add(next_cursor)
                cursor = next_cursor
                if args.delay:
                    time.sleep(args.delay)
        except Exception as error:
            scan.update(status='partial', reason=str(error) if isinstance(error, ValueError) else 'X or S3 request failed; local progress retained', updated_at=now())
            cache.save_local()
            failures.append(key)
        summaries.append({'collection': key, 'archived_posts': len(collection['post_ids']),
                          'scan_posts': len(scan['post_ids']), 'pages': scan['pages'], 'status': scan['status'], 'reason': scan['reason']})
    emit({'collections': summaries, 'persistence': 's3' if cache.remote else 'local',
          'coverage': 'Only posts exposed by the API; reachable_end does not prove lifetime completeness.'})
    return 1 if failures or any(s['status'] == 'partial' and s['reason'] != 'requested_page_limit' for s in summaries) else 0


def get_post(args):
    identifier = post_id(args.post)
    client = None
    try:
        account = selected_account(args)
    except ValueError:
        if args.offline:
            raise
        client, identity = authenticated(args)
        account = identity['id']
    cache = cache_for(args, account)
    post = cache.get(identifier)
    if post and not args.refresh:
        emit(post)
        return
    if args.offline:
        raise ValueError('Post missing locally, or explicit refresh requested in offline mode.')
    previous = cache.index['posts'].get(identifier, {})
    if previous.get('status') == 'unavailable' and not args.refresh:
        raise ValueError('Post was unavailable at the last check; use --refresh for an explicit retry.')
    if client is None:
        client, identity = authenticated(args)
        if identity['id'] != account:
            raise ValueError('Authenticated account differs from the selected cache; refusing cache mixing.')
    try:
        data = client.post(identifier)
        posts = embedded_posts(data, now())
        for item in posts.values():
            if item['id'] == identifier or not cache.get(item['id']):
                cache.put(item, checkpoint=False)
        if identifier not in posts:
            # An absent result or schema change cannot establish deletion.
            result = data.get('tweetResult', {}).get('result', {})
            unavailable = result.get('__typename') in ('TweetTombstone', 'TweetUnavailable')
            if not post:
                cache.index['posts'][identifier] = {'status': 'unavailable' if unavailable else 'retry_needed',
                    'checked_at': now(), 'error': 'X explicitly reported unavailable' if unavailable else 'No usable post; access or schema may have changed'}
            cache.save()
            raise ValueError('X returned no usable post; existing cached content retained.')
        cache.save()
        emit(posts[identifier])
    except Exception as e:
        if identifier not in cache.index['posts']:
            cache.index['posts'][identifier] = {'status': 'retry_needed', 'checked_at': now(), 'error': 'X request failed'}
        cache.save_local()
        if isinstance(e, ValueError):
            raise
        raise ValueError('X/S3 request failed; local post progress retained. Retry sync if needed.') from None


def search(args):
    cache = cache_for(args)
    ids = candidates(cache, args.collection, args.latest)
    needle = ' '.join(args.phrase.casefold().split())
    if not needle:
        raise ValueError('Search phrase must not be empty.')
    matches, missing = [], 0
    for identifier in ids:
        post = cache.get(identifier)
        if not post:
            missing += 1
            continue
        if needle in ' '.join(post['text'].casefold().split()):
            matches.append(post)
    emit({'matches': matches, 'selected_posts': len(ids), 'missing_posts': missing,
          'collections': cache.index['collections'] if args.coverage else {k: {'status': v.get('scan', {}).get('status'), 'reason': v.get('scan', {}).get('reason')} for k, v in cache.index['collections'].items()},
          'scope': 'Cached source text only; no X requests. Missing/incomplete coverage is not evidence of absence.'})


def candidates(cache, collection=None, latest=False):
    if collection:
        if collection not in cache.index['collections']:
            raise ValueError('Collection has not been collected for this account.')
        data = cache.index['collections'][collection]
        if latest and not data.get('last_completed_at'):
            raise ValueError('No completed reachable snapshot for this collection.')
        return data.get('latest_post_ids' if latest else 'post_ids', [])
    if latest:
        raise ValueError('--latest requires --collection.')
    return list(cache.index['posts'])


def listing(args):
    cache = cache_for(args)
    ids = candidates(cache, args.collection, args.latest)
    emit({'post_ids': ids, 'collections': cache.index['collections'], 'folders': cache.index['folders']})


def folders(args):
    if not args.refresh:
        emit(cache_for(args).index['folders'])
        return
    client, account = authenticated(args)
    cache = cache_for(args, account['id'])
    # Folder response schema/cursor is intentionally separate from tweet timelines.
    cursor, seen = None, set()
    while True:
        variables = {'cursor': cursor} if cursor else {}
        data = client.query('BookmarkFoldersSlice', variables)
        slices = [d['bookmark_collections_slice'] for d in walk(data)
                  if isinstance(d.get('bookmark_collections_slice'), dict)
                  and isinstance(d['bookmark_collections_slice'].get('items'), list)]
        if not slices:
            raise XError('Bookmark folder schema changed or folders unavailable; no empty list inferred.')
        for part in slices:
            for folder in part['items']:
                identifier = str(folder.get('id', ''))
                if ID.fullmatch(identifier):
                    cache.index['folders'][identifier] = {'id': identifier, 'name': folder.get('name', ''), 'retrieved_at': now()}
        next_cursor = next((d.get('slice_info', {}).get('next_cursor') for d in slices
                            if d.get('slice_info', {}).get('next_cursor')), None)
        cache.save()
        if not next_cursor:
            break
        if next_cursor == cursor or next_cursor in seen:
            raise XError('Repeated folder cursor; cached progress retained, coverage incomplete.')
        seen.add(next_cursor)
        cursor = next_cursor
        time.sleep(1)
    emit(cache.index['folders'])


def doctor(args):
    try:
        state(CACHE)
        session = True
    except (ValueError, OSError):
        session = False
    emit({'cache': str(CACHE), 'persistence': 's3' if bucket() else 'local', 'region': 'us-west-1' if bucket() else None,
          'session_available': session, 'note': 'Configuration check only; no live X or AWS requests.'})


def sync(args):
    if args.offline or not bucket():
        raise ValueError('Sync needs X_CACHE_BUCKET or private s3-config.json, and no --offline.')
    cache = cache_for(args)
    cache.save()
    emit({'synced': True, 'posts': len(cache.index['posts']), 'persistence': 's3'})


def service_bridge(args):
    if args.offline:
        raise ValueError('Offline commands do not use the bridge.')
    sys.path.insert(0, str(ROOT / 'tools'))
    from cloud_bridge.client import command
    from cloud_bridge.transport import BridgeError
    if args.account:
        arguments = list(args.arguments)
        if arguments[:1] == ['--']:
            arguments = arguments[1:]
        args.arguments = ['--account', args.account, *arguments]
    try:
        return command(args, workflow='x')
    except BridgeError as error:
        raise ValueError(str(error)) from None


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', help='Optional numeric account ID; otherwise use the authenticated/last selected account.')
    parser.add_argument('--offline', action='store_true', help='No X or S3 calls; use local files only.')
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('bridge', help='Run probe, refresh, get, or folders through the built-in Cloud VPN and Lambda')
    p.add_argument('--session-seconds', type=int, default=720)
    p.add_argument('--ready-timeout', type=int, default=60)
    p.add_argument('arguments', nargs=argparse.REMAINDER)
    p.set_defaults(run=service_bridge)
    p = commands.add_parser('login', help='Export X-only cookies after explicit local Chrome consent')
    p.add_argument('--profile', default='Default')
    p.add_argument('--authorize-export', action='store_true')
    p.set_defaults(run=lambda a: login(CACHE, a.profile, a.authorize_export, atomic_json))
    p = commands.add_parser('refresh', help='Collect selected feeds; archive posts and checkpoint every page')
    p.add_argument('--collections', nargs='+', choices=list(COLLECTIONS), default=['likes', 'bookmarks'])
    p.add_argument('--folder', help='Bookmark folder ID; requires --collections bookmarks')
    p.add_argument('--resume', action='store_true', help='Continue an incomplete scan; default starts at the newest page')
    p.add_argument('--max-pages', type=int, help='Explicit per-collection limit for this run; coverage remains partial')
    p.add_argument('--delay', type=float, default=1.0, help='Seconds between pages (default 1)')
    p.set_defaults(run=refresh)
    p = commands.add_parser('get', help='Read cached post; fetch from X only if missing or --refresh')
    p.add_argument('post')
    p.add_argument('--refresh', action='store_true')
    p.set_defaults(run=get_post)
    p = commands.add_parser('search', help='Search cached full post text; never contacts X')
    p.add_argument('phrase')
    p.add_argument('--collection')
    p.add_argument('--latest', action='store_true')
    p.add_argument('--coverage', action='store_true')
    p.set_defaults(run=search)
    p = commands.add_parser('list', help='List cached collection IDs and scan coverage; never contacts X')
    p.add_argument('--collection')
    p.add_argument('--latest', action='store_true')
    p.set_defaults(run=listing)
    p = commands.add_parser('folders', help='Read cached bookmark folders; --refresh reads X')
    p.add_argument('--refresh', action='store_true')
    p.set_defaults(run=folders)
    for name, function in (('doctor', doctor), ('sync', sync)):
        p = commands.add_parser(name)
        p.set_defaults(run=function)
    args = parser.parse_args()
    try:
        # The collector subprocess owns the workflow lock. Holding it in the
        # wrapper would prevent that subprocess from starting its command.
        if args.command == 'bridge':
            return args.run(args) or 0
        with lock():
            return args.run(args) or 0
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print('X workflow failed (network, session, or S3). Local progress retained; no credentials printed. Check doctor and retry sync if needed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
