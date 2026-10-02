# Short AWS test of the Linux port

Nothing here has been launched. `aws/launch-test.sh` verifies the exact launch request with a free AWS dry run once its security group and SSH key pair exist. On a fresh account, use `aws/launch-test.sh --prepare` to create only those free prerequisites and run the dry run. The script reports denials as failures; it launches a billable instance only with `--launch`.

The launch pins the current pushed Git commit and the SHA-256 of `aws/provision.sh` in EC2 user data. First boot schedules shutdown before installing Chrome, Node 22, PulseAudio, Xvfb, x11vnc, ffmpeg, yt-dlp, and the checked-out repository. The bot does **not** auto-join; account sign-in and the Meet test remain manual. If downloads or setup fail, the shutdown deadline still applies. The actual EC2 bootstrap has not been run yet.

The launch guard has account-free shell tests: `node --test aws/launch-test.test.js`.

## Cost (Mumbai, `ap-south-1`)

Prices from the AWS Pricing API on 2026-10-02: `t4g.medium` $0.0224 per hour, gp3 storage $0.0912 per GiB-month, public IPv4 $0.005 per hour.

| Item | 2-hour test | If the stopped instance is kept all month |
| --- | ---: | ---: |
| Compute, `t4g.medium` | $0.045 | $0 |
| Public IPv4 while running | $0.010 | $0 |
| 16 GiB gp3 disk | under $0.01 | $1.46 |
| Data transfer out (first 100 GB a month is free) | $0 | $0 |
| **Total before tax** | **about $0.06** | **$1.46** |

`t4g.large` doubles the compute line ($0.0448 per hour). Terminating the instance ends the disk charge.

Two settings keep the bill bounded: CPU credits are set to `standard`, so a busy burstable instance slows down instead of running up surplus-credit charges; and the instance stops itself 120 minutes after every boot (`aws/user-data.sh`), with shutdown behaviour `stop`.

`t4g.medium` is a candidate, not a decision. Chrome encoding a 1080p presentation in software on 2 vCPUs is unmeasured.

## Before the first paid launch — needs you

1. **A scoped AWS identity.** The AWS CLI on the Mac is signed in as the account root user, and `aws/launch-test.sh` refuses to run as root. Create an IAM user or role with the example `aws/test-policy.json` attached and configure the CLI to use it. The example restricts instance type, region and project tag, but its key-pair and security-group permissions are region-wide; review and tighten it before production use.
2. **Prepare and dry-run**: from a clean, pushed branch containing this kit, `aws/launch-test.sh --prepare` creates the free SSH key pair and security group, then asks AWS to validate the full instance request without launching it. On later runs, `aws/launch-test.sh` checks the existing prerequisites without changing AWS. A second tagged instance is refused.
3. **Paid launch only after reviewing the plan**: run `aws/launch-test.sh --launch`. It refuses an uncommitted AWS script or a commit that does not match the public branch. Note the instance ID and printed stop/terminate commands. On the instance, wait for `sudo cloud-init status --wait`; `/var/lib/meet-companion/provisioned-commit` appears only after setup completes. Inspect `/var/log/cloud-init-output.log` if it fails. Never paste that log into a public issue without reviewing it.
4. **Sign in by hand**: on the Mac run `aws/connect.sh` to open an SSH shell and tunnel local port 5901 to the instance's loopback-only VNC listener. In that shell run `sudo cloud-init status --wait`, then `~/meet-companion/aws/start-desktop.sh --login`. In a second Mac terminal, run `aws/connect.sh --copy-password`; it copies the VNC password to the Mac clipboard without printing it. Open `vnc://127.0.0.1:5901`, paste the password, and sign in to the dedicated bot Google account and music services yourself. Never forward port 5901 through the EC2 security group. Close the dedicated Chrome login window when done. The profile stays on the instance and is never copied from the Mac.
5. **Run the trial**: edit ignored `~/meet-companion/config.local.json` on the instance with the consenting test meeting link, then run `~/meet-companion/aws/run-bot.sh` in the SSH shell. It recreates the virtual audio route, checks local prerequisites and starts the bot. Watch from a second device: admission, a generated tone, a song, echo, and a `/video` at 1080p for frame rate and aspect ratio. Only this makes a result receiver-verified.
6. **Stop or terminate** the instance afterwards (commands are printed at launch). Stopping preserves its disk charge; terminating removes the root volume. The instance also requests its own stop at the chosen deadline after every boot.

## What the test should record

Admission result; whether yt-dlp is refused from the data-centre address; outbound audio bitrate (`meetCompanion.audioStats()`); presentation frame rate and resolution (`meetCompanion.sendStats()`); CPU load during 1080p video; the receiver's observations.
