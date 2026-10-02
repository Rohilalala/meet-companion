#!/usr/bin/env bash
# Run on the owner's Mac. Only SSH is public; VNC stays on the instance loopback interface.
set -euo pipefail
REGION=ap-south-1
KEY="$HOME/.ssh/meet-companion-test.pem"
[ -f "$KEY" ] || { echo 'SSH key missing; run aws/launch-test.sh --prepare first' >&2; exit 2; }
COUNT=$(aws ec2 describe-instances --region "$REGION" --filters Name=tag:Project,Values=meet-companion-test Name=instance-state-name,Values=running --query 'length(Reservations[].Instances[])' --output text)
[ "$COUNT" -eq 1 ] || { echo 'Expected exactly one running test instance' >&2; exit 2; }
IP=$(aws ec2 describe-instances --region "$REGION" --filters Name=tag:Project,Values=meet-companion-test Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Test instance has no public IPv4' >&2; exit 2; }
echo 'SSH and localhost VNC tunnel ready. In the remote shell, run: ~/meet-companion/aws/start-desktop.sh --login'
echo 'On this Mac, open: vnc://127.0.0.1:5901'
exec ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:5901:127.0.0.1:5901 "ubuntu@$IP"
