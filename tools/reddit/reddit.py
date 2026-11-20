#!/usr/bin/env python3
"""Private Reddit website collections with resumable scans and cache-first search."""
import argparse
from contextlib import contextmanager, ExitStack
import fcntl
import json
import math
import os
from pathlib import Path
import sys

from api import Client
from auth import state, login
from cache import Cache, atomic_json, now, union
from pages import ACCOUNT, COLLECTIONS, RedditError, Unavailable, source_url

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.codex/tmp/reddit'


def emit(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def bucket():
    config = CACHE / 's3-config.json'
    return os.environ.get('REDDIT_CACHE_BUCKET') or (json.loads(config.read_text()).get('bucket') if config.exists() else None)


def selected_account(args):
    account = args.account or os.environ.get('REDDIT_ACCOUNT')
    if not account and (CACHE / 'account.json').exists():
        account = json.loads((CACHE / 'account.json').read_text()).get('id')
    if not isinstance(account, str) or not ACCOUNT.fullmatch(account.lower()):
        raise RedditError('Select an archive with --account/REDDIT_ACCOUNT, or run refresh with a private session.')
    return account.lower()


def authenticated(args):
    if args.offline:
        raise RedditError('This operation needs Reddit access; omit --offline.')
    cookies, proxy, delay = state(CACHE), os.environ.get('REDDIT_PROXY'), getattr(args, 'delay', 2.0)
    if os.environ.get('REDDIT_TRANSPORT') == 'workers':
        if getattr(args, 'browser_local', False) or getattr(args, 'direct_local', False):
            raise RedditError(
                'Local origin transports cannot wrap the Workers transport.'
            )
        sys.path.insert(0, str(ROOT / 'tools'))
        from cloud_bridge.workers import WorkersTransport
        from workers import WorkersRelayClient
        transport = WorkersTransport()
        try:
            client = WorkersRelayClient(cookies, transport, delay=delay)
        except Exception:
            transport.close()
            raise
    elif getattr(args, 'browser_local', False):
        from browser import BrowserClient
        client = BrowserClient(cookies, CACHE, proxy=proxy, delay=delay)
    elif getattr(args, 'direct_local', False):
        from direct import DirectClient
        client = DirectClient(cookies, proxy=proxy, delay=delay)
    else:
        client = Client(cookies, proxy=proxy, delay=delay)
    if getattr(args, 'clients', None) is not None:
        args.clients.callback(client.close)
    try:
        account = client.account()
    except Exception:
        client.close()
        raise
    expected = args.account or os.environ.get('REDDIT_ACCOUNT')
    if expected and account['id'] != expected.lower():
        client.close()
        raise RedditError('Signed-in Reddit identity differs from --account/REDDIT_ACCOUNT; refusing cache mixing.')
    atomic_json(CACHE / 'account.json', account)
    return client, account['id']


def cache_for(args, account=None):
    remote = None
    if not args.offline and bucket():
        from s3_cache import S3Cache
        remote = S3Cache(bucket())
    return Cache(CACHE, account or selected_account(args), remote)


@contextmanager
def lock():
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (CACHE / 'workflow.lock').open('a') as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RedditError('Another Reddit workflow is running; use one command at a time.') from None
        try:
            yield
        finally:
            fcntl.flock(file, fcntl.LOCK_UN)


def refresh(args):
    if args.max_pages is not None and args.max_pages < 1:
        raise RedditError('--max-pages must be positive.')
    if not math.isfinite(args.delay) or args.delay < 1:
        raise RedditError('--delay must be at least one second between website requests.')
    client, account = authenticated(args)
    cache = cache_for(args, account)
    names = list(dict.fromkeys(args.collections))
    if args.resume:
        # Validate all selected scans before changing any of them.
        for name in names:
            scan = cache.index['collections'].get(name, {}).get('scan', {})
            if scan.get('status') != 'partial':
                raise RedditError(f'{name} has no incomplete scan; start a fresh refresh or select the incomplete collection.')
    summaries = []
    for name in names:
        collection = cache.index['collections'].setdefault(name, {'post_ids': []})
        scan = collection.get('scan') if args.resume else None
        if scan is None:
            scan = {'started_at': now(), 'updated_at': now(), 'pages': 0, 'status': 'partial',
                    'reason': 'in_progress', 'cursor': None, 'post_ids': [], 'unavailable_ids': []}
        collection['scan'] = scan
        scan.update(reason='in_progress', updated_at=now())
        cache.save_local()
        pages, cursor, seen = 0, scan['cursor'], set()
        try:
            while True:
                page = client.page(account, name, cursor)
                # Record observed membership even if a source subsequently fails.
                collection['post_ids'] = union(collection['post_ids'], list(page['members']))
                scan['post_ids'] = union(scan['post_ids'], list(page['members']))
                cache.save_local()
                for identifier, url in page['members'].items():
                    if cache.get(identifier):
                        continue
                    if cache.index['posts'].get(identifier, {}).get('status') == 'unavailable':
                        scan['unavailable_ids'] = union(scan['unavailable_ids'], [identifier])
                        continue
                    try:
                        cache.put(client.post(url, now(), account))
                    except Unavailable:
                        cache.index['posts'][identifier] = {'status': 'unavailable', 'checked_at': now(),
                                                            'error': 'Reddit explicitly returned HTTP 404/410'}
                        scan['unavailable_ids'] = union(scan['unavailable_ids'], [identifier])
                        cache.save_local()
                    except Exception:
                        cache.index['posts'][identifier] = {'status': 'retry_needed', 'checked_at': now(),
                                                            'error': 'Source read failed; retry the incomplete page'}
                        cache.save_local()
                        raise
                # Sources have reached disk before advancing the continuation.
                next_cursor = page['cursor']
                scan.update(pages=scan['pages'] + 1, cursor=next_cursor, updated_at=now())
                pages += 1
                if not next_cursor:
                    scan.update(status='reachable_end', reason='Reddit returned no continuation')
                    collection['latest_post_ids'] = list(scan['post_ids'])
                    collection['last_completed_at'] = now()
                elif next_cursor == cursor or next_cursor in seen:
                    # Keep the last request cursor so --resume rechecks the stalled page.
                    scan.update(cursor=cursor, reason='repeated_cursor')
                elif args.max_pages and pages >= args.max_pages:
                    scan['reason'] = 'requested_page_limit'
                cache.save()
                # S3 reconciliation may replace index objects.
                collection = cache.index['collections'][name]
                scan = collection['scan']
                if scan['status'] == 'reachable_end' or scan['reason'] in ('repeated_cursor', 'requested_page_limit'):
                    break
                seen.add(next_cursor)
                cursor = next_cursor
        except Exception as error:
            # Re-read the failed page on resume, including after an S3 save failure.
            collection = cache.index['collections'][name]
            scan = collection['scan']
            scan.update(status='partial', cursor=cursor, updated_at=now(),
                        reason=str(error) if isinstance(error, RedditError) else 'Reddit/cache/S3 operation failed; local progress retained')
            cache.save_local()
            summaries.append(summary(name, collection))
            break  # Rate limits, challenges and persistence failures stop all live collection.
        summaries.append(summary(name, collection))
        if scan['status'] == 'partial' and scan['reason'] != 'requested_page_limit':
            break
    emit({'collections': summaries, 'not_started': names[len(summaries):],
          'persistence': 's3' if cache.remote else 'local',
          'coverage': 'Only website-exposed items; reachable_end does not prove lifetime completeness.'})
    return 1 if any(s['status'] == 'partial' and s['reason'] != 'requested_page_limit' for s in summaries) else 0


def summary(name, collection):
    scan = collection['scan']
    return {'collection': name, 'archived_items': len(collection['post_ids']), 'scan_items': len(scan['post_ids']),
            'pages': scan['pages'], 'status': scan['status'], 'reason': scan['reason']}


def verify(args):
    """Small live diagnostic, explicitly separate from a collection refresh."""
    client, account = authenticated(args)
    cache = cache_for(args, account)
    results = []
    for name in dict.fromkeys(args.collections):
        page = client.page(account, name)
        result = {'collection': name, 'page_items': len(page['members']), 'has_more': bool(page['cursor']),
                  'source_parsed': False}
        if page['members']:
            identifier, url = next(iter(page['members'].items()))
            post = client.post(url, now(), account)
            result['source_parsed'] = True
            if not cache.get(identifier):
                cache.put(post)
        results.append(result)
    cache.save()
    emit({'identity_verified': True, 'collections': results, 'persistence': 's3' if cache.remote else 'local',
          'scope': 'Verification reads one page and at most one source per collection; no collection coverage is recorded.'})


def get_post(args):
    identifier, url = source_url(args.post)
    client = None
    # An invalid explicit selector must not silently select a different account.
    if args.account or os.environ.get('REDDIT_ACCOUNT') or (CACHE / 'account.json').exists():
        account = selected_account(args)
    else:
        client, account = authenticated(args)
    cache = cache_for(args, account)
    post = cache.get(identifier)
    if post and not args.refresh:
        emit(post)
        return
    if args.offline:
        raise RedditError('Source not cached locally or --refresh requested in offline mode.')
    if cache.index['posts'].get(identifier, {}).get('status') == 'unavailable' and not args.refresh:
        raise RedditError('Source was unavailable at its last check; use --refresh for an explicit retry.')
    if client is None:
        client, actual = authenticated(args)
        if actual != account:
            raise RedditError('Signed-in identity differs from the selected cache; refusing cache mixing.')
    try:
        post = client.post(url, now(), account)
        cache.put(post)
        cache.save()
    except Unavailable:
        if not post:
            cache.index['posts'][identifier] = {'status': 'unavailable', 'checked_at': now(), 'error': 'Reddit explicitly returned HTTP 404/410'}
        cache.save()
        raise
    except Exception:
        if not cache.get(identifier):
            cache.index['posts'][identifier] = {'status': 'retry_needed', 'checked_at': now(), 'error': 'Source read failed'}
        cache.save_local()
        raise
    emit(post)


def candidates(cache, collection, latest):
    if collection:
        data = cache.index['collections'].get(collection)
        if data is None:
            raise RedditError('Collection has not been collected for this account.')
        if latest and not data.get('last_completed_at'):
            raise RedditError('No completed reachable snapshot for this collection.')
        return data.get('latest_post_ids' if latest else 'post_ids', [])
    if latest:
        raise RedditError('--latest requires --collection.')
    return union(list(cache.index['posts']), [i for c in cache.index['collections'].values() for i in c['post_ids']])


def search(args):
    needle = ' '.join(args.phrase.casefold().split())
    if not needle:
        raise RedditError('Search phrase must not be empty.')
    cache = cache_for(args)
    ids = candidates(cache, args.collection, args.latest)
    matches, missing, hidden_bodies, unread_bodies = [], 0, 0, 0
    for identifier in ids:
        post = cache.get(identifier)
        if not post:
            missing += 1
        else:
            hidden_bodies += post.get('body_status') == 'spoiler_hidden'
            unread_bodies += bool(post.get('body_status'))
            if needle in ' '.join((post['title'] + '\n' + post['text']).casefold().split()):
                matches.append(post)
    emit({'matches': matches, 'selected_items': len(ids), 'missing_items': missing,
          'hidden_bodies': hidden_bodies,
          'unread_bodies': unread_bodies,
          'collections': cache.index['collections'],
          'scope': 'Cached text only; incomplete coverage is not evidence of absence.'})


def listing(args):
    cache = cache_for(args)
    emit({'item_ids': candidates(cache, args.collection, args.latest), 'collections': cache.index['collections']})


def doctor(args):
    try:
        state(CACHE)
        session = True
    except (ValueError, OSError):
        session = False
    emit({'cache': str(CACHE), 'persistence': 's3' if bucket() else 'local', 'session_available': session,
          'note': 'Configuration only; no live Reddit or AWS requests. Reddit bridge deployment is separate.'})


def sync(args):
    if args.offline or not bucket():
        raise RedditError('Sync requires REDDIT_CACHE_BUCKET/private s3-config.json and no --offline.')
    cache = cache_for(args)
    cache.save()
    emit({'synced': True, 'items': len(cache.index['posts']), 'persistence': 's3'})


def service_bridge(args):
    if args.offline:
        raise RedditError('Offline commands do not use the bridge.')
    if getattr(args, 'direct_local', False) or getattr(args, 'browser_local', False):
        raise RedditError('Local origin transports cannot wrap the bridge; select one explicit transport.')
    sys.path.insert(0, str(ROOT / 'tools'))
    from cloud_bridge.client import command
    from cloud_bridge.transport import BridgeError
    if args.account:
        arguments = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
        args.arguments = ['--account', args.account, *arguments]
    try:
        return command(args, workflow='reddit')
    except BridgeError as error:
        raise RedditError(str(error)) from None


def service_workers(args):
    if args.offline:
        raise RedditError('Offline commands do not use the Workers bridge.')
    sys.path.insert(0, str(ROOT / 'tools'))
    from cloud_bridge.workers import WorkersError, command
    try:
        return command(args, workflow='reddit')
    except WorkersError as error:
        raise RedditError(str(error)) from None


def main():
    os.umask(0o077)
    if os.environ.get('REDDIT_TRANSPORT') == 'workers':
        sys.path.insert(0, str(ROOT / 'tools'))
        from cloud_bridge.workers import enable_system_trust
        enable_system_trust()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', help='Reddit username selecting/enforcing the account archive')
    parser.add_argument('--offline', action='store_true', help='No Reddit or S3 calls')
    transport = parser.add_mutually_exclusive_group()
    transport.add_argument('--direct-local', action='store_true', help='Explicit macOS HTTPS route using JSON listings; no proxy or fallback')
    transport.add_argument('--browser-local', action='store_true', help='Explicit macOS Chrome route with isolated exported cookies')
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('login', help='Export Reddit cookies after explicit local Chrome consent')
    p.add_argument('--profile', default='Default')
    p.add_argument('--authorize-export', action='store_true')
    p.set_defaults(run=lambda a: login(CACHE, a.profile, a.authorize_export, atomic_json))
    p = commands.add_parser('refresh')
    p.add_argument('--collections', nargs='+', choices=COLLECTIONS, default=['upvoted', 'saved'])
    p.add_argument('--resume', action='store_true')
    p.add_argument('--max-pages', type=int)
    p.add_argument('--delay', type=float, default=2.0)
    p.set_defaults(run=refresh)
    p = commands.add_parser('verify', help='Verify identity, first listing page and first source; no full collection scan')
    p.add_argument('--collections', nargs='+', choices=COLLECTIONS, default=['upvoted', 'saved'])
    p.set_defaults(run=verify)
    p = commands.add_parser('get', help='Read cached permalink; fetch only on cache miss or --refresh')
    p.add_argument('post')
    p.add_argument('--refresh', action='store_true')
    p.set_defaults(run=get_post)
    for name, function in (('list', listing), ('search', search)):
        p = commands.add_parser(name, help='Cached data only; no Reddit requests')
        if name == 'search':
            p.add_argument('phrase')
        p.add_argument('--collection', choices=COLLECTIONS)
        p.add_argument('--latest', action='store_true')
        p.set_defaults(run=function)
    for name, function in (('doctor', doctor), ('sync', sync)):
        commands.add_parser(name).set_defaults(run=function)
    p = commands.add_parser('bridge', help='Deprecated: use the Lambda bridge; prefer workers')
    p.add_argument('--local', action='store_true', help='Use the existing local Tailscale connection instead of Cloud proxy:8088')
    p.add_argument('--session-seconds', type=int, default=720)
    p.add_argument('--ready-timeout', type=int, default=60)
    p.add_argument('arguments', nargs=argparse.REMAINDER)
    p.set_defaults(run=service_bridge)
    p = commands.add_parser(
        'workers',
        help='Use the Access-protected Cloudflare Workers relay for live Reddit requests',
    )
    p.add_argument('arguments', nargs=argparse.REMAINDER)
    p.set_defaults(run=service_workers)
    args = parser.parse_args()
    try:
        if args.command in ('bridge', 'workers'):
            return args.run(args) or 0
        with lock(), ExitStack() as clients:
            args.clients = clients
            return args.run(args) or 0
    except RedditError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (ValueError, OSError):
        # Never interpolate arbitrary response, AWS, filesystem, or cookie parser errors.
        print('Reddit workflow failed; local progress retained. Check private session, cache, network and S3 configuration.', file=sys.stderr)
        return 1
    except Exception:
        print('Reddit workflow failed (network, session, bridge, or S3); no credentials printed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
