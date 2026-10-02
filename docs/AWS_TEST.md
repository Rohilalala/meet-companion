# Short AWS test of the Linux port

The first paid trial launched on 2026-10-02 after a dry run with a scoped IAM identity. The Ubuntu ARM64 instance bootstrapped successfully; its virtual audio route, visible Chrome, manual guest admission, Meet chat reply and receiver-audible synthetic tone were verified. The owner reported a steady tone without echo. Direct yt-dlp on AWS returned `YOUTUBE_BLOCKED`, while the same version and video resolved from the owner's Mac. On a bounded restart, a Mac-to-AWS loopback SSH relay played the requested YouTube song in Meet; the receiver confirmed the correct song stayed audible for at least 30 seconds. A later WARP-backed trial fetched and played the same song entirely from EC2, with another receiver confirmation of at least 30 seconds of correct audio and no Mac media upload. See [LINUX.md](LINUX.md) for the evidence boundary. For future trials, `aws/launch-test.sh` validates the request with a free AWS dry run; only `--launch` creates a billable instance.

The launch pins the current pushed Git commit and the SHA-256 of `aws/provision.sh` in EC2 user data. First boot schedules shutdown before installing Chrome, Node 22, PulseAudio, Xvfb, x11vnc, ffmpeg, yt-dlp, and the checked-out repository. The bot does **not** auto-join. If downloads or setup fail, the shutdown deadline still applies.

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

## Launch and operate a trial

1. **Use a scoped AWS identity.** `aws/launch-test.sh` refuses to run as the account root user. Use an IAM user or role with the example `aws/test-policy.json` attached. The example restricts instance type, region and project tag, but its key-pair and security-group permissions are region-wide; review and tighten it before production use.
2. **Prepare and dry-run**: from a clean, pushed branch containing this kit, `aws/launch-test.sh --prepare` creates the free SSH key pair and security group, then asks AWS to validate the full instance request without launching it. On later runs, `aws/launch-test.sh` checks the existing prerequisites without changing AWS. A second tagged instance is refused.
3. **Paid launch only after reviewing the plan**: run `aws/launch-test.sh --launch`. It refuses an uncommitted AWS script or a commit that does not match the public branch. Note the instance ID and printed stop/terminate commands. On the instance, wait for `sudo cloud-init status --wait`; `/var/lib/meet-companion/provisioned-commit` appears only after setup completes. Inspect `/var/log/cloud-init-output.log` if it fails. Never paste that log into a public issue without reviewing it.
4. **Open the remote desktop**: on the Mac run `aws/connect.sh` to open an SSH shell and tunnel local port 5901 to the instance's loopback-only VNC listener. In that shell run `sudo cloud-init status --wait`, then `~/meet-companion/aws/start-desktop.sh`. In a second Mac terminal, run `aws/connect.sh --copy-password`; it copies the VNC password to the Mac clipboard without printing it. Open `vnc://127.0.0.1:5901` and paste the password. Never forward port 5901 through the EC2 security group. Service sign-in, if needed, is manual in this dedicated Chrome profile; close the login window before starting the bot.
5. **Run the trial**: edit ignored `~/meet-companion/config.local.json` on the instance with the consenting test meeting link, then run `~/meet-companion/aws/run-bot.sh --windowed --manual-join` in the SSH shell for signed-out guest mode. Once `PREJOIN_READY` appears, click **Ask to join** in the remote desktop and have the host admit the guest. The bot then listens for Meet chat commands. The script recreates the virtual audio route and checks local prerequisites before launch. Watch from a second device: admission, a generated tone, a song, echo, and a `/video` at 1080p for frame rate and aspect ratio. Only receiver observations qualify those results. A signed-in account can use the existing automatic join path.
6. **Stop or terminate** the instance afterwards (commands are printed at launch). Stopping preserves its disk charge; terminating removes the root volume. The instance also requests its own stop at the chosen deadline after every boot.

### Concurrent Linux bot slots

For concurrent Linux trials, start each bot in a separate SSH terminal with a distinct `MEET_BOT_SLOT` from 1 through 15. Slot 1 keeps the original profile, ports and audio route; slot N gets `.local/chrome-bot-N`, controller port `3300+N`, debug port `9300+N`, and its own `MeetCompanionSinkN`/`MeetCompanionMicN`. Use the same `aws/run-bot.sh --windowed --manual-join --meeting ...` command in each terminal with its own consenting Meet link. Each window still requires host admission. Two admitted calls played separate YouTube songs in a receiver-verified trial on the 4 GiB instance, with about 1.7 GiB available during playback. This is not a claim that 15 active calls fit; increase the count only after checking CPU, available memory and receiver playback at each step.

### Server-only YouTube audio through WARP

The retained trial instance has Cloudflare WARP installed and registered, but `aws/provision.sh` does not install it on a new instance. Before a WARP-backed run, verify that `warp-cli --accept-tos status` reports Connected, that `ss -ltn '( sport = :40000 )'` shows only `127.0.0.1:40000`, and that `curl --proxy socks5h://127.0.0.1:40000 https://www.cloudflare.com/cdn-cgi/trace` reports `warp=on`. The owner accepted Cloudflare's terms for this trial. Run the bot with `MEET_YTDLP_WARP=1 bash aws/run-bot.sh --windowed --manual-join` so both yt-dlp resolution and streaming use the loopback proxy. Without that opt-in, yt-dlp uses the direct EC2 route. The proxy fails closed when unavailable; it does not make Meet traffic use WARP. The 2026-10-02 receiver heard the correct song for at least 30 seconds in one trial, and two separate songs without leakage in a later concurrent trial. Several connected WARP exits still got YouTube's bot check; a later exit worked. Connected status alone is not a playback preflight, and no automatic exit rotation is implemented. Neither trial establishes long-term availability or video quality.

### YouTube media from the owner's Mac

If direct yt-dlp on AWS gets `YOUTUBE_BLOCKED`, keep the Mac awake and run `nvm use`, then `aws/run-with-local-media.sh <consenting-test-meeting-link>` from the Mac checkout. The script finds the one running tagged trial instance, starts an anonymous yt-dlp worker on Mac loopback, forwards only AWS loopback port 3212 through SSH, and runs the AWS bot in windowed manual-join mode. A fresh random token exists only in process memory. No YouTube account cookies or media files are copied. The bot's Chrome and audio route still run on AWS; the Mac supplies only the media bytes. Closing the shell stops the relay and signals only the bot process that has that token. This depends on the Mac and its SSH connection staying available throughout playback. It does not make yt-dlp work from the AWS address itself.

The first 2026-10-02 trial confirmed the relay's metadata lookup and first 64 KiB of media across the Mac→AWS tunnel. A later Meet command stopped in the Meet Settings UI before playback because its close button was labelled “Close dialogue”; that selector was updated. In the owner-approved restart, the bot joined a replacement meeting, reported YouTube audio `STARTED`, and the receiver confirmed the correct song stayed audible for at least 30 seconds. The owner then sent `/bot stop`. Subsequent play requests failed with `MEDIA_WORKER_UNAVAILABLE` after the SSH forwarding connection timed out. The runner now reconnects that tunnel automatically: terminating its SSH child produced a new connection and an AWS-side authenticated-worker challenge (HTTP 403 without a token). Receiver playback after an automatic reconnect has not yet been tested. The instance was stopped again after the trial.

## What the test should record

Admission result; whether yt-dlp is refused from the data-centre address; outbound audio bitrate (`meetCompanion.audioStats()`); presentation frame rate and resolution (`meetCompanion.sendStats()`); CPU load during 1080p video; the receiver's observations.
