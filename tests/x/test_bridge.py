"""Synthetic X proxy routing and CLI boundaries; no live account or AWS data."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/x'))
sys.path.insert(0, str(ROOT / 'tools'))
from api import Client, XError
from cloud_bridge import client as bridge, probe
spec = importlib.util.spec_from_file_location('x_bridge_cli', ROOT / 'tools/x/x.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
PROXY = 'http://127.0.0.1:12345'


class XBridgeTests(unittest.TestCase):
    def test_explicit_proxy_overrides_ambient_for_api_and_assets_with_tls(self):
        cookies = [{'name': 'ct0', 'value': 'synthetic', 'domain': '.x.com'}]
        with patch.dict(os.environ, {'HTTPS_PROXY':'http://ambient.invalid:1234'}):
            client = Client(cookies, ROOT, Mock(), proxy=PROXY)
            try:
                adapter = Mock()
                response = requests.Response()
                response.status_code = 200
                response._content = b''
                adapter.send.return_value = response
                client.http.mount('https://', adapter)
                for url in ('https://x.com/home', 'https://abs.twimg.com/responsive-web/client-web/synthetic.js'):
                    client.get(url)
                    call = adapter.send.call_args
                    self.assertEqual(call.kwargs['proxies']['https'], PROXY)
                    self.assertTrue(call.kwargs['verify'])
                    if 'abs.twimg.com' in url:
                        self.assertNotIn('Cookie', call.args[0].headers)
            finally:
                client.http.close()

    def test_proxy_failure_is_sanitized_and_no_direct_retry(self):
        client = Client([{'name':'ct0','value':'synthetic','domain':'.x.com'}], ROOT, Mock(), proxy=PROXY)
        try:
            with patch.object(client.http, 'get', side_effect=requests.exceptions.ProxyError('private-token')) as get:
                with self.assertRaises(XError) as e:
                    client.get('https://x.com/home')
                self.assertNotIn('private-token', str(e.exception))
                get.assert_called_once()
                self.assertEqual(get.call_args.kwargs['proxies']['https'], PROXY)
        finally:
            client.http.close()

    def test_unapproved_hosts_ports_and_invalid_proxy_rejected(self):
        cookies = [{'name':'ct0','value':'synthetic','domain':'.x.com'}]
        for proxy in ('socks5://localhost:1234', 'http://', 'http://localhost:invalid'):
            with self.subTest(proxy=proxy), self.assertRaises(XError):
                Client(cookies, ROOT, Mock(), proxy=proxy)
        client = Client(cookies, ROOT, Mock(), proxy=PROXY)
        try:
            with patch.object(client.http, 'get', side_effect=AssertionError('Network forbidden')):
                for url in ('http://x.com/', 'https://x.com:8443/', 'https://api.x.com/', 'https://x.com.evil/'):
                    with self.subTest(url=url), self.assertRaises(XError):
                        client.get(url)
        finally:
            client.http.close()

    def test_cli_forwards_account_and_failure_exit_status(self):
        with patch.object(sys, 'argv', ['x.py','--account','42','bridge','--','refresh','--resume']), \
                patch.object(cli, 'lock', side_effect=AssertionError('Only child collector owns the lock')), \
                patch.object(bridge, 'command', return_value=1) as command:
            self.assertEqual(cli.main(), 1)
        self.assertEqual(command.call_args.kwargs, {'workflow':'x'})
        self.assertEqual(command.call_args.args[0].arguments, ['--account','42','refresh','--resume'])

    def test_offline_bridge_never_invokes_aws(self):
        with patch.object(bridge, 'command', side_effect=AssertionError('AWS forbidden')):
            with self.assertRaisesRegex(ValueError, 'Offline'):
                cli.service_bridge(types.SimpleNamespace(offline=True))

    def test_unsigned_probe_has_no_session_cookies_and_only_required_hosts(self):
        with patch.object(probe.requests, 'Session') as session:
            http = session.return_value.__enter__.return_value
            http.get.return_value.__enter__.return_value.status_code = 200
            results = probe.x_probe(PROXY)
        self.assertFalse(http.trust_env)
        self.assertEqual([c.args[0] for c in http.get.call_args_list],
            ['https://x.com/robots.txt', 'https://abs.twimg.com/favicons/twitter.3.ico'])
        for c in http.get.call_args_list:
            self.assertEqual(c.kwargs['proxies']['https'], PROXY)
            self.assertFalse(c.kwargs['allow_redirects'])
        self.assertEqual([r['status'] for r in results], [200,200])


if __name__ == '__main__':
    unittest.main()
