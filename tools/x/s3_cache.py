"""Allowlisted, content-addressed S3 persistence for account indexes and posts only."""
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
import re
from cache import atomic_json, body, empty_index, merge_indexes, validate_index
from posts import valid_post


class S3Cache:
    def __init__(self, bucket, client=None):
        if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket):
            raise ValueError('Invalid X cache bucket.')
        self.bucket = bucket
        if client is None:
            import boto3
            from botocore.config import Config
            client = boto3.client('s3', region_name='us-west-1', config=Config(
                signature_version='s3v4', connect_timeout=10, read_timeout=30,
                retries={'max_attempts': 3, 'mode': 'standard'}))
        self.client = client
        self.initialized = set()

    def put(self, key, data, **conditions):
        payload = body(data)
        encoding = {}
        if key.endswith('/index.json'):
            payload = gzip.compress(payload, mtime=0)
            encoding['ContentEncoding'] = 'gzip'
        return self.client.put_object(Bucket=self.bucket, Key=key, Body=payload, ContentType='application/json',
                                      ServerSideEncryption='AES256', **encoding, **conditions)

    def get(self, key):
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        payload = response['Body'].read()
        if response.get('ContentEncoding') == 'gzip':
            payload = gzip.decompress(payload)
        return json.loads(payload), response['ETag']

    def restore(self, local):
        account = local['account_id']
        validate_index(local, account)
        key = f'cache/x/v1/accounts/{account}/index.json'
        # Conditional creation works without ListBucket; AccessDenied is never treated as absence.
        if account not in self.initialized:
            for attempt in range(4):
                try:
                    self.put(key, empty_index(account), IfNoneMatch='*')
                    break
                except Exception as e:
                    code = getattr(e, 'response', {}).get('Error', {}).get('Code')
                    if code in ('PreconditionFailed', '412'):
                        break
                    if code != 'ConditionalRequestConflict' or attempt == 3:
                        raise
            self.initialized.add(account)
        remote, _ = self.get(key)
        validate_index(remote, account)
        return merge_indexes(remote, local)

    def download(self, account, identifier, state):
        expected = f'cache/x/v1/accounts/{account}/posts/{identifier}.{state.get("sha256")}.json'
        if state.get('s3_key') != expected:
            raise ValueError('Unsafe X post object key.')
        post, _ = self.get(expected)
        if not valid_post(post, identifier) or hashlib.sha256(body(post)).hexdigest() != state.get('sha256'):
            raise ValueError('Invalid or corrupt S3 X post.')
        return post

    def save(self, index, root):
        account = index['account_id']
        validate_index(index, account)
        pending = []
        for identifier, state in index['posts'].items():
            if state['status'] != 'cached':
                continue
            key = f'cache/x/v1/accounts/{account}/posts/{identifier}.{state.get("sha256")}.json'
            if state.get('s3_key') != key:
                pending.append((identifier, state, key))

        def upload(item):
            identifier, state, key = item
            path = (root / 'posts' / (identifier + '.json')).resolve()
            if not path.is_relative_to((root / 'posts').resolve()):
                raise ValueError('Unsafe X post source path.')
            post = json.loads(path.read_text())
            if not valid_post(post, identifier) or hashlib.sha256(body(post)).hexdigest() != state.get('sha256'):
                raise ValueError('Invalid X post; refusing S3 upload.')
            try:
                self.put(key, post, IfNoneMatch='*')
            except Exception as e:
                if getattr(e, 'response', {}).get('Error', {}).get('Code') not in ('PreconditionFailed', '412'):
                    raise
            return key

        # Independent immutable objects can upload concurrently. Checkpoint successful
        # batches locally; publish no remote manifest until every referenced object exists.
        with ThreadPoolExecutor(max_workers=8) as pool:
            for start in range(0, len(pending), 32):
                batch = pending[start:start + 32]
                futures = [pool.submit(upload, item) for item in batch]
                failures = []
                for item, future in zip(batch, futures):
                    try:
                        item[1]['s3_key'] = future.result()
                    except Exception as error:
                        failures.append(error)
                atomic_json(root / 'index.json', index)
                if failures:
                    raise failures[0]
        key = f'cache/x/v1/accounts/{account}/index.json'
        for _ in range(8):
            remote, etag = self.get(key)
            merged = merge_indexes(remote, index)
            if body(remote) == body(merged):
                return merged
            try:
                self.put(key, merged, IfMatch=etag)
                return merged
            except Exception as e:
                if getattr(e, 'response', {}).get('Error', {}).get('Code') not in ('PreconditionFailed', 'ConditionalRequestConflict', '412'):
                    raise
        raise ValueError('Concurrent X manifest updates; local progress retained. Retry sync.')
