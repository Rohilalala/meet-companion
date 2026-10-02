#!/usr/bin/env bash
# Run on the owner's Mac. Keep this shell open while the AWS bot uses local yt-dlp.
set -euo pipefail
[ "$#" -eq 1 ] && [[ "$1" =~ ^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$ ]] || {
  echo 'Usage: aws/run-with-local-media.sh https://meet.google.com/xxx-xxxx-xxx' >&2
  exit 2
}
[ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || { echo 'Node 22 required; run nvm use' >&2; exit 2; }
APP=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$APP"
KEY="$HOME/.ssh/meet-companion-test.pem"
[ -f "$KEY" ] || { echo 'AWS trial SSH key missing' >&2; exit 2; }
IP=$(aws ec2 describe-instances --region ap-south-1 --filters Name=tag:Project,Values=meet-companion-test Name=instance-state-name,Values=running --query 'Reservations[].Instances[].PublicIpAddress' --output text)
[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Expected one running trial instance with a public IPv4 address' >&2; exit 2; }

relay_token=$(openssl rand -hex 32)
export MEET_MEDIA_TOKEN="$relay_token"
node scripts/media-worker.js &
worker_pid=$!
ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
  -N -R 127.0.0.1:3212:127.0.0.1:3212 "ubuntu@$IP" &
tunnel_pid=$!
cleanup() {
  printf '%s\n' "$relay_token" | ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=5 "ubuntu@$IP" \
    'IFS= read -r token; for pid in $(pgrep -f "^node scripts/bot-run.js"); do
       while IFS= read -r entry; do
         if [ "$entry" = "MEET_MEDIA_TOKEN=$token" ]; then kill -TERM "$pid"; break; fi
       done < <(tr "\0" "\n" < "/proc/$pid/environ")
     done' >/dev/null 2>&1 || true
  kill "$tunnel_pid" "$worker_pid" 2>/dev/null || true
  wait "$tunnel_pid" "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
for _ in $(seq 1 20); do
  if lsof -nP -iTCP:3212 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  kill -0 "$worker_pid" "$tunnel_pid" 2>/dev/null || { echo 'Media worker or SSH tunnel exited' >&2; exit 1; }
  sleep 0.25
done
kill -0 "$worker_pid" "$tunnel_pid" 2>/dev/null || exit 1
echo 'Local media worker and loopback SSH relay are ready. Admit the bot in the remote desktop.'
printf '%s\n%s\n' "$relay_token" "$1" | ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "ubuntu@$IP" \
  'IFS= read -r MEET_MEDIA_TOKEN; IFS= read -r meeting; export MEET_MEDIA_TOKEN; cd ~/meet-companion; exec bash aws/run-bot.sh --windowed --manual-join --meeting "$meeting"'
