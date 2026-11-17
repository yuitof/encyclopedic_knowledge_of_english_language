"""Atomic account-scoped archive. Offline reads never initialize an X client."""
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from posts import ID, valid_post

COLLECTION = re.compile(r'(?:likes|bookmarks|posts|replies|media|folder-[1-9][0-9]{0,24})\Z')


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def body(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def empty_index(account_id):
    return {'schema_version': 1, 'account_id': account_id, 'updated_at': now(), 'posts': {}, 'collections': {}, 'folders': {}}


def validate_index(index, account_id):
    if not isinstance(index, dict) or set(index) - {'schema_version', 'account_id', 'updated_at', 'posts', 'collections', 'folders'}:
        raise ValueError('Invalid X cache index fields.')
    if index.get('schema_version') != 1 or index.get('account_id') != account_id or not ID.fullmatch(account_id):
        raise ValueError('Invalid or mismatched X cache account.')
    if not isinstance(index.get('posts'), dict) or not isinstance(index.get('collections'), dict) or not isinstance(index.get('folders'), dict):
        raise ValueError('Invalid X cache index.')
    for identifier, state in index['posts'].items():
        if not ID.fullmatch(identifier) or not isinstance(state, dict) or set(state) - {'status', 'retrieved_at', 'checked_at', 'error', 'sha256', 's3_key'}:
            raise ValueError('Invalid post state in X cache.')
        if state.get('status') not in ('cached', 'unavailable', 'retry_needed'):
            raise ValueError('Invalid X post status.')
        if state.get('sha256') and not re.fullmatch('[a-f0-9]{64}', state['sha256']):
            raise ValueError('Invalid X post digest.')
        if state.get('s3_key') and state['s3_key'] != f'cache/x/v1/accounts/{account_id}/posts/{identifier}.{state.get("sha256")}.json':
            raise ValueError('Invalid remote X post reference.')
    for name, collection in index['collections'].items():
        if not COLLECTION.fullmatch(name) or not isinstance(collection, dict) or set(collection) - {'post_ids', 'latest_post_ids', 'scan', 'last_completed_at'}:
            raise ValueError('Invalid collection in X cache.')
        for key in ('post_ids', 'latest_post_ids'):
            if not isinstance(collection.get(key, []), list) or not all(isinstance(i, str) and ID.fullmatch(i) for i in collection.get(key, [])):
                raise ValueError('Invalid X collection IDs.')
        scan = collection.get('scan', {})
        if not isinstance(scan, dict) or set(scan) - {'started_at', 'updated_at', 'pages', 'status', 'reason', 'cursor', 'post_ids', 'unavailable_ids'}:
            raise ValueError('Invalid X collection scan.')
        for key in ('post_ids', 'unavailable_ids'):
            if not isinstance(scan.get(key, []), list) or not all(isinstance(i, str) and ID.fullmatch(i) for i in scan.get(key, [])):
                raise ValueError('Invalid X scan IDs.')
    for identifier, folder in index['folders'].items():
        if not ID.fullmatch(identifier) or not isinstance(folder, dict) or set(folder) - {'id', 'name', 'retrieved_at'} or folder.get('id') != identifier:
            raise ValueError('Invalid X bookmark folder.')


def union(a, b):
    return list(dict.fromkeys(a + b))


def merge_indexes(left, right):
    validate_index(left, right['account_id'])
    validate_index(right, right['account_id'])
    result = copy.deepcopy(left)
    result['updated_at'] = max(left['updated_at'], right['updated_at'])
    for identifier, new in right['posts'].items():
        old = result['posts'].get(identifier, {})
        rank = lambda v: (v.get('status') == 'cached', v.get('retrieved_at', v.get('checked_at', '')))
        if rank(new) >= rank(old):
            result['posts'][identifier] = copy.deepcopy(new)
            if new.get('sha256') and new.get('sha256') == old.get('sha256') and old.get('s3_key'):
                result['posts'][identifier]['s3_key'] = old['s3_key']
    for name, new in right['collections'].items():
        old = result['collections'].get(name, {})
        # Membership is archival. The newest scan's coverage is never unioned with older coverage.
        chosen = copy.deepcopy(new if new.get('scan', {}).get('updated_at', '') >= old.get('scan', {}).get('updated_at', '') else old)
        chosen['post_ids'] = union(new.get('post_ids', []), old.get('post_ids', []))
        completed = max((c for c in (old, new) if c.get('last_completed_at')), key=lambda c: c['last_completed_at'], default=None)
        if completed:
            chosen['last_completed_at'] = completed['last_completed_at']
            chosen['latest_post_ids'] = copy.deepcopy(completed.get('latest_post_ids', []))
        result['collections'][name] = chosen
    for identifier, folder in right['folders'].items():
        if folder.get('retrieved_at', '') >= result['folders'].get(identifier, {}).get('retrieved_at', ''):
            result['folders'][identifier] = copy.deepcopy(folder)
    return result


class Cache:
    def __init__(self, root, account_id, remote=None):
        if not ID.fullmatch(account_id):
            raise ValueError('Invalid account ID.')
        self.account_id, self.remote = account_id, remote
        self.root = root / 'accounts' / account_id
        path = self.root / 'index.json'
        self.index = json.loads(path.read_text()) if path.exists() else empty_index(account_id)
        validate_index(self.index, account_id)
        if remote:
            self.index = remote.restore(self.index)
            atomic_json(path, self.index)

    def save_local(self):
        self.index['updated_at'] = now()
        validate_index(self.index, self.account_id)
        atomic_json(self.root / 'index.json', self.index)

    def save(self):
        self.save_local()
        if self.remote:
            self.index = self.remote.save(self.index, self.root)
            atomic_json(self.root / 'index.json', self.index)

    def put(self, post, checkpoint=True):
        identifier = post['id']
        if not valid_post(post, identifier):
            raise ValueError('Refusing invalid X post cache content.')
        atomic_json(self.root / 'posts' / (identifier + '.json'), post)
        self.index['posts'][identifier] = {'status': 'cached', 'retrieved_at': post['retrieved_at'],
                                            'sha256': hashlib.sha256(body(post)).hexdigest()}
        # A retrieval page can checkpoint its posts together before advancing the cursor.
        if checkpoint:
            self.save_local()

    def get(self, identifier):
        if not isinstance(identifier, str) or not ID.fullmatch(identifier):
            raise ValueError('Invalid X post ID.')
        state = self.index['posts'].get(identifier, {})
        path = self.root / 'posts' / (identifier + '.json')
        if path.exists():
            try:
                post = json.loads(path.read_text())
                digest = hashlib.sha256(body(post)).hexdigest()
                if valid_post(post, identifier) and (digest == state.get('sha256') or not state):
                    if not state:
                        # Recover a completed source write interrupted before its index checkpoint.
                        self.index['posts'][identifier] = {'status': 'cached', 'retrieved_at': post['retrieved_at'], 'sha256': digest}
                        self.save_local()
                    return post
            except (ValueError, OSError):
                pass
        if self.remote and state.get('s3_key'):
            post = self.remote.download(self.account_id, identifier, state)
            atomic_json(path, post)
            return post
        if state.get('status') == 'cached':
            self.index['posts'][identifier] = {'status': 'retry_needed', 'checked_at': now(), 'error': 'Missing or invalid post cache'}
            self.save_local()
        return None
