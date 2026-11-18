#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --browser ) ]]; then
  printf '%s\n' 'Use setup.sh or setup.sh --browser.' >&2
  exit 1
fi
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="$root/.codex/tmp/reddit"
mkdir -p "$cache/auth"
python3 -m venv "$cache/.venv"
"$cache/.venv/bin/python" -m pip install --disable-pip-version-check -r "$root/tools/reddit/requirements.txt"
if [[ "${1:-}" == --browser ]]; then
  "$cache/.venv/bin/python" -m pip install --disable-pip-version-check -r "$root/tools/reddit/requirements-browser.txt"
fi
"$cache/.venv/bin/python" -m pip freeze > "$cache/installed-versions.txt"
printf '%s\n' 'Reddit tools installed. No login or collection performed. See docs/reddit.md.'
