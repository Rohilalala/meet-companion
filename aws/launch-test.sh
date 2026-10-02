#!/usr/bin/env bash
# Short paid test of the Linux port on EC2 (Mumbai). Prints the plan and asks AWS for a dry run by default.
# Nothing billable starts unless you pass --launch. See docs/AWS_TEST.md.
set -euo pipefail

REGION=ap-south-1
TYPE="${TYPE:-t4g.medium}"
MINUTES="${MINUTES:-120}"
TAG="Project=meet-companion-test"
MODE=dry-run
case "${1:-}" in
  '') ;;
  --prepare) MODE=prepare ;;
  --launch) MODE=launch ;;
  *) echo "Usage: aws/launch-test.sh [--prepare|--launch]" >&2; exit 2 ;;
esac

case "$TYPE" in t4g.medium|t4g.large) ;; *) echo "TYPE must be t4g.medium or t4g.large" >&2; exit 2;; esac
case "$MINUTES" in ''|*[!0-9]*) echo "MINUTES must be a number" >&2; exit 2;; esac
[ "$MINUTES" -ge 15 ] && [ "$MINUTES" -le 240 ] || { echo "MINUTES must be 15-240" >&2; exit 2; }

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
SOURCE_COMMIT=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
[[ "$SOURCE_COMMIT" =~ ^[a-f0-9]{40}$ ]] || { echo "Source commit invalid" >&2; exit 2; }
PROVISION_SHA256=$(shasum -a 256 "$PROJECT_ROOT/aws/provision.sh" | awk '{print $1}')
[[ "$PROVISION_SHA256" =~ ^[a-f0-9]{64}$ ]] || { echo "Provisioning checksum invalid" >&2; exit 2; }
if [ "$MODE" = launch ]; then
  git -C "$PROJECT_ROOT" cat-file -e HEAD:aws/provision.sh || { echo "Provisioning script must be committed" >&2; exit 2; }
  git -C "$PROJECT_ROOT" diff --quiet HEAD -- aws/launch-test.sh aws/user-data.sh aws/provision.sh || { echo "Commit the AWS scripts before launching" >&2; exit 2; }
  SOURCE_BRANCH=$(git -C "$PROJECT_ROOT" symbolic-ref --quiet --short HEAD) || { echo "Launch from a named branch" >&2; exit 2; }
  REMOTE_COMMIT=$(git -C "$PROJECT_ROOT" ls-remote origin "refs/heads/$SOURCE_BRANCH" | awk '{print $1}')
  [ "$REMOTE_COMMIT" = "$SOURCE_COMMIT" ] || { echo "Push this exact commit before launching" >&2; exit 2; }
fi
USER_DATA=$(sed -e "s/__MAX_MINUTES__/$MINUTES/g" -e "s/__SOURCE_COMMIT__/$SOURCE_COMMIT/g" -e "s/__PROVISION_SHA256__/$PROVISION_SHA256/g" "$PROJECT_ROOT/aws/user-data.sh")
[ "${#USER_DATA}" -le 16384 ] || { echo "EC2 user data exceeds 16 KiB" >&2; exit 2; }

ARN=$(aws sts get-caller-identity --query Arn --output text)
case "$ARN" in *:root) echo "Refusing to run as the account root user. Use the scoped identity from docs/AWS_TEST.md." >&2; exit 3;; esac

