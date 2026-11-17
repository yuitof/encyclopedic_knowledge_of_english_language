#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$root/.codex/tmp/youtube/bin:$PATH"
python="$root/.codex/tmp/youtube/.venv/bin/python"
if [[ ! -x "$python" ]]; then
  printf '%s\n' 'Run bash tools/youtube/setup.sh first.' >&2
  exit 1
fi
if [[ "${1:-}" == login ]]; then
  if ! "$python" -c 'from importlib.metadata import version; assert version("yt-dlp") == "2026.10.26"' 2>/dev/null; then
    "$python" -m pip install --disable-pip-version-check -r "$root/tools/youtube/requirements-local.txt"
  fi
fi
exec "$python" "$root/tools/youtube/youtube.py" "$@"
