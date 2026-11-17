"""Hold one ephemeral Tailscale exit node during an active Lambda invocation."""
import ipaddress
import os
import time

import boto3

from exit_jobs import Jobs, SESSION_ID
from exit_probe import public_address
from tailscale_node import TailscaleNode, auth_key


def handler(event, context):
    session_id = event.get('session_id') if isinstance(event, dict) else None
    if not isinstance(session_id, str) or not SESSION_ID.fullmatch(session_id):
        return {'state': 'rejected'}
    jobs = Jobs(boto3.resource('dynamodb').Table(os.environ['SESSION_TABLE']))
    owner = context.aws_request_id
    job = jobs.claim(session_id, owner)
    if job is None:
        return {'state': 'ignored'}
    state, reason = 'failed', 'StartupFailure'
    deadline = min(int(job['expires_at']), int(time.time()) + 720,
        int(time.time()) + context.get_remaining_time_in_millis() // 1000 - 60)
    try:
        if deadline - time.time() < 60:
            reason = 'InsufficientSessionTime'
            return {'state': state}
        key = auth_key(boto3.client('secretsmanager'), os.environ['TAILSCALE_AUTH_SECRET_ARN'])
        with TailscaleNode('/tmp/tailscale-exit', key, 'yt-exit-' + session_id[:12], advertise=True) as node:
            status = node.status()
            identity = status['Self']
            address = next(ip for ip in identity['TailscaleIPs'] if ipaddress.ip_address(ip).version == 4)
            egress = public_address()
            jobs.publish(session_id, owner, state='ready', node_id=identity['ID'], ipv4=address,
                egress_ip=egress, expires_at=deadline, heartbeat=int(time.time()))
            reason = 'SessionExpired'
            while time.time() < deadline:
                job = jobs.get(session_id)
                if job is None or job.get('stop_requested'):
                    reason = 'StopRequested'
                    break
                if node.status().get('BackendState') != 'Running':
                    reason = 'TailscaleDisconnected'
                    raise RuntimeError
                jobs.publish(session_id, owner, heartbeat=int(time.time()))
                time.sleep(min(5, max(0, deadline - time.time())))
            state = 'stopped'
    except Exception:
        # Exception messages may contain enrollment credentials, so publish a fixed code only.
        reason = 'ExitNodeFailure'
    finally:
        jobs.publish(session_id, owner, state=state, reason=reason, heartbeat=int(time.time()))
    return {'state': state}
