#!/usr/bin/env bash
# Run as ubuntu after SSH login. VNC accepts only local connections; use aws/connect.sh as the tunnel.
set -euo pipefail
[ "$(id -u)" -ne 0 ] || { echo 'Run this as the ubuntu user' >&2; exit 2; }
case "${1:-}" in ''|--login) ;; *) echo 'Usage: aws/start-desktop.sh [--login]' >&2; exit 2;; esac

APP=$(cd "$(dirname "$0")/.." && pwd -P)
export DISPLAY=:99
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$HOME/.local/meet-runtime}"
install -d -m 0700 "$XDG_RUNTIME_DIR" "$APP/.local"
PASSWORD_FILE="$APP/.local/vnc-password"
AUTH_FILE="$APP/.local/vnc-auth"
if [ ! -s "$PASSWORD_FILE" ]; then
  (umask 077; python3 -c 'import secrets; print(secrets.token_hex(4))' > "$PASSWORD_FILE")
fi
if [ ! -s "$AUTH_FILE" ]; then
  x11vnc -storepasswd "$(cat "$PASSWORD_FILE")" "$AUTH_FILE" >/dev/null 2>&1
  chmod 600 "$AUTH_FILE"
fi

start_once() {
  local name=$1; shift
  local pidfile="$APP/.local/${name}.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then return; fi
  nohup "$@" > "$APP/.local/${name}.log" 2>&1 < /dev/null &
  echo $! > "$pidfile"
  sleep 1
  kill -0 "$(cat "$pidfile")" 2>/dev/null || { echo "$name failed; check .local/${name}.log" >&2; exit 1; }
}

start_once xvfb Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -ac
start_once vnc x11vnc -display :99 -localhost -rfbport 5901 -forever -shared -rfbauth "$AUTH_FILE"

# Enforce the loopback-only boundary even if a future x11vnc version changes its flags.
LISTENERS=$(ss -ltn '( sport = :5901 )' | awk 'NR > 1 { print $4 }')
[ -n "$LISTENERS" ] || { echo 'VNC listener missing' >&2; exit 1; }
while IFS= read -r listener; do
  case "$listener" in 127.0.0.1:5901|'[::1]:5901') ;; *) echo 'VNC listener is not loopback-only' >&2; exit 1;; esac
done <<< "$LISTENERS"

cd "$APP"
bash scripts/linux-audio.sh
echo 'Desktop ready on the SSH tunnel. On your Mac, open vnc://127.0.0.1:5901.'
if [ "${1:-}" = --login ]; then exec npm run bot:login; fi
echo 'To sign in: aws/start-desktop.sh --login'
