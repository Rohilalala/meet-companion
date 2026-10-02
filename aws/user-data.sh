#!/bin/bash
# Runs once at first boot. Install the cost guard before any network setup.
# The launch sets shutdown behaviour to "stop", so this halts billing for compute and the public IPv4;
# the retained 16 GiB disk keeps costing about $1.46 a month until the instance is terminated.
set -euo pipefail
MINUTES="__MAX_MINUTES__"
SOURCE_COMMIT="__SOURCE_COMMIT__"
PROVISION_SHA256="__PROVISION_SHA256__"
shutdown -h "+${MINUTES}" "meet-companion test window is over"
# Apply the same deadline after every later boot, in case the instance is restarted and forgotten.
cat > /etc/systemd/system/meet-companion-autostop.service <<UNIT
[Unit]
Description=Stop this test instance ${MINUTES} minutes after boot
[Service]
Type=oneshot
ExecStart=/sbin/shutdown -h +${MINUTES}
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable meet-companion-autostop.service

# The source is pinned to a pushed commit and verified against the local script hash.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl
curl -fsSL --retry 3 "https://raw.githubusercontent.com/Rohilalala/meet-companion/${SOURCE_COMMIT}/aws/provision.sh" -o /tmp/meet-provision.sh
printf '%s  %s\n' "$PROVISION_SHA256" /tmp/meet-provision.sh | sha256sum -c --status
bash /tmp/meet-provision.sh "$SOURCE_COMMIT"
