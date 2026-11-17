#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
python="$root/.codex/tmp/x/.venv/bin/python"
if [[ ! -x "$python" ]]; then
  printf '%s\n' 'Run bash tools/x/setup.sh first.' >&2
  exit 1
fi
if [[ "${1:-}" == login ]]; then
  if ! "$python" -c 'from importlib.metadata import version; assert version("yt-dlp") == "2026.10.26"' 2>/dev/null; then
    "$python" -m pip install --disable-pip-version-check -r "$root/tools/x/requirements-local.txt"
  fi
fi
exec "$python" "$root/tools/x/x.py" "$@"
