# Phase 0 — feasibility report

Date: 2026-09-30 (Asia/Kolkata). Machine evidence timestamps are UTC.

**Decision: PHASE 0 HARNESS BUILT; LIVE GATES BLOCKED ON SETUP. Stop before Phase 1.** No E0–E6 live admission/playback experiment has completed. A read-only pre-join check of the owner-supplied meeting was performed; no admission request was sent. No admission, session persistence, audible playback, camera quality, chat reliability, or Spotify control claim is established. Missing prerequisites are not failed experiments and do not establish that a fallback architecture is needed.

The original request is preserved in [BRIEF.md](BRIEF.md). The Phase 0 harness now includes a branded-Chrome launcher, both tab init scripts, localhost tone/beep/file player, camtest, minimal Meet driver, Spotify PKCE/device-targeted API calls, and E0–E6 runners. No Phase 1 extension, activity queue, or production session controller is implemented.

## Measured local evidence

Recorded by `node scripts/preflight.js`: [PREFLIGHT.json](PREFLIGHT.json). The command performs read-only OS/config checks, requests no microphone access, and exits 1 for unmet prerequisites.

| Check | Observed result | Evidence / limit |
| --- | --- | --- |
| Platform | Apple Silicon arm64, macOS 27.0 build 26A428 | `uname -m`, `sw_vers` |
| Node | Initial shell: 26.3.0; installed and verified 22.23.3 with npm 10.9.9 using existing nvm | `nvm install 22 --no-progress`; download checksum matched. Repository uses `.nvmrc`; new shells still need `nvm use`. |
| Branded Chrome | 154.0.8037.58 | `/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' '/Applications/Google Chrome.app/Contents/Info.plist'` |
| BlackHole 2ch | Missing from both enumerated inputs and outputs | `system_profiler SPAudioDataType -json`; `/Library/Audio/Plug-Ins/HAL` contains only ParrotAudioPlugin.driver. No driver installed or substituted. |
| Default media output | MacBook Pro Speakers | `coreaudio_default_audio_output_device = spaudio_yes` |
| System sounds output | Multi-Output Device | `coreaudio_default_audio_system_device = spaudio_yes`; membership not determined by this probe. Inspect in Audio MIDI Setup, especially after installing BlackHole. |
| Dedicated bot profile | Non-default path configuration validates: `.local/chrome-bot` | Login dry-run passes. The isolated bot profile was created by local browser checks; no account login was attempted. Existing personal browser profiles were not inspected. |
| Syntax | PASS, 23 ESM files | `npm run check` under Node 22.23.3. |
| Manual-login launch configuration | PASS | `npm run bot:login -- --dry-run`; actual browser launch and sign-in not tested. |

No system audio settings were changed. No meeting was joined. No messages, audio, video, OAuth tokens, or account information were collected.

## New local harness verification

Evidence: [headless Chrome](BROWSER_HEADLESS.json), [windowed Chrome](BROWSER_WINDOWED.json). Both were actually executed with branded Chrome 154.0.8037.58 on this Mac, using `connectOverCDP` after checking the listener owned by the spawned PID. Both returned PASS.

| Boundary | Observed result | Limit |
| --- | --- | --- |
| Branded Chrome launch / attach | Headless and windowed modes attach; off-screen position requested for windowed mode; two tabs; listener loopback-only | Not E0 admission, Widevine playback or receiver audibility |
| Meet init script | Synthetic camera enumerates; captured canvas reports 1280×720 at requested 30 fps; remote audio stays muted | Synthetic local canvas only; receiver encoding/quality unmeasured |
| BlackHole input | `BLACKHOLE_2CH_MISSING`, no default mic fallback | Positive physical BlackHole route still untested |
| HTML media output | Missing-device lookup/play errors; detached audio remains paused and muted even after attempted unmute | Service-specific autoplay/iframes remain live qualification work |
| AudioContext output | Missing-device error; state suspended; sink type `none` | No service audio graph capture is used |
| Local tone | 440 Hz, 60-second decoded duration, readyState 4, unpaused with >1 second of advancing currentTime, default sink | Stopped after about 1.2 s; this proves browser playback, not human audibility or a 60-second receiver run |
| Local file server | Generated WAV header served via 206 byte range; traversal outside folder refused | Fixture is generated silence, never recorded media |
| HTTP boundaries | Forged Host, cross-origin player request and bad bearer refused; correct extension origin + in-memory token accepted; unsolicited callback refused | Phase 0 harness, not extension acceptance |
| Offline unit checks | 4/4 `node:test` cases pass; fake fetch only, zero network | PKCE state/replay/S256, targeted Spotify commands, strict links, forced BlackHole constraints |

