#!/usr/bin/env bash
# Install official pinned Linux binaries into the private workflow runtime.
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ "$(uname -s)" == Linux ]] || { printf '%s\n' 'This installer is for Linux Cloud VMs.' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) arch=amd64; checksum=e56693ff74a64f2591b7e819c280635a100aae1ddfb0ef058fcd052b7cd8d16c ;;
  aarch64|arm64) arch=arm64; checksum=d6bed2720310b328b861f943d7b4016c5358a9bad60575eb51e8143b79068484 ;;
  *) printf '%s\n' 'Unsupported Linux architecture.' >&2; exit 1 ;;
esac
runtime="$root/.codex/tmp/youtube"
mkdir -p "$runtime/bin"
download="$(mktemp -d "$runtime/tailscale-download.XXXXXX")"
trap 'rm -rf -- "$download"' EXIT
archive="tailscale_1.104.7_${arch}.tgz"
curl -q -fsS --connect-timeout 10 --max-time 120 "https://pkgs.tailscale.com/stable/$archive" -o "$download/$archive"
python3 - "$download/$archive" "$checksum" "$runtime/bin" <<'PY'
import hashlib
import os
from pathlib import Path
import sys
import tarfile

archive, expected, destination = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('Tailscale archive checksum mismatch')
with tarfile.open(archive) as source:
    for name in ('tailscale', 'tailscaled'):
        member = source.getmember(archive.name.removesuffix('.tgz') + '/' + name)
        if not member.isfile():
            raise SystemExit('Invalid Tailscale archive member')
        target = destination / name
        temporary = destination / ('.' + name)
        temporary.write_bytes(source.extractfile(member).read())
        temporary.chmod(0o700)
        os.replace(temporary, target)
print('Installed Tailscale 1.104.7. Enrollment is performed only by exit-node sessions.')
PY
