#!/usr/bin/env python3
"""Save noncredential S3 configuration privately; manifests initialize conditionally at runtime."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[2]


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='config-')
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump(data, file, indent=2)
            file.write('\n')
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


os.umask(0o077)
stack = sys.argv[1]
outputs = json.loads(subprocess.check_output(['aws', 'cloudformation', 'describe-stacks', '--region', 'us-west-1',
    '--stack-name', stack, '--query', 'Stacks[0].Outputs', '--output', 'json']))
values = {item['OutputKey']: item['OutputValue'] for item in outputs}
atomic_json(root / '.codex/tmp/x/s3-config.json', {'bucket': values['BucketName'], 'region': 'us-west-1', 'stack': stack})
print('Saved ignored X S3 configuration. Run bash tools/x/run.sh sync to persist the private archive.')
