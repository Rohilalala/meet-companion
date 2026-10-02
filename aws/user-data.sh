#!/bin/bash
# Runs once at first boot. The only job here is the cost guard: the machine stops itself.
# The launch sets shutdown behaviour to "stop", so this halts billing for compute and the public IPv4;
# the retained 16 GiB disk keeps costing about $1.46 a month until the instance is terminated.
MINUTES="${MEET_COMPANION_MAX_MINUTES:-120}"
shutdown -h "+${MINUTES}" "meet-companion test window is over"
# Stop again 30 minutes after every later boot, in case the instance is started and forgotten.
cat > /etc/systemd/system/meet-companion-autostop.service <<'UNIT'
[Unit]
Description=Stop this test instance 120 minutes after boot
[Service]
Type=oneshot
ExecStart=/sbin/shutdown -h +120
[Install]
WantedBy=multi-user.target
UNIT
systemctl enable meet-companion-autostop.service
