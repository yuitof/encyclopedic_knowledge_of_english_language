"""An isolated userspace Tailscale process; credentials and logs stay private."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


class BridgeError(RuntimeError):
    """Only fixed, credential-free messages may be surfaced to the CLI."""


def auth_key(secrets, arn):
    value = secrets.get_secret_value(SecretId=arn)['SecretString'].strip()
    if not value.startswith('tskey-auth-') or any(c.isspace() for c in value):
        raise BridgeError('Tailscale secret must contain one auth key')
    return value


class TailscaleNode:
    def __init__(self, root, key, hostname):
        self.root, self.key, self.hostname = Path(root), key, hostname
        self.process = None
        self.directory = None

    def command(self, *arguments, timeout=10):
        if self.process is None or self.process.poll() is not None:
            raise BridgeError('Tailscale daemon is unavailable')
        try:
            result = subprocess.run([os.environ.get('TAILSCALE_BIN', 'tailscale'),
                '--socket=t.sock', *arguments], cwd=self.directory,
                capture_output=True, timeout=timeout, check=False)
            if result.returncode:
                raise BridgeError('Tailscale command failed; check enrollment and tailnet policy')
            return result.stdout
        except (OSError, subprocess.TimeoutExpired):
            raise BridgeError('Tailscale command could not complete') from None

    def status(self):
        try:
            return json.loads(self.command('status', '--json'))
        except (ValueError, TypeError):
            raise BridgeError('Invalid Tailscale status response') from None

    def __enter__(self):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.temporary = tempfile.TemporaryDirectory(prefix='n-', dir=self.root)
        self.directory = Path(self.temporary.name)
        keyfile = self.directory / 'auth-key'
        try:
            keyfile.touch(mode=0o600)
            keyfile.write_text(self.key)
            self.key = None
            arguments = [os.environ.get('TAILSCALED_BIN', 'tailscaled'),
                '--tun=userspace-networking', '--state=mem:',
                '--statedir=' + str(self.directory), '--socket=t.sock']
            # Relative socket paths also work in deeply nested isolated checkouts.
            self.process = subprocess.Popen(arguments, cwd=self.directory,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 10
            while not (self.directory / 't.sock').exists():
                if self.process.poll() is not None or time.monotonic() >= deadline:
                    raise BridgeError('Tailscale daemon did not start')
                time.sleep(0.1)
            self.command('up', '--auth-key=file:' + str(keyfile), '--hostname=' + self.hostname,
                '--accept-dns=false', '--accept-routes=false', '--ssh=false', '--timeout=30s',
                timeout=40)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise
        finally:
            keyfile.unlink(missing_ok=True)

    def serve(self, local_port, port=8443):
        self.command('serve', '--bg', '--yes', '--tcp=' + str(port),
                     'tcp://127.0.0.1:' + str(local_port))

    def __exit__(self, *args):
        if self.process is not None:
            try:
                self.command('logout', timeout=5)
            except BridgeError:
                pass
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
        if self.directory is not None:
            self.temporary.cleanup()
