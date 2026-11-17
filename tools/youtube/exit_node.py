"""Run the existing collector through an on-demand Lambda Tailscale exit node."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import boto3
from botocore.config import Config

from exit_jobs import Jobs, check_ready
from exit_probe import public_address, youtube_probe
from tailscale_node import ExitNodeError, TailscaleNode, auth_key

ROOT = Path(__file__).resolve().parents[2]


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise ExitNodeError('Missing exit-node setting: ' + name)
    return value


def wait_ready(jobs, session_id, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = jobs.get(session_id)
        if job and job['state'] == 'ready':
            check_ready(job, reserve=60)
            return job
        if job and job['state'] in ('failed', 'stopped'):
            raise ExitNodeError('Lambda exit node stopped during startup; check its session status')
        time.sleep(2)
    raise ExitNodeError('Lambda exit node did not become ready before the startup deadline')


def collect(arguments, node, job, jobs, session_id):
    environment = os.environ.copy()
    environment['YOUTUBE_HISTORY_PROXY'] = node.proxy_url
    environment['YOUTUBE_TRANSCRIPT_PROXY'] = node.proxy_url
    process = subprocess.Popen([sys.executable, str(ROOT / 'tools/youtube/youtube.py'), *arguments],
        env=environment)
    try:
        while process.poll() is None:
            check_ready(jobs.get(session_id), reserve=30)
            node.check_exit(job['node_id'])
            time.sleep(2)
        check_ready(jobs.get(session_id))
        node.check_exit(job['node_id'])
        return process.returncode
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def run(args):
    arguments = args.arguments
    if arguments[:1] == ['--']:
        arguments = arguments[1:]
    if not arguments or arguments[0] not in ('probe', 'refresh', 'search'):
        raise ExitNodeError('Use exit-node -- probe, refresh, or search with their usual arguments')
    if arguments[0] == 'probe' and len(arguments) != 1:
        raise ExitNodeError('The unsigned probe does not accept additional arguments')
    if not 120 <= args.session_seconds <= 720 or not 10 <= args.ready_timeout <= 120:
        raise ExitNodeError('Session duration must be 120–720 seconds; readiness timeout must be 10–120 seconds')
    function = required('YOUTUBE_EXIT_FUNCTION')
    table = required('YOUTUBE_EXIT_TABLE')
    secret = required('YOUTUBE_TAILSCALE_AUTH_SECRET_ARN')
    session_id = uuid.uuid4().hex
    settings = {'region_name': 'us-west-1', 'config': Config(connect_timeout=5,
        read_timeout=10, retries={'mode': 'standard', 'total_max_attempts': 2})}
    session = boto3.Session()
    jobs = Jobs(session.resource('dynamodb', **settings).Table(table))
    key = auth_key(session.client('secretsmanager', **settings), secret)
    # Create before invoking; repeated delivery can only claim this record once.
    jobs.create(session_id, args.session_seconds)
    try:
        response = session.client('lambda', **settings).invoke(FunctionName=function,
            InvocationType='Event', Payload=json.dumps({'session_id': session_id}).encode())
        if response['StatusCode'] != 202:
            raise ExitNodeError('AWS did not accept the exit-node invocation')
        payload = response.get('Payload')
        if payload is not None:
            payload.close()
        job = wait_ready(jobs, session_id, args.ready_timeout)
        with TailscaleNode(ROOT / '.codex/tmp/youtube/ts', key,
                'yt-client-' + session_id[:12], proxy=True) as node:
            node.select_exit(job['node_id'], job['ipv4'])
            check_ready(jobs.get(session_id), reserve=60)
            if public_address(node.proxy_url) != job['egress_ip']:
                raise ExitNodeError('Exit-node egress address did not match; collection was not started')
            node.check_exit(job['node_id'])
            print(json.dumps({'exit_node': 'verified', 'session_id': session_id}), flush=True)
            if arguments[0] == 'probe':
                results = youtube_probe(node.proxy_url)
                check_ready(jobs.get(session_id))
                node.check_exit(job['node_id'])
                print(json.dumps({'unsigned_youtube_probe': results}), flush=True)
                return 0 if all(200 <= r['status'] < 400 for r in results) else 1
            return collect(arguments, node, job, jobs, session_id)
    finally:
        try:
            jobs.stop(session_id)
        except Exception:
            print('Could not send stop request; Lambda will stop at its session deadline.', file=sys.stderr)


def command(args):
    try:
        return run(args)
    except ExitNodeError:
        raise
    except Exception:
        # AWS/transport exceptions and local subprocess output can contain sensitive values.
        raise ExitNodeError('Exit-node operation failed; check AWS permissions, connectivity, and tailnet enrollment') from None
