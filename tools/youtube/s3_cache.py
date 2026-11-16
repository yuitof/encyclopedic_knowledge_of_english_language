"""Allowlisted private cache persistence; never upload auth, profiles, or tooling."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re

TRANSCRIPT = re.compile(r'transcripts/([-_A-Za-z0-9]{11})\.([A-Za-z0-9-]+)\.json\Z')
REMOTE = re.compile(r'cache/v1/transcripts/([-_A-Za-z0-9]{11})\.([A-Za-z0-9-]+)\.([0-9a-f]{64})\.json\Z')


def state_time(state):
    return max((state.get(k, '') for k in ('retrieved_at', 'fetched_at', 'attempted_at', 'checked_at')), default='')


def merge_indexes(left, right):
    """Union watches; cached transcripts beat failures; newest metadata wins."""
    result = copy.deepcopy(left)
    lm, rm = left.get('metadata', {}), right.get('metadata', {})
    result['metadata'] = copy.deepcopy(lm | rm if rm.get('updated_at', '') >= lm.get('updated_at', '') else rm | lm)
    # Coverage belongs to a specific refresh, never stretch its range by union.
    coverages = [m['cloud_history'] for m in (lm, rm) if m.get('cloud_history')]
    if coverages:
        result['metadata']['cloud_history'] = copy.deepcopy(max(coverages, key=lambda c: c.get('updated_at', '')))
    videos = {v['video_id']: v for v in result.get('videos', [])}
    for incoming in right.get('videos', []):
        identifier = incoming['video_id']
        if identifier not in videos:
            videos[identifier] = copy.deepcopy(incoming)
            continue
        video = videos[identifier]
        for key in ('watched_on', 'watched_at', 'history_sources'):
            video[key] = sorted(set(video.get(key, [])) | set(incoming.get(key, [])))
        for key in ('title', 'channel', 'url'):
            if incoming.get(key):
                video[key] = incoming[key]
        old, new = video.get('transcript', {}), incoming.get('transcript', {})
        rank = lambda s: (s.get('status') == 'cached', state_time(s))
        if rank(new) >= rank(old):
            video['transcript'] = copy.deepcopy(new)
    result['videos'] = sorted(videos.values(), key=lambda v: max(v.get('watched_on', []) + v.get('watched_at', []), default=''), reverse=True)
    return result


class S3Cache:
    def __init__(self, bucket, client=None):
        if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket):
            raise ValueError('Invalid cache bucket name')
        if client is None:
            import boto3
            from botocore.config import Config
            client = boto3.client('s3', region_name='us-west-1', config=Config(
                signature_version='s3v4', connect_timeout=10, read_timeout=30,
                retries={'max_attempts': 3, 'mode': 'standard'}))
        self.client, self.bucket = client, bucket
        self.uploaded = {}

    def get(self, key):
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            return json.loads(response['Body'].read()), response['ETag']
        except Exception as error:
            code = getattr(error, 'response', {}).get('Error', {}).get('Code')
            if code in ('NoSuchKey', '404'):
                return None, None
            raise

    def restore(self, local):
        remote, _ = self.get('cache/v1/history.json')
        if remote is None:
            return local
        self.validate_index(remote)
        return merge_indexes(remote, local)

    @staticmethod
    def validate_index(index):
        if not isinstance(index, dict) or not isinstance(index.get('videos'), list) or not isinstance(index.get('metadata'), dict):
            raise ValueError('Invalid S3 history index')
        for video in index['videos']:
            if not re.fullmatch(r'[-_A-Za-z0-9]{11}', video.get('video_id', '')):
                raise ValueError('Invalid video ID in S3 cache')
            for field in ('watched_on', 'watched_at', 'history_sources'):
                if not isinstance(video.get(field, []), list) or not all(isinstance(x, str) for x in video.get(field, [])):
                    raise ValueError('Invalid watch metadata in S3 cache')
            if not isinstance(video.get('transcript', {}), dict):
                raise ValueError('Invalid S3 transcript state')

    def download(self, video, root, valid, atomic):
        state = video.get('transcript', {})
        key, path = state.get('s3_key', ''), state.get('path', '')
        match, local = REMOTE.fullmatch(key), TRANSCRIPT.fullmatch(path)
        if not match or not local or match.group(1, 2) != local.group(1, 2) or match.group(1) != video['video_id']:
            return None
        data, _ = self.get(key)
        if data is None:
            return None
        digest = hashlib.sha256(self.body(data)).hexdigest()
        if digest != match.group(3) or not valid(data, video['video_id']):
            raise ValueError('Invalid S3 transcript content')
        target = (root / path).resolve()
        if not target.is_relative_to((root / 'transcripts').resolve()):
            raise ValueError('Unsafe local transcript destination')
        atomic(target, data)
        return data

    @staticmethod
    def body(data):
        return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()

    def put(self, key, data, **conditions):
        return self.client.put_object(Bucket=self.bucket, Key=key, Body=self.body(data),
            ContentType='application/json', ServerSideEncryption='AES256', **conditions)

    def upload_transcripts(self, index, root, valid):
        for video in index['videos']:
            state = video.get('transcript', {})
            if state.get('status') != 'cached':
                continue
            path = state.get('path', '')
            match = TRANSCRIPT.fullmatch(path)
            if not match or match.group(1) != video['video_id']:
                raise ValueError('Only validated transcript paths may be uploaded')
            target = (root / path).resolve()
            if not target.is_relative_to((root / 'transcripts').resolve()):
                raise ValueError('Unsafe transcript source')
            if not target.exists():
                if REMOTE.fullmatch(state.get('s3_key', '')):
                    continue  # Existing remote transcript: download lazily on search.
                state.update(status='retry_needed', error='Missing or invalid cached transcript')
                continue
            data = json.loads(target.read_text())
            if not valid(data, video['video_id']):
                raise ValueError('Invalid transcript; refusing S3 upload')
            digest = hashlib.sha256(self.body(data)).hexdigest()
            key = f'cache/v1/transcripts/{match.group(1)}.{match.group(2)}.{digest}.json'
            if state.get('s3_key') == key:
                continue  # Manifest already references these exact immutable bytes.
            if key not in self.uploaded:
                try:
                    self.put(key, data, IfNoneMatch='*')
                except Exception as error:
                    code = getattr(error, 'response', {}).get('Error', {}).get('Code')
                    if code != 'PreconditionFailed':
                        raise
                self.uploaded[key] = True
            state['s3_key'] = key

    def save(self, index, root, valid):
        """Transcripts precede manifest. CAS retry preserves concurrent task writes."""
        self.validate_index(index)
        self.upload_transcripts(index, root, valid)
        for _ in range(8):
            remote, etag = self.get('cache/v1/history.json')
            if remote is not None:
                self.validate_index(remote)
            merged = merge_indexes(remote or {'metadata': {}, 'videos': []}, index)
            if remote is not None and self.body(remote) == self.body(merged):
                return merged
            try:
                self.put('cache/v1/history.json', merged, **({'IfMatch': etag} if etag else {'IfNoneMatch': '*'}))
                return merged
            except Exception as error:
                code = getattr(error, 'response', {}).get('Error', {}).get('Code')
                if code not in ('PreconditionFailed', 'ConditionalRequestConflict'):
                    raise
        raise ValueError('S3 manifest changed repeatedly; local progress retained, retry sync')
