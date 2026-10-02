#!/usr/bin/env bash
# First-boot Ubuntu ARM64 setup. Called by user data only after its shutdown guard is installed.
set -euo pipefail

SOURCE_COMMIT="${1:?Pinned public source commit required}"
[[ "$SOURCE_COMMIT" =~ ^[a-f0-9]{40}$ ]] || { echo 'SOURCE_COMMIT_INVALID' >&2; exit 2; }
[ "$(id -u)" -eq 0 ] && [ "$(uname -m)" = aarch64 ] || { echo 'UBUNTU_ARM64_ROOT_REQUIRED' >&2; exit 2; }
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || { echo 'UBUNTU_2404_REQUIRED' >&2; exit 2; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl ffmpeg git iproute2 lsof pulseaudio pulseaudio-utils python3-venv x11vnc xauth xvfb xz-utils

NODE_VERSION=v22.23.3
NODE_ARCHIVE="node-${NODE_VERSION}-linux-arm64.tar.xz"
curl -fsSL --retry 3 "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}" -o /tmp/meet-node.tar.xz
curl -fsSL --retry 3 "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o /tmp/meet-node-sha.txt
NODE_SHA=$(awk -v name="$NODE_ARCHIVE" '$2 == name { print $1 }' /tmp/meet-node-sha.txt)
[[ "$NODE_SHA" =~ ^[a-f0-9]{64}$ ]] || { echo 'NODE_CHECKSUM_MISSING' >&2; exit 1; }
printf '%s  %s\n' "$NODE_SHA" /tmp/meet-node.tar.xz | sha256sum -c --status
tar -xJf /tmp/meet-node.tar.xz -C /usr/local --strip-components=1

curl -fsSL --retry 3 https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb -o /tmp/meet-chrome.deb
apt-get install -y -qq /tmp/meet-chrome.deb

python3 -m venv /opt/meet-yt
/opt/meet-yt/bin/pip install --disable-pip-version-check --quiet yt-dlp
ln -sf /opt/meet-yt/bin/yt-dlp /usr/local/bin/yt-dlp

APP=/home/ubuntu/meet-companion
install -d -m 0750 -o ubuntu -g ubuntu "$APP"
runuser -u ubuntu -- git -C "$APP" init -q
runuser -u ubuntu -- git -C "$APP" remote add origin https://github.com/Rohilalala/meet-companion.git
runuser -u ubuntu -- git -C "$APP" fetch -q --depth 1 origin "$SOURCE_COMMIT"
runuser -u ubuntu -- git -C "$APP" checkout -q --detach FETCH_HEAD
runuser -u ubuntu -- env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 /usr/local/bin/npm --prefix "$APP" ci --ignore-scripts --silent
runuser -u ubuntu -- cp -n "$APP/config.example.linux.json" "$APP/config.local.json"
chmod 600 "$APP/config.local.json"
runuser -u ubuntu -- /usr/local/bin/node "$APP/scripts/check.js"

install -d -m 0755 /var/lib/meet-companion
printf '%s\n' "$SOURCE_COMMIT" > /var/lib/meet-companion/provisioned-commit
echo 'BOOTSTRAP_READY: use aws/connect.sh, then aws/start-desktop.sh and sign in manually.'
