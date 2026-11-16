#!/usr/bin/env python3
"""Initialize an empty manifest without overwriting existing cache; save local config."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

os.umask(0o077)
root = Path(__file__).resolve().parents[2]
cache = root / '.codex/tmp/youtube'
cache.mkdir(parents=True, exist_ok=True)
stack = sys.argv[1]
outputs = json.loads(subprocess.check_output([
    'aws', 'cloudformation', 'describe-stacks', '--region', 'us-west-1',
    '--stack-name', stack, '--query', 'Stacks[0].Outputs', '--output', 'json']))
values = {o['OutputKey']: o['OutputValue'] for o in outputs}
bucket = values['BucketName']
fd, filename = tempfile.mkstemp(dir=cache, prefix='bootstrap-', suffix='.json')
try:
    with os.fdopen(fd, 'w') as file:
        json.dump({'metadata': {}, 'videos': []}, file)
    result = subprocess.run([
        'aws', 's3api', 'put-object', '--region', 'us-west-1', '--bucket', bucket,
        '--key', 'cache/v1/history.json', '--body', filename,
        '--content-type', 'application/json', '--server-side-encryption', 'AES256',
        '--if-none-match', '*'], capture_output=True, text=True)
    if result.returncode and 'PreconditionFailed' not in result.stderr:
        raise RuntimeError('Could not initialize the private cache manifest: ' + result.stderr)
finally:
    os.unlink(filename)
config = {'bucket': bucket, 'region': 'us-west-1', 'stack': stack}
fd, filename = tempfile.mkstemp(dir=cache, prefix='config-')
with os.fdopen(fd, 'w') as file:
    json.dump(config, file, indent=2)
os.replace(filename, cache / 's3-config.json')
print(json.dumps({'bucket': bucket, 'region': 'us-west-1', 'config': '.codex/tmp/youtube/s3-config.json',
                  'cache_policy_arn': values['CacheAccessPolicyArn']}))
