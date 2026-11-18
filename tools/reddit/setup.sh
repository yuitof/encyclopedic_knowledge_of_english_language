#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="$root/.codex/tmp/reddit"
mkdir -p "$cache/auth"
python3 -m venv "$cache/.venv"
"$cache/.venv/bin/python" -m pip install --disable-pip-version-check -r "$root/tools/reddit/requirements.txt"
"$cache/.venv/bin/python" -m pip freeze > "$cache/installed-versions.txt"
printf '%s\n' 'Reddit tools installed. No login or collection performed. See docs/reddit.md.'
