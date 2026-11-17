"""Unsigned connectivity checks with explicit proxy selection and normal TLS checks."""
import ipaddress

import requests

from .transport import BridgeError


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
    return origin_probe(proxy, [('www.youtube.com', '/'), ('www.youtube.com', '/feed/history?hl=en')])


def x_probe(proxy):
    # Unsigned, small resources on both hosts needed by the authenticated X client.
    # A successful response checks connectivity, not account/API authorization.
    return origin_probe(proxy, [('x.com', '/robots.txt'), ('abs.twimg.com', '/favicons/twitter.3.ico')])


def origin_probe(proxy, destinations):
    results = []
    try:
        with requests.Session() as client:
            client.trust_env = False
            for host, path in destinations:
                with client.get('https://' + host + path, timeout=(5, 15),
                        proxies={'http': proxy, 'https': proxy}, allow_redirects=False) as response:
                    results.append({'host': host, 'path': path, 'status': response.status_code})
        return results
    except requests.RequestException:
        raise BridgeError('Origin probe failed through the built-in VPN bridge') from None