The first browser check exposed a serialization issue: Chrome's AudioSinkInfo does not serialize its `type` as an enumerable property. Reading `sinkId.type` explicitly verifies `none`. A subsequent relaunch found a stale profile lock with a dead PID after abrupt shutdown. The launcher now uses CDP `Browser.close`, waits for process exit, refuses live locks and lets Chrome recover its own dead-PID lock. Repeated launches, including windowed mode, succeeded; no profile files were manually deleted.

`npm run e0` now executes the local launch/attach portion. `npm run e1` through `npm run e6` without `--live` print unmet live prerequisites and do not contact service pages. Live runs require explicit `--live`, manual login, configuration and human observations. All source-specific selectors are English-UI pilot selectors; unknown authentication/DOM states are not treated as success.

## Owner-supplied meeting: pre-join check

The owner supplied a test meeting during harness work. It was saved in ignored `config.local.json` with mode 0600; no meeting code is published here. The bot opened that meeting page with the init script and reported `state=joining`, `googleSession=unknown`, `admissionRequested=false`. This does not establish signed-in status, admission denial or timeout. The dedicated manual-login window was then opened for the owner; the harness did not enter credentials. Evidence: [PREJOIN.json](PREJOIN.json). BlackHole remains absent in the final Node 22 recheck. That later check no longer reports a default aggregate; no system audio settings were changed by this harness. See [PREFLIGHT_CURRENT.json](PREFLIGHT_CURRENT.json); inspect defaults again before live audio tests.

## Required setup to resume

1. Install BlackHole 2ch and confirm it exposes both input and output. Keep macOS media output and system sounds away from BlackHole, including indirect routing through an aggregate/multi-output device. The preflight deliberately refuses to declare aggregate membership safe from its name alone.
2. Create the dedicated bot Google account; use `npm run bot:login` and sign all four service accounts in manually. Fully close that dedicated Chrome instance before controlled relaunches.
3. The saved test meeting is now configured. Arrange its cooperating host, invite the bot to its Calendar event, and arrange a second meeting hosted by someone else. Do not publish meeting codes in this report.
4. Arrange a second receiver device and two test participants. E4 additionally needs laptop/phone receiver configurations and the authorized filming conditions below.
5. Prepare the owner's Spotify Premium account and development-mode app (PKCE redirect/scopes in README). Apple Music/YouTube Music subscriptions and usable test links are needed for their individual checks. Enter credentials locally, never in chat or tracked files.

## Experiment status and execution sheets

All numerical result fields below are **not measured**. Fill them only from observed runs, with UTC start/end times, browser build/mode, receiver type, observer, and sanitized evidence references.

### E0 — headless versus normal-window mode

Status: **BLOCKED** (BlackHole, bot sign-in, test meeting, Spotify playback and receiver unavailable).

Spawn branded Chrome with the dedicated non-default profile and fixed debugging port bound to loopback, attach using Playwright `connectOverCDP`, and use the exact flags in BRIEF.md. Do not use Playwright launch defaults, fake media, `--mute-audio`, or automation sign-in. Verify the actual debugging listener is loopback-only.

| Required observation | Result |
| --- | --- |
| Headless bot admitted and visible as its own participant | Not run |
| Official open.spotify.com player audibly playing | Not run |
| Player output routed to BlackHole and heard on a second device | Not run |

Only all three passing establishes headless viability. Any observed failure chooses a normal window moved off-screen/minimized, then retest that mode. No mode has been selected from the present missing prerequisites. API availability alone cannot pass E0 or establish Widevine playback.

### E1 — admission

Status: **BLOCKED** (authenticated bot session, BlackHole and host coordination unverified). Saved meeting link is configured; only the pre-join check above was run.

