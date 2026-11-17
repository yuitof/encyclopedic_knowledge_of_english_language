"""Hold one private Tailscale CONNECT proxy during an active Lambda invocation."""
import ipaddress
import os
import time
import urllib.request

import boto3

from sessions import Jobs, SESSION_ID
from proxy import Proxy
from tailscale_node import TailscaleNode, auth_key


def public_address():
    # Lambda's ordinary egress, independent of ambient application proxy variables.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            'https://checkip.amazonaws.com/', timeout=10) as response:
        address = ipaddress.ip_address(response.read(128).decode().strip())
        if not address.is_global:
            raise ValueError('Nonpublic egress address')
        return str(address)


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
        with TailscaleNode('/tmp/tailscale-bridge', key, 'service-bridge-' + session_id[:12]) as node:
            identity = node.status()['Self']
            address = next(ip for ip in identity['TailscaleIPs'] if ipaddress.ip_address(ip).version == 4)
            egress = public_address()
            with Proxy(job['proxy_token_hash'], deadline) as proxy:
                proxy.check()
                node.serve(proxy.port)
                jobs.publish(session_id, owner, state='ready', node_id=identity['ID'], ipv4=address,
                    proxy_port=8443, egress_ip=egress, expires_at=deadline, heartbeat=int(time.time()))
                reason = 'SessionExpired'
                while time.time() < deadline:
                    job = jobs.get(session_id)
                    if job is None or job.get('stop_requested'):
                        reason = 'StopRequested'
                        break
                    proxy.check()
                    if node.status().get('BackendState') != 'Running':
                        raise RuntimeError('Tailscale disconnected')
                    jobs.publish(session_id, owner, heartbeat=int(time.time()))
                    time.sleep(min(5, max(0, deadline - time.time())))
            state = 'stopped'
    except Exception:
        # Credentials and request contents must never enter operational logs.
        reason = 'BridgeFailure'
    finally:
        jobs.publish(session_id, owner, state=state, reason=reason, heartbeat=int(time.time()))
    return {'state': state}
