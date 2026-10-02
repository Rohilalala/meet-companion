#!/usr/bin/env bash
# Short paid test of the Linux port on EC2 (Mumbai). Prints the plan and asks AWS for a dry run by default.
# Nothing billable starts unless you pass --launch. See docs/AWS_TEST.md.
set -euo pipefail

REGION=ap-south-1
TYPE="${TYPE:-t4g.medium}"
MINUTES="${MINUTES:-120}"
TAG="Project=meet-companion-test"
MODE=dry-run
[ "${1:-}" = "--launch" ] && MODE=launch

case "$TYPE" in t4g.medium|t4g.large) ;; *) echo "TYPE must be t4g.medium or t4g.large" >&2; exit 2;; esac
case "$MINUTES" in ''|*[!0-9]*) echo "MINUTES must be a number" >&2; exit 2;; esac
[ "$MINUTES" -ge 15 ] && [ "$MINUTES" -le 240 ] || { echo "MINUTES must be 15-240" >&2; exit 2; }

ARN=$(aws sts get-caller-identity --query Arn --output text)
case "$ARN" in *:root) echo "Refusing to run as the account root user. Use the scoped identity from docs/AWS_TEST.md." >&2; exit 3;; esac

AMI=$(aws ssm get-parameter --region "$REGION" --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
MYIP=$(curl -s --max-time 10 https://checkip.amazonaws.com)
case "$MYIP" in *[!0-9.]*|'') echo "Could not read this machine's public IPv4" >&2; exit 4;; esac

echo "Plan: 1 x $TYPE, Ubuntu 24.04 ARM64 ($AMI), 16 GiB gp3, $REGION"
echo "      SSH allowed only from $MYIP/32; stops itself after $MINUTES minutes; CPU credits 'standard' (no surplus charges)"
echo "      Mode: $MODE"

SG=$(aws ec2 describe-security-groups --region "$REGION" --filters Name=group-name,Values=meet-companion-test --query 'SecurityGroups[0].GroupId' --output text)
if [ "$MODE" = launch ] && [ "$SG" = None ]; then
  SG=$(aws ec2 create-security-group --region "$REGION" --group-name meet-companion-test --description "Meet Companion test: SSH from one address" --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=meet-companion-test}]" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" --protocol tcp --port 22 --cidr "$MYIP/32" >/dev/null
fi
KEY="$HOME/.ssh/meet-companion-test.pem"
if [ "$MODE" = launch ] && [ ! -f "$KEY" ]; then
  # The private key stays in ~/.ssh on this machine; it is never written into the repository.
  (umask 077; aws ec2 create-key-pair --region "$REGION" --key-name meet-companion-test --key-type ed25519 --tag-specifications "ResourceType=key-pair,Tags=[{Key=Project,Value=meet-companion-test}]" --query KeyMaterial --output text > "$KEY")
fi

ARGS=(--region "$REGION" --image-id "$AMI" --instance-type "$TYPE" --count 1
  --instance-initiated-shutdown-behavior stop
  --credit-specification CpuCredits=standard
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=16,VolumeType=gp3,DeleteOnTermination=true}'
  --metadata-options HttpTokens=required
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=meet-companion-test}]" "ResourceType=volume,Tags=[{Key=Project,Value=meet-companion-test}]"
  --user-data "$(sed "s/\${MEET_COMPANION_MAX_MINUTES:-120}/$MINUTES/" "$(dirname "$0")/user-data.sh")")

if [ "$MODE" = dry-run ]; then
  # --dry-run asks AWS whether the call would be allowed. It creates nothing and costs nothing.
  aws ec2 run-instances "${ARGS[@]}" --dry-run 2>&1 | tail -1 || true
  echo "Dry run only. Re-run with --launch to start the paid test."
  exit 0
fi
ID=$(aws ec2 run-instances "${ARGS[@]}" --key-name meet-companion-test --security-group-ids "$SG" --query 'Instances[0].InstanceId' --output text)
echo "Launched $ID. It stops itself in $MINUTES minutes."
echo "Stop now:      aws ec2 stop-instances --region $REGION --instance-ids $ID"
echo "Delete (no more disk charge): aws ec2 terminate-instances --region $REGION --instance-ids $ID"
