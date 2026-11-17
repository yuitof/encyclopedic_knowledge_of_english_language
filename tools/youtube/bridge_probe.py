"""Unsigned connectivity checks with explicit proxy selection and normal TLS checks."""
import ipaddress

import requests

from bridge_transport import BridgeError


def public_address(proxy=None):
    try:
        with requests.Session() as client:
            client.trust_env = False
            with client.get('https://checkip.amazonaws.com/', timeout=(5, 10),
                    proxies={'http': proxy, 'https': proxy} if proxy else {},
                    allow_redirects=False) as response:
                response.raise_for_status()
                address = ipaddress.ip_address(response.text.strip())
                if not address.is_global:
                    raise ValueError
                return str(address)
    except (requests.RequestException, ValueError):
        raise BridgeError('Could not verify the bridge public address') from None


def youtube_probe(proxy):
    results = []
    try:
        with requests.Session() as client:
            client.trust_env = False
            for path in ('/', '/feed/history?hl=en'):
                with client.get('https://www.youtube.com' + path, timeout=(5, 15),
                        proxies={'http': proxy, 'https': proxy}, allow_redirects=False) as response:
                    results.append({'path': path, 'status': response.status_code})
        return results
    except requests.RequestException:
        raise BridgeError('YouTube probe failed through the built-in VPN bridge') from None
