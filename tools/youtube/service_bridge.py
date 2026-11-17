"""Run the collector through a Lambda service using the built-in Cloud VPN."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
import secrets

import boto3
from botocore.config import Config

from bridge_sessions import Jobs, check_ready
from bridge_probe import public_address, youtube_probe
from bridge_transport import BridgeError, ManagedBridge, endpoint, probe_private_proxy

ROOT = Path(__file__).resolve().parents[2]


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise BridgeError('Missing bridge setting: ' + name)
    return value


def wait_ready(jobs, session_id, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = jobs.get(session_id)
        if job and job['state'] == 'ready':
            check_ready(job, reserve=60)
            return job
        if job and job['state'] in ('failed', 'stopped'):
            raise BridgeError('Lambda bridge stopped during startup; check its session status')
        time.sleep(2)
    raise BridgeError('Lambda bridge did not become ready before the startup deadline')


def collect(arguments, node, job, jobs, session_id):
    environment = os.environ.copy()
    environment['YOUTUBE_HISTORY_PROXY'] = node.proxy_url
    environment['YOUTUBE_TRANSCRIPT_PROXY'] = node.proxy_url
    process = subprocess.Popen([sys.executable, str(ROOT / 'tools/youtube/youtube.py'), *arguments],
        env=environment)
    try:
        while process.poll() is None:
            check_ready(jobs.get(session_id), reserve=30)
            node.check()
            time.sleep(2)
        check_ready(jobs.get(session_id))
        node.check()
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
        raise BridgeError('Use bridge -- probe, refresh, or search with their usual arguments')
    if arguments[0] == 'probe' and len(arguments) != 1:
        raise BridgeError('The unsigned probe does not accept additional arguments')
    if not 120 <= args.session_seconds <= 720 or not 10 <= args.ready_timeout <= 120:
        raise BridgeError('Session duration must be 120–720 seconds; readiness timeout must be 10–120 seconds')
    function = required('YOUTUBE_BRIDGE_FUNCTION')
    table = required('YOUTUBE_BRIDGE_TABLE')
    session_id = uuid.uuid4().hex
    settings = {'region_name': 'us-west-1', 'config': Config(connect_timeout=5,
        read_timeout=10, retries={'mode': 'standard', 'total_max_attempts': 2})}
    session = boto3.Session()
    jobs = Jobs(session.resource('dynamodb', **settings).Table(table))
    token = secrets.token_hex(32)
    # Create before invoking; repeated delivery can only claim this record once.
    jobs.create(session_id, args.session_seconds, token)
    try:
        response = session.client('lambda', **settings).invoke(FunctionName=function,
            InvocationType='Event', Payload=json.dumps({'session_id': session_id}).encode())
        if response['StatusCode'] != 202:
            raise BridgeError('AWS did not accept the bridge invocation')
        payload = response.get('Payload')
        if payload is not None:
            payload.close()
        if arguments[0] == 'probe':
            print(json.dumps({'lambda_invocation': 'accepted'}), flush=True)
        job = wait_ready(jobs, session_id, args.ready_timeout)
        target = endpoint(job)
        if arguments[0] == 'probe':
            print(json.dumps({'lambda_session': 'ready', 'protocol': job['protocol']}), flush=True)
            status = probe_private_proxy(*target)
            print(json.dumps({'private_tcp_proxy': 'reachable', 'unauthenticated_status': status}), flush=True)
        with ManagedBridge(job, token) as node:
            check_ready(jobs.get(session_id), reserve=60)
            if public_address(node.proxy_url) != job['egress_ip']:
                raise BridgeError('Bridge egress address did not match; collection was not started')
            node.check()
            print(json.dumps({'bridge': 'verified', 'session_id': session_id}), flush=True)
            if arguments[0] == 'probe':
                results = youtube_probe(node.proxy_url)
                check_ready(jobs.get(session_id))
                node.check()
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
    except BridgeError:
        raise
    except Exception:
        # AWS/transport exceptions and local subprocess output can contain sensitive values.
        raise BridgeError('Bridge operation failed; check AWS permissions and built-in VPN connectivity') from None
