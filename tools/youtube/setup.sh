#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="$root/.codex/tmp/youtube"
mkdir -p "$cache/transcripts" "$cache/auth"
python3 -m venv "$cache/.venv"
"$cache/.venv/bin/python" -m pip install --disable-pip-version-check -r "$root/tools/youtube/requirements.txt"
"$cache/.venv/bin/python" -m pip freeze > "$cache/installed-versions.txt"
printf '%s\n' 'YouTube tools installed. Session login and live history check are separate; see docs/youtube-cloud.md.'
