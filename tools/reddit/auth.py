"""Private Reddit-only cookie loading and explicitly consented local export."""
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import time

DOMAINS = {'reddit.com', 'www.reddit.com', 'old.reddit.com'}


def state(root):
    raw = os.environ.get('REDDIT_STORAGE_STATE_JSON')
    path = root / 'auth/storage-state.json'
    if not raw and not path.exists():
        raise ValueError('Reddit session missing; run login or privately supply REDDIT_STORAGE_STATE_JSON. See docs/reddit.md.')
    data = json.loads(raw) if raw else json.loads(path.read_text())
    cookies = [c for c in data.get('cookies', []) if c.get('domain', '').lstrip('.') in DOMAINS
               and (c.get('expires', -1) <= 0 or c['expires'] > time.time())]
    if not {'reddit_session'} <= {c['name'] for c in cookies}:
        raise ValueError('Reddit session needs an unexpired reddit_session cookie; renew the private session.')
    return cookies


def login(root, profile, authorized, atomic):
    if sys.platform != 'darwin':
        raise ValueError('Local cookie export supports macOS Chrome; privately supply REDDIT_STORAGE_STATE_JSON in Cloud.')
    if not re.fullmatch(r'Default|Profile [0-9]+', profile):
        raise ValueError('Specify Default or Profile N.')
    if not authorized:
        if not sys.stdin.isatty() or input(f'Export only Reddit cookies from Chrome {profile} locally? [y/N] ').lower() not in ('y', 'yes'):
            raise ValueError('Cookie export needs explicit consent; no session saved.')
    from yt_dlp.cookies import extract_cookies_from_browser
    base = Path.home() / 'Library/Application Support/Google/Chrome' / profile
    database = next((p for p in (base / 'Cookies', base / 'Network/Cookies') if p.exists()), None)
    if database is None:
        raise ValueError('Cookie database missing in the selected profile.')
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=10) as db:
        rows = db.execute('SELECT host_key,name,path,is_httponly,samesite,expires_utc FROM cookies WHERE host_key IN (?,?,?,?,?,?)',
                          tuple(d for domain in sorted(DOMAINS) for d in (domain, '.' + domain))).fetchall()
    flags = {(d, n, p): (h, s, e) for d, n, p, h, s, e in rows}
    class Quiet:
        def debug(self, *a, **kw): pass
        def info(self, *a, **kw): pass
        def warning(self, *a, **kw): pass
        def error(self, *a, **kw): pass
    temporary = root / 'auth/tmp'
    temporary.mkdir(parents=True, exist_ok=True)
    previous = tempfile.tempdir
    try:
        tempfile.tempdir = str(temporary)
        jar = extract_cookies_from_browser('chrome', profile=profile, logger=Quiet())
        cookies = []
        for c in jar:
            if c.domain.lstrip('.') not in DOMAINS or not c.value:
                continue
            if (c.domain, c.name, c.path) not in flags:
                raise ValueError('Cookie metadata changed; retry export.')
            h, s, expiry = flags[c.domain, c.name, c.path]
            expiry = expiry / 1e6 - 11644473600 if expiry else -1
            if expiry > 0 and expiry <= time.time():
                continue
            item = dict(name=c.name, value=c.value, domain=c.domain, path=c.path or '/',
                        secure=bool(c.secure), expires=expiry, httpOnly=bool(h))
            if s in (0, 1, 2):
                item['sameSite'] = {0: 'None', 1: 'Lax', 2: 'Strict'}[s]
            cookies.append(item)
        if not {'reddit_session'} <= {c['name'] for c in cookies}:
            raise ValueError('No signed-in Reddit session in this Chrome profile; sign in normally first.')
        atomic(root / 'auth/storage-state.json', {'cookies': cookies, 'origins': []})
    except ValueError:
        raise
    except Exception:
        raise ValueError('Reddit cookie export failed; check the profile and approve any Keychain prompt yourself.') from None
    finally:
        tempfile.tempdir = previous
