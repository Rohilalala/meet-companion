# Linux port (Ubuntu ARM64)

Branch `linux-port`. The bot runs on Ubuntu with branded Google Chrome and a dedicated PulseAudio (or PipeWire pulse-server) audio route. The macOS path (BlackHole + CoreAudio) is unchanged. Everything that differs between the two lives in `scripts/platform.js`.

## What is verified, and how

Two kinds of evidence. Do not mix them up.

**Offline, no accounts, no meeting** — run on a GitHub-hosted Ubuntu 24.04 ARM64 machine (`.github/workflows/linux-port.yml`, run 37010483078, 2026-10-02), Google Chrome 154.0.8037.97, `aarch64`:

| Check | Result |
| --- | --- |
| Branded Chrome launch, CDP attach, debug listener loopback-only | Pass |
| `npm run preflight` | No blockers |
| Device discovery: Chrome lists `MeetCompanionSink` (output) and `MeetCompanionMic` (input) | Pass |
| Synthetic 440 Hz tone: player tab → virtual sink → Meet-side microphone | Pass: RMS 0.140 with tone, 0 when silent; echo cancellation, noise suppression and auto-gain all off |
| Fail-closed: a missing route refuses to play | Pass: `VIRTUAL_AUDIO_ROUTE_MISSING`, player stays paused |
| Native tab presentation with tab audio (synthetic page) | Pass: 1920×1080 browser surface, one audio track, energy 0.140 |
| `npm run check`, `npm run verify:offline` | Pass, 22/22 |

**Receiver-verified in a real Meet on Linux** — on a 2026-10-02 Ubuntu ARM64 EC2 trial, the owner manually pressed **Ask to join** in the visible bot browser and confirmed the host admitted Meet Companion. The controller reported `in_call` and `LISTENING`; the owner saw its `/bot help` reply. A generated 440 Hz tone played for 15 seconds through the virtual route; the owner reported steady sound without echo. Bot outbound Opus bytes rose from 1,868 to 127,757 during that interval, and the route reported no error. The bot microphone was verified muted afterward. This is a short synthetic audio check, not a 60-second E3 pass or a service playback qualification. No meeting media was recorded.

The automated headless guest attempt showed Meet's denial screen before the host saw a request. An automated windowed guest click was also denied before host notification. Manual clicking in the same bot browser was admitted. The reason for the automated denial is not proven. Direct yt-dlp on AWS returned `YOUTUBE_BLOCKED`, while the same version resolved the same video on the owner's Mac. A loopback SSH relay delivered YouTube media from Mac to AWS; after a Meet Settings selector correction, the owner confirmed the requested song stayed audible for at least 30 seconds in the replacement meeting. The relay later timed out; automatic SSH reconnection was verified at the network boundary, but receiver playback after recovery remains untested. The YouTube web player asked for sign-in and did not start a share. Spotify/Apple Music playback and receiver video frame rate/aspect ratio remain untested on Linux.

A later EC2 trial used Cloudflare WARP as a loopback-only yt-dlp proxy, without the Mac media relay. Direct yt-dlp still hit the bot check, while WARP resolved the requested video and streamed its audio. After a restart, the bot joined the replacement test Meet by manual guest admission, passed 25/25 offline checks, and used WARP for both yt-dlp calls. The owner confirmed the correct song stayed audible in Meet for at least 30 seconds. The bot exited and EC2 was stopped. This verifies one short server-only YouTube audio run; repeated sessions, other videos, echo, and video quality remain untested.

The 4 GiB instance also ran two isolated bot browsers at prejoin at the same time. A synthetic tone injected into either slot's virtual sink registered only on that slot's microphone; a third slot passed the full local tone and fail-closed routing check. Two admitted Meet sessions and independent songs were not reached in this trial, so there is no measured active-call capacity yet. See [FEASIBILITY.md](FEASIBILITY.md) for the numerical samples.

## Setup on Ubuntu 24.04 ARM64

```sh
sudo apt-get install -y pulseaudio pulseaudio-utils lsof ffmpeg
wget https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb
sudo apt-get install -y ./google-chrome-stable_current_arm64.deb
# Node 22 (see .nvmrc), then:
npm ci
cp -n config.example.linux.json config.local.json
npm run linux:audio      # creates the virtual route; run again after every reboot
npm run preflight
npm run verify:route     # tone through the route, no accounts
```

yt-dlp for YouTube audio and video: install a current release (for example `pipx install yt-dlp`); the distribution package is usually too old.

## The audio route

`scripts/linux-audio.sh` creates three devices:

- `meet_companion` — a null sink the player tab outputs to. Chrome label `MeetCompanionSink`.
- `meet_companion_mic` — a source fed by that sink's monitor; the bot's Meet microphone. Chrome label `MeetCompanionMic`.
- `meet_companion_discard` — a silent sink set as the system default.

The route is never the default device. Chrome selects it by exact label, so nothing else on the machine can reach the meeting, and if the route is missing the player refuses to play (`VIRTUAL_AUDIO_ROUTE_MISSING`) instead of falling back. On macOS the rule is the same with BlackHole 2ch.

Unchanged from macOS: the Chrome debug port binds to loopback only; the bot uses its own profile directory (`.local/chrome-bot`) and refuses the default `~/.config/google-chrome`; incoming Meet audio is muted in the bot; no meeting media is recorded.

## Manual sign-in (cannot be automated, by design)

`npm run bot:login` opens the bot's profile with no debugging port so a person signs in to Google and the music services by hand. For the EC2 trial, [AWS_TEST.md](AWS_TEST.md) describes the loopback-only VNC desktop reached through an SSH tunnel. Never copy a browser profile from another machine; sign in fresh on the Linux host.

## Video

`/video` (yt-dlp) presents the bot's own page as a tab and sends the picture only; the sound goes through the bot's microphone route. That is how it was accepted in a live Meet on macOS: Meet's presentation audio sounded muffled to the receiver, the microphone route did not. `/bot ytweb` shares the YouTube web player with tab video and audio and keeps the microphone muted. The synthetic presentation check above covers the tab-video-and-audio capture path.

## Known gaps on Linux

- Visible Chrome on Xvfb was used for the guest trial above; account-free CI also verifies its launch. Manual guest admission is currently required for this signed-out test meeting.
- Software video encoding on a 2-vCPU ARM instance is unmeasured; 1080p presentation may need a larger instance.
- Anonymous yt-dlp from the trial's AWS address received YouTube's sign-in/bot check. The WARP-backed server-only route produced one receiver-audible YouTube audio run, but WARP is not installed by the fresh-instance provisioner and long-term reliability is unknown. The older `aws/run-with-local-media.sh` Mac relay also played audio; it requires the Mac to stay online and upload the media to EC2.