AMI=$(aws ssm get-parameter --region "$REGION" --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
MYIP=$(curl -s --max-time 10 https://checkip.amazonaws.com)
if ! [[ "$MYIP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then echo "Could not read this machine's public IPv4" >&2; exit 4; fi
IFS=. read -r -a OCTETS <<< "$MYIP"
for OCTET in "${OCTETS[@]}"; do [ "$OCTET" -le 255 ] || { echo "Invalid public IPv4" >&2; exit 4; }; done
VPC=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC" != None ] || { echo "Default VPC required" >&2; exit 4; }
SUBNET=$(aws ec2 describe-subnets --region "$REGION" --filters "Name=vpc-id,Values=$VPC" --query 'Subnets[?MapPublicIpOnLaunch==`true`]|[0].SubnetId' --output text)
[ "$SUBNET" != None ] || { echo "Public subnet required" >&2; exit 4; }

echo "Plan: 1 x $TYPE, Ubuntu 24.04 ARM64 ($AMI), 16 GiB gp3, $REGION"
echo "      SSH allowed only from $MYIP/32; stops itself after $MINUTES minutes; CPU credits 'standard' (no surplus charges)"
echo "      Mode: $MODE"

SG=$(aws ec2 describe-security-groups --region "$REGION" --filters Name=group-name,Values=meet-companion-test "Name=vpc-id,Values=$VPC" --query 'SecurityGroups[0].GroupId' --output text)
KEY="$HOME/.ssh/meet-companion-test.pem"
REMOTE_KEY=$(aws ec2 describe-key-pairs --region "$REGION" --filters Name=key-name,Values=meet-companion-test --query 'KeyPairs[0].KeyName' --output text)
if [ "$MODE" = dry-run ] && { [ "$SG" = None ] || [ "$REMOTE_KEY" = None ] || [ ! -f "$KEY" ]; }; then
  echo "Exact dry run needs the free security group and key pair. Run --prepare first; nothing was created." >&2
  exit 2
fi
if [ "$MODE" != dry-run ] && [ "$SG" = None ]; then
  SG=$(aws ec2 create-security-group --region "$REGION" --vpc-id "$VPC" --group-name meet-companion-test --description "Meet Companion test: SSH from one address" --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=meet-companion-test}]" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" --protocol tcp --port 22 --cidr "$MYIP/32" >/dev/null
fi
if [ "$MODE" != dry-run ] && [ "$REMOTE_KEY" = None ] && [ ! -f "$KEY" ]; then
  # The private key stays in ~/.ssh on this machine; it is never written into the repository.
  mkdir -p -m 700 "$HOME/.ssh"
  (umask 077; aws ec2 create-key-pair --region "$REGION" --key-name meet-companion-test --key-type ed25519 --tag-specifications "ResourceType=key-pair,Tags=[{Key=Project,Value=meet-companion-test}]" --query KeyMaterial --output text > "$KEY")
  REMOTE_KEY=meet-companion-test
elif { [ "$REMOTE_KEY" = None ] && [ -f "$KEY" ]; } || { [ "$REMOTE_KEY" != None ] && [ ! -f "$KEY" ]; }; then
  echo "Local SSH key and AWS key pair disagree; resolve them before launch." >&2
  exit 4
fi
chmod 600 "$KEY"

# A reused group must not expose another address or port. Do not silently inherit old ingress.
PERMISSIONS=$(aws ec2 describe-security-groups --region "$REGION" --group-ids "$SG" --query 'SecurityGroups[0].IpPermissions' --output json)
printf '%s' "$PERMISSIONS" | python3 -c 'import json,sys; p=json.load(sys.stdin); ip=sys.argv[1]; ok=len(p)==1 and p[0].get("IpProtocol")=="tcp" and p[0].get("FromPort")==22 and p[0].get("ToPort")==22 and p[0].get("IpRanges")==[{"CidrIp":ip+"/32"}] and not p[0].get("Ipv6Ranges") and not p[0].get("UserIdGroupPairs") and not p[0].get("PrefixListIds"); sys.exit(0 if ok else 1)' "$MYIP" || { echo "Security group ingress is not exactly SSH from this IP; review it before launch." >&2; exit 4; }

EXISTING=$(aws ec2 describe-instances --region "$REGION" --filters Name=tag:Project,Values=meet-companion-test Name=instance-state-name,Values=pending,running,stopping,stopped --query 'length(Reservations[].Instances[])' --output text)
[ "$EXISTING" -eq 0 ] || { echo "A tagged test instance already exists; stop or inspect it before launching another." >&2; exit 4; }

ARGS=(--region "$REGION" --image-id "$AMI" --instance-type "$TYPE" --count 1
  --key-name meet-companion-test --security-group-ids "$SG" --subnet-id "$SUBNET"
  --instance-initiated-shutdown-behavior stop
  --credit-specification CpuCredits=standard
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=16,VolumeType=gp3,DeleteOnTermination=true}'
  --metadata-options HttpTokens=required
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=meet-companion-test}]" "ResourceType=volume,Tags=[{Key=Project,Value=meet-companion-test}]"
  --user-data "$USER_DATA")

# AWS reports an authorized dry run as a nonzero DryRunOperation error. Anything else is a failure.
DRY_RESULT=$(aws ec2 run-instances "${ARGS[@]}" --dry-run 2>&1) && DRY_STATUS=0 || DRY_STATUS=$?
if [ "$DRY_STATUS" -eq 0 ] || [[ "$DRY_RESULT" != *DryRunOperation* ]]; then
  echo "AWS denied or could not validate the exact launch. No instance started." >&2
  exit 4
fi
echo "AWS authorized the exact launch request; no instance started by the dry run."
if [ "$MODE" != launch ]; then exit 0; fi
ID=$(aws ec2 run-instances "${ARGS[@]}" --query 'Instances[0].InstanceId' --output text)
echo "Launched $ID. It stops itself in $MINUTES minutes."
echo "Stop now:      aws ec2 stop-instances --region $REGION --instance-ids $ID"
echo "Delete (no more disk charge): aws ec2 terminate-instances --region $REGION --instance-ids $ID"
