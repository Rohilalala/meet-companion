import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(mode = '', options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'meet-aws-test-'));
  const bin = join(dir, 'bin'), home = join(dir, 'home'), log = join(dir, 'aws.log');
  mkdirSync(bin); mkdirSync(join(home, '.ssh'), { recursive: true });
  if (!options.missingKey) writeFileSync(join(home, '.ssh/meet-companion-test.pem'), 'test-only-key');
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho 203.0.113.7\n', { mode: 0o755 });
  writeFileSync(join(bin, 'aws'), `#!/bin/bash
printf '%q ' "$@" >> "$FAKE_LOG"
printf '\n' >> "$FAKE_LOG"
case "$1 $2" in
  'sts get-caller-identity') echo arn:aws:iam::123456789012:user/test ;;
  'ssm get-parameter') echo ami-0123456789abcdef0 ;;
  'ec2 describe-vpcs') echo vpc-test ;;
  'ec2 describe-subnets') echo subnet-test ;;
  'ec2 describe-security-groups')
    if [[ "$*" == *IpPermissions* ]]; then
      echo '[{"IpProtocol":"tcp","FromPort":22,"ToPort":22,"IpRanges":[{"CidrIp":"203.0.113.7/32"}]}]'
    elif [ "$FAKE_MISSING" = yes ]; then echo None
    else echo sg-test; fi ;;
  'ec2 describe-key-pairs') if [ "$FAKE_MISSING" = yes ]; then echo None; else echo meet-companion-test; fi ;;
  'ec2 describe-instances') echo 0 ;;
  'ec2 create-security-group') echo sg-test ;;
  'ec2 authorize-security-group-ingress') echo '{}' ;;
  'ec2 create-key-pair') echo test-only-key ;;
  'ec2 run-instances')
    if [[ "$*" == *--dry-run* ]]; then
      if [ "$FAKE_DRY" = allow ]; then echo 'DryRunOperation: request would succeed' >&2
      else echo 'UnauthorizedOperation: request denied' >&2; fi
      exit 255
    fi
    echo i-test ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync('bash', ['aws/launch-test.sh', ...(mode ? [mode] : [])], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log, FAKE_DRY: options.denied ? 'deny' : 'allow', FAKE_MISSING: options.missingKey ? 'yes' : 'no' },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(line => line.includes('ec2 run-instances'));
  rmSync(dir, { recursive: true, force: true });
  return { result, calls };
}

test('authorized dry run validates the exact request without launching', () => {
  const { result, calls } = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /--dry-run/);
  assert.match(calls[0], /--key-name meet-companion-test --security-group-ids sg-test --subnet-id subnet-test/);
});

test('AWS denial fails instead of reporting success', () => {
  const { result, calls } = run('', { denied: true });
  assert.equal(result.status, 4);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(result.stdout, /authorized/);
});

test('paid launch follows an authorized dry run', () => {
  const { result, calls } = run('--launch');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /--dry-run/);
  assert.doesNotMatch(calls[1], /--dry-run/);
});

test('preparation creates only free prerequisites then dry-runs', () => {
  const { result, calls } = run('--prepare', { missingKey: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /--dry-run/);
});
