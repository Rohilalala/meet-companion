#!/usr/bin/env bash
# Run from the SSH session after manual sign-in and after fully closing login Chrome.
set -euo pipefail
[ "$(id -u)" -ne 0 ] || { echo 'Run this as the ubuntu user' >&2; exit 2; }
APP=$(cd "$(dirname "$0")/.." && pwd -P)
export DISPLAY=:99
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$HOME/.local/meet-runtime}"
cd "$APP"
bash aws/start-desktop.sh
npm run preflight
exec npm run bot -- --live "$@"
