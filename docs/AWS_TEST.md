# Short AWS test of the Linux port

Nothing here has been launched. `aws/launch-test.sh` prints its plan and asks AWS for a free dry run unless it is given `--launch`.

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

1. **A scoped AWS identity.** The AWS CLI on the Mac is signed in as the account root user, and `aws/launch-test.sh` refuses to run as root. Create an IAM user or role with only `aws/test-policy.json` attached (Mumbai only, `t4g.medium`/`t4g.large` only, instances tagged `Project=meet-companion-test`, one key pair, one security group) and configure the CLI to use it.
2. **Run the dry run**: `aws/launch-test.sh`. Then, when ready to pay, `aws/launch-test.sh --launch`.
3. **Sign in by hand on the instance**: the bot's Google account, and any music service, through `npm run bot:login` over a temporary remote desktop. Sign-in is never automated and no profile is copied from the Mac.
4. **Watch from a second device** in a test meeting: admission, a generated tone, a song, echo, and a `/video` at 1080p for frame rate and aspect ratio. Only this makes a result receiver-verified.
5. **Stop or terminate** the instance afterwards (commands are printed at launch).

## What the test should record

Admission result; whether yt-dlp is refused from the data-centre address; outbound audio bitrate (`meetCompanion.audioStats()`); presentation frame rate and resolution (`meetCompanion.sendStats()`); CPU load during 1080p video; the receiver's observations.