| Route | Host UI seen | Bot UI seen | Time to admission/denial | Result |
| --- | --- | --- | --- | --- |
| (a) Saved meeting as Calendar invitee | Not observed | Not observed | Not measured | Not run |
| (b) Saved meeting using Ask to join | Not observed | Not observed | Not measured | Not run |
| (c) Meeting owned by someone else using Ask to join | Not observed | Not observed | Not measured | Not run |
| `spaces.members` route if (a)/(b) cannot admit | Not observed | Not observed | Not measured | Not run |

Record exact non-sensitive host/bot UI wording and access/knocking settings. Allow 180 seconds before ADMISSION_TIMEOUT; distinguish explicit ADMISSION_DENIED. Google documents automatic denial when knocking is disabled; this is not evidence that this bot was denied in a tested meeting. [Google access controls](https://support.google.com/a/users/answer/11989526?hl=en)

The currently published member-management guide describes `v2/spaces/{space}/members`; do not assume older preview-only examples are current. Verify host authorization and actual eligibility before attempting the allowed membership route. It configures membership, not a substitute media participant. [Google member management](https://developers.google.com/workspace/meet/api/guides/meeting-space-members)

If neither (a), (b), nor the permitted membership route admits the bot, **STOP and ask the owner**. Do not switch to the owner's account, screen sharing, or another join route. Route (c) must be reported independently and does not substitute for the saved-meeting gate.

### E2 — persisted sessions

Status: **BLOCKED** (manual sign-in unavailable); the five-cycle relaunch runner is implemented.

After one manual login, run five complete controller/browser relaunch cycles against the same bot profile, waiting for the old process to exit each time. No session export/import or login automation. Inspect an authenticated UI indicator for each service; log only signed-in booleans.

| Relaunch | Google | Spotify | Apple Music | YouTube Music |
| --- | --- | --- | --- | --- |
| 1 | Not run | Not run | Not run | Not run |
| 2 | Not run | Not run | Not run | Not run |
| 3 | Not run | Not run | Not run | Not run |
| 4 | Not run | Not run | Not run | Not run |
| 5 | Not run | Not run | Not run | Not run |

If Google cannot persist, **STOP**. Report other services' signed-out states separately; no sign-in automation as a repair.

### E3 — independent audio-route verification

Status: **BLOCKED** (BlackHole, admission, source logins and receiver unavailable).

Use exactly two bot tabs. In the Meet tab, select BlackHole explicitly with echo cancellation, noise suppression and automatic gain control disabled, camera off, and mute remote-audio elements. In the player tab, route HTMLMediaElements and AudioContexts, including future instances, to BlackHole with sink selection. Grant permissions only for the origins under test. Device IDs must be resolved within each origin; never fall back to the default microphone or default output.

| Source | Receiver hears continuous ungated audio | Duration | No echo/feedback | Owner's same-Mac Meet unaffected | Result |
| --- | --- | --- | --- | --- | --- |
| Local `/player`, generated 440 Hz tone | Not observed | Required 60 s; not measured | Not observed | Not observed | Not run |
| Official Spotify web player | Not observed | Not measured | Not observed | Not observed | Not run |
| Official Apple Music web player | Not observed | Not measured | Not observed | Not observed | Not run |
| Official YouTube Music player | Not observed | Not measured | Not observed | Not observed | Not run |

Open `chrome://webrtc-internals` on the receiver before joining. Collect **statistics only** for the bot's inbound audio: packet/byte counters, audio energy where available, packet loss/jitter and timestamps. Keep raw dumps private under ignored `.local/evidence/`; publish only reviewed numerical excerpts without addresses, meeting URLs, or identifiers. Do not enable diagnostic audio recording. Receiver listening and the owner's unaffected call are required in addition to stats.

The bot watchdog may analyze its BlackHole input in memory to measure energy, as specified, but never record it. Do not capture a service's protected media into a Web Audio graph. Source playback uses the official player plus output-device selection only.

Every source failing, including local, is a **STOP**. Individual service failures make those adapters unavailable with an observed reason; remaining sources may proceed. No adapters are currently qualified or declared unavailable by experiment. Never install paid routing software without asking.

### E4 — diagnostic camera

Status: **BLOCKED ON LIVE SETUP**, not on authorization.

The owner explicitly authorized human receiver-screen filming during camtest in a consenting test meeting. Humans must keep cameras off and stay silent; frame only the bot tile; play no protected music, only the local generated beep. Footage stays in ignored `.local/evidence/` and must be deleted once offsets are extracted. Only numerical measurements enter this report. The bot code must never capture/record meeting media. E4 prompts the human to confirm these conditions and footage deletion; it does not film or delete unrelated evidence. A failed E4 is not a Phase 0 stop condition.

For the diagnostic only, disable Video framing and enable Show my full video to others in the bot profile. Feed the synthetic 1280×720, 30 fps canvas (frame counter, 12–48 px text, flash every 2 s) to Meet; play the synchronized generated 1 kHz beep through the local `/player`. Camera remains off in normal v1 use.

| Receiver / layout | frameWidth × frameHeight | framesPerSecond | framesDropped (delta and interval) | Smallest readable text | Flash-to-beep offset |
| --- | --- | --- | --- | --- | --- |
| Laptop / pinned | Not measured | Not measured | Not measured | Not measured | Blocked |
| Laptop / unpinned | Not measured | Not measured | Not measured | Not measured | Blocked |
| Phone / pinned | Not measured | Not measured | Not measured | Not measured | Blocked |
| Phone / unpinned | Not measured | Not measured | Not measured | Not measured | Blocked |

A phone that exposes no receiver stats must be marked unavailable, not filled using sender statistics. The diagnostic-only filming exception is authorized; apply the conditions above and retain only the numerical measurements.

### E5 — chat observation

Status: **BLOCKED** (admission and two participants unavailable). The MutationObserver/read/reply harness is implemented but its real Meet selectors are unqualified.

Send 50 synthetic messages total from two named test participants, including interleaved bursts. Use unique sequence numbers, keep bodies and sender comparisons only in memory, and identify test participants by aliases in this report. Track unique received/50, duplicates, correct sender attribution, latency sample count and p50/p95/max, and the visible bot reply. Verify a real UI send/read path, not injected DOM messages. Cross-device latency needs a documented clock offset; otherwise label it unmeasured.

Capture rate: not measured. Latencies: not measured. Sender matches: not measured. Bot reply: not observed. No raw chat or DOM snapshots are to be persisted.

The brief gives no latency threshold: report the numbers rather than inventing one. Message loss, misattribution, or unavailable read/reply behavior must be reported for the owner decision. If E5 fails, ship chat disabled with CHAT_UNAVAILABLE; E5 failure does not block the other gates. No chat qualification decision is possible yet.

### E6 — Spotify official Web API

Status: **BLOCKED** (Premium account, developer app, OAuth and web-player device unavailable).

Use Authorization Code + PKCE, redirect `http://127.0.0.1:3210/callback`, and only `user-read-playback-state user-modify-playback-state`. Discover the open.spotify.com Connect device; target its device ID explicitly. Do not issue an untargeted command that could affect another account device.

| Operation | HTTP outcome | Player-state confirmation | Actual web-player / receiver observation |
| --- | --- | --- | --- |
| Play track and playlist context | Not run | Not run | Not run |
| Pause / resume | Not run | Not run | Not run |
| Next within playlist | Not run | Not run | Not run |
| Set volume | Not run | Not run | Not run |
| Add to queue | Not run | Not run | Not run |

Sequence operations and poll for the observed state before advancing; an HTTP success alone is not sufficient. Record status codes and redacted state booleans, not authorization headers, tokens or URLs. Check the current development-mode endpoint list when running: the required player/device/queue/volume controls are listed in the published changelog, but this has not been tested with the owner's app. [Spotify development-mode changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)

## Stop-condition audit

| Condition | Current disposition |
| --- | --- |
| E1 all permitted admission routes fail | Not evaluated; no meeting attempted |
| E2 Google session cannot persist | Not evaluated; no sign-in attempted |
| E3 every source including local fails | Not evaluated; driver absent |
| E4/E5 failure | Not evaluated; nonfatal when actually measured |
| Need DRM circumvention, protected capture/download or automated sign-in | None attempted or proposed |
| Need recording of meeting media | Human-only E4 exception authorized with conditions above; bot recording remains forbidden |

Resume **Phase 0**, collect actual evidence, then stop and report again before Phase 1. `docs/ACCEPTANCE.md` and permissions/PIN acceptance belong to Phase 1. The one current `scripts/offline.test.js` covers Phase 0 boundaries only and can be extended in Phase 1; it is not live acceptance evidence.
