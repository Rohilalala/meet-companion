# Meet Companion — agent handoff

Prepared 2026-09-30 IST. This document records an unfinished live debugging session. The owner explicitly requested a handoff; development was stopped to prepare it. **Do not interpret this document as acceptance or completion.**

## Read first

The bot accepts `/bot` commands in Google Meet chat, plays music through BlackHole into its microphone, and presents YouTube video through native Chrome tab sharing with tab audio. Spotify has worked audibly. YouTube tab sharing has worked, but is **not reliable**: YouTube repeatedly displays its own playback error, the receiver has reported cropping/asymmetric bars, and presentation frame rate has been poor or variable.

The owner confirmed that the same YouTube link plays normally beyond the first minute in their regular Chrome window. The next investigation should isolate the bot browser/player environment. The exact root cause is still unknown. Do not repeatedly tell the owner this is a Meet display issue or that the latest visual patch has fixed it.

**The current runtime does not reliably include the latest saved YouTube changes.** It predates the final `object-fit: contain` and already-fullscreen guard edits. Those edits pass static checks, but have not been accepted in a live receiver test.

## Update 2026-10-02 — control page, shutdown, owner PIN

- `npm run control` serves a local control page at `http://127.0.0.1:3211` (join a pasted or saved Meet link, leave, status, owner PIN). The bot's sanitized events are also appended to ignored `.local/bot-events.log`.
- Shutdown bug found and fixed. `bot-launch.js` and `bot-run.js` both handled SIGINT; the launch handler closed Chrome and exited 130 before `bot-run` could click Leave, leaving a ghost participant and a different pre-join screen on the next join. `bot-run` now owns shutdown. Verified live through the launcher: Leave gave exit code 0, a second Leave was refused, Chrome was gone and the ports were free.
- Chat changes:
  - `/leave` (alias `/exit`) and `/clear` need a one-time owner PIN, e.g. `/leave 4821`. The PIN is shown on the control page and rotates after use.
  - A control word followed by other text (`/stop now`, `/bot leave the door open`) is rejected with a hint. It is neither run nor searched.
  - `/video <link|search>` plays yt-dlp video; `/bot ytweb <link>` is the old web-player share.
- Robustness: a failing task can no longer reject the command chain; `stop()` kills the stream and resets the player even when mic-off fails; auto-advance ignores a track that a command already replaced; joining can be cancelled by Leave.
- Not verified live: the PIN flow in a real chat, and the join-cancel path. Still open: Spotify/Apple end-of-track detection, the unexplained `BROWSER_CRASHED` at 2026-09-30 17:39 UTC, YouTube rate-limit handling (one lookup per track was declined), and a join that took over two minutes on 2026-10-02 with no recorded reason.
- Offline tests: 22/22. CI workflow added at `.github/workflows/ci.yml` (not yet run; the repo has no remote).

## Update 2026-09-30 09:40 UTC (live session, meeting supplied by the owner)

Observed in a live meeting with the owner on a second device; numbers are from the bot's own logs and `meetCompanion.audioStats()`.

- Working and owner-confirmed:
  - yt-dlp audio (`/play <song|link>`, bare Discord-style commands and plain-text search).
  - The queue: queued, auto-advanced and skipped live.
  - `/volume`, pause and resume.
  - yt-dlp video (`/video <link|search>`) at 1080p, picture-only share. The owner confirmed clean sound in sync with the picture.
- Audio path measured:
  - Music on the mic: ~67 kbps Opus (Meet's mic encoding: mono, 32k target).
  - Video with tab audio: mic ~1 kbps and the share audio carried the sound at 64 kbps; the owner heard it muffled. Cause: `suppressLocalAudioPlayback` silences the tab's BlackHole output, and muting the share audio did not reach Meet's cloned track.
  - Fix: yt-dlp video requests no tab audio. The mic then measured 64 kbps and the share audio 0.
- Live bugs found and fixed:
  - Meet's send button was relabelled "Send a message": chat is now sent with Enter.
  - The chat button reads "Chat with everyone - New message" when there are unread messages: now matched by prefix.
  - Meet auto-hides its toolbar: the driver moves the mouse first.
  - The "Others may see your video differently" popup blocked More options: it is now dismissed with Got it.
  - Rejoining after an unclean exit showed "Switch here"/"Join here too".
  - Resume never unmuted the mic for yt-dlp audio.
  - The audio-settings dialog now opens once per call.
- Rate limit: after many test resolves, YouTube returned HTTP 429 to anonymous yt-dlp at 09:37 UTC (`YOUTUBE_BLOCKED`, yt-dlp 2026.08.19, no update available). Per the guardrails there are no cookies, PO tokens or proxies: wait it out. The owner declined reducing lookups per track for now.
- A network outage also appeared: at 09:22 UTC `www.youtube.com` failed DNS while Google resolved. The bot reports this as `MEDIA_UNAVAILABLE`; a clearer code is not built.
- Still open: owner-only permissions, Spotify/Apple end-of-track detection, and a shutdown that logs `BROWSER_CRASHED` for intentional stops.

## Update 2026-09-30 22:40 UTC — YouTube audio via yt-dlp

Measured only; live Meet acceptance has **not** run.

- **State now:** the live bot from "Live processes left running" was stopped with SIGINT; ports 3210 and 9223 are free. The leftover diagnostic process 24493 was stopped. The dirty work listed under "Dirty work to preserve" is committed as `4d2785c` (snapshot, unchanged); the yt-dlp work follows in `554e46d`, `8a2f9fc`, `b0cfdfe`, `c595e4a` and `3b7c64f`.
- **YouTube web player in the bot profile, outside Meet** (numbers from controlled runs): windowed with routing reached 4 s, then paused, with 6 googlevideo 403s. Windowed without routing reached 31 s, then paused, with 12 googlevideo 403s. So neither headless mode nor the routing script explains the failure. A same-profile run with no CDP client attached was attempted and produced no result (the test Chrome ended with zero tabs). The cause is still unproven.
- **New route:** `/bot youtube|yt|ytmusic|youtube-music <link>`, plain YouTube links and `/bot yt <search>` play audio through anonymous yt-dlp (`--ignore-config --no-cookies --no-cookies-from-browser --no-cache-dir --no-playlist -f bestaudio`). `/bot ytvideo <link>` keeps the native tab share unchanged. yt-dlp 2026.08.19 (Homebrew).
- **Local results without Meet** (bot profile, headless, `/player` routed to BlackHole):
  - Anonymous resolve of the test link succeeded in 2.9 s (webm).
  - Direct googlevideo URL: `currentTime` advanced 10 s per 10 s sample for 180 s, with no pause or error.
  - Stdout stream: advanced 10 s per 10 s for 60 s, and again for 40 s through the real `harness()`.
  - After stop, zero yt-dlp processes remained (checked with `pgrep -f`; `pgrep -x` cannot see it because it runs under Python).
- **Disk-cache finding:** playing the direct googlevideo URL wrote about 4 MB of audio per play into `.local/chrome-bot/Default/Cache`. `Network.setCacheDisabled` did not prevent it. The route therefore always plays the local `/stream/<id>` (`Cache-Control: no-store`); a 40 s run left no stream entry in the cache. The earlier cached googlevideo entries (from these tests) are still in the bot profile's cache and await the owner's OK to delete.
- **Audio preflight:** `requireAudio` currently refuses with `DEFAULT_AGGREGATE_REVIEW_REQUIRED`, because the system-sounds device is a Multi-Output Device. Read-only inspection of `/Library/Preferences/Audio/com.apple.audio.SystemSettings.plist` lists its subdevices as MacBook Pro Speakers plus one other UID, with no BlackHole. Setting `defaultAggregateReviewed` is the owner's decision.
- **Checks:** `npm run check` passes (31 files) and `npm run verify:offline` passes 17/17, including the argument, error-code, parser and single-use-id tests.
- **Not yet done:** live acceptance items 1–5 from the task (3 minutes audible in Meet, controls, search, Spotify regression, final guardrail sweep in a live run).

## Repository and instructions

- Actual repository: `~/Documents/meet-companion`.
- Branch: `codex/phase-zero`.
- The conversation's default directory, `a different folder`, is not the working repository. Use an explicit working directory.
- Node: 22.x; installed binary directory `~/.nvm/versions/node/v22.23.3/bin`.
- Playwright: 1.63.0. macOS Apple Silicon, branded Google Chrome. Chrome was previously observed as 154.0.8037.58; recheck if relevant.
- Read root and affected-directory `AGENTS.md`, the machine instructions under `~/.Codex/`, project notes `~/.Codex/projects/meet-companion.md`, and recent `~/.Codex/mistakes/log.md` before editing.
- Current changes are uncommitted. Preserve them. Do not reset the checkout or rebuild elsewhere and lose this state.
- `docs/CHAT_BOT.md` and parts of `FEASIBILITY.md` are stale. This handoff is the current operational status; source code is authoritative for implementation.

The original request was a Phase 0 feasibility harness. The owner subsequently authorized the minimal live chat controller and direct service web-player approach. Read owner amendments in `docs/BRIEF.md` and repository guidance before treating the original Phase 0 stop rule as a blocker. Extension development, queues, PINs, participant authorization and a production state machine remain outside the implemented scope.

## Live processes left running

Last browser-state inspection: **2026-09-29 21:49 UTC / 2026-09-30 03:19 IST**. Process/listener existence was rechecked while writing this handoff. PIDs are snapshots; verify ownership before acting.

| Process | PID | State/purpose |
| --- | --- | --- |
| npm | 45495 | `npm run bot --live` |
| Controller | 45517 | `node scripts/bot-run.js --live` |
| Dedicated Chrome | 45529 | Owned bot browser |
| Earlier diagnostic Node | 24493 | Leftover held-prejoin diagnostic; no TCP sockets were observed; inspect before cleanup |

- Controller listener: `127.0.0.1:3210`, owned by Node 45517.
- Chrome debugging listener: `127.0.0.1:9223`, owned by Chrome 45529.
- Bot terminal session in the originating agent turn: 66293. A different agent may not be able to reuse that session handle.
- Dedicated profile: `.local/chrome-bot`.
- At the last inspection, the bot was still in the meeting and listening for commands, with **microphone off, camera off, and presentation stopped**.
- The player tab remained on YouTube's “Something went wrong” error, in fullscreen at a 1920×1080 viewport. The route reported no error and zero playing elements. A healthy audio route does not imply healthy YouTube playback.
- The last intervention successfully called the driver's `stopPresenting()`. No controller/browser shutdown or relaunch was performed for this handoff.
- Because the bot is still listening, a new owner command can change this state after the snapshot.

Recent runtime observations: LISTENING at 21:40:12 UTC; fullscreen verification failures at 21:40:21 and 21:40:31; YouTube STARTED at 21:41:21 and most recently 21:44:37. STARTED is not sustained-playback acceptance.

For a controlled restart, interrupt the owned runtime gracefully (Ctrl-C in its terminal, or SIGINT to the verified controller PID). The launcher's cleanup closes its owned Chrome. Recheck both ports and profile ownership before starting another instance. **Do not kill all Chrome processes, delete profile locks, change the system audio default, or touch the owner's regular Chrome profile.** The earlier diagnostic process was not cleaned up during handoff.

## Running and checking

```sh
cd ~/Documents/meet-companion
export PATH="~/.nvm/versions/node/v22.23.3/bin:$PATH"

npm run check
npm run verify:offline
npm run preflight

# Default is headless; close the existing bot first.
npm run bot -- --live

# Alternative mode; current launcher places its window off-screen.
npm run bot -- --live --windowed
```

`npm run bot` without `--live` only prints instructions. `npm run bot:login` opens the dedicated profile for owner-controlled sign-in; close the active bot before using it. It is not automated login. Saved configuration, including the meeting link, lives in ignored `config.local.json`; do not paste it into logs or this document.

Explicit browser/integration checks:

- `npm run verify:presentation`: local synthetic fullscreen tab/audio test. Requires free profile/ports and BlackHole; do not launch against the running bot.
- `npm run verify:meet-silence`: local synthetic incoming-audio suppression test; likewise requires a free profile.
- `npm run verify:browser`: older negative-device diagnostic expects BlackHole to be absent. That assumption no longer matches this machine.
- `npm run e0` through `npm run e6`: original experiment runners; inspect each runner's live prerequisites and use `-- --live` where required. They are not all completed or accepted.

Runtime observations are emitted to its terminal as sanitized results/codes. Do not enable raw chat logging, browser traces, HARs, unrestricted console dumps or meeting screenshots as a shortcut. Never persist cookies, OAuth responses, signed media URLs, full player responses or raw WebRTC dumps.

## Owner requirements and safeguards

1. Spotify, Apple Music and YouTube Music: official web player tab → exact BlackHole 2ch output → exact BlackHole microphone input in Meet. Echo cancellation, noise suppression and automatic gain control must stay off. Meet's separate Studio sound/noise settings must also be checked.
2. YouTube video: **native Chrome tab sharing plus tab audio**, not a window, entire screen, canvas camera or the local diagnostic page. Microphone and camera stay off. True fullscreen before sharing; preserve the entire frame and aspect ratio.
3. Incoming Meet audio must be silenced in both HTML media and Web Audio. The owner previously heard themselves, and the echo stopped when the bot disconnected.
4. No default-device fallback when BlackHole lookup/routing fails. Do not change macOS default audio routing.
5. Manual Google sign-in has been completed; BlackHole was installed, rebooted into service, and recognized. Spotify is signed in. Apple Music was signed out at last check; YouTube Music remains unqualified.
6. Current Spotify runtime does **not** depend on a Spotify developer app or client ID. The owner explicitly requested web-tab playback. The existing PKCE/API implementation is retained for the separate E6 experiment.
7. No bot recording of meeting media, no downloading/decrypting protected media, no automated login, and no reuse of the owner's normal Chrome profile.
8. The only recording exception is a human filming the bot tile during synthetic camtest in an agreed test meeting, with humans silent/cameras off and no protected music. Footage stays in ignored `.local/evidence/`, is deleted after offsets are extracted, and only numbers enter `FEASIBILITY.md`. This does not authorize ordinary meeting/video recording.

The owner confirmed they were actively sending new `/bot` commands during debugging. Repeated playback starts were therefore not sufficient evidence of an observer replay bug. Announce a controlled observation window before further replay experiments so owner and agent commands do not confound each other.

## Supported chat commands

Updated 2026-09-30 for the yt-dlp route and the queue (offline-tested only; not yet exercised in a live meeting).

```text
/bot <link>                  (queues if something is playing)
/bot "<link>"
/bot play <link>
/bot spotify <link>
/bot applemusic <link>       (alias: apple)
/bot youtube <link|search>   (aliases: yt, ytmusic, youtube-music) — yt-dlp audio
/bot yt <search text>        (ytsearch1, top result)
/bot ytvideo <link>          (native tab share, unchanged)
/bot skip                    (alias: next; broken entries are skipped too)
/bot queue                   (first 10 entries: titles, search text or service name, never links)
/bot np                      (now playing)
/bot clear                   (empties the queue, keeps the current track)
/bot pause
/bot resume
/bot play                    (resume current source)
/bot mute
/bot unmute
/bot stop                    (stops and clears the queue)
/bot help                    (/bot alone also shows help)
```

Service prefixes must match the URL. Ordinary chat is ignored; history present at observer installation is not replayed. Commands are serialized. Playing while something plays adds it to a queue capped at 20 entries. The next YouTube entry is resolved ahead of time for its title and a faster start. yt-dlp tracks advance automatically when `/player` reports ended; Spotify, Apple Music and ytvideo entries advance only on `/bot skip`. A failed control command (pause, resume, mute) now reports its error without stopping playback. Any participant can currently control playback, including stop and clear; sender authorization is not implemented. No volume command. Mute preference persists across source changes.

## Architecture and important files

| File | Responsibility and relevant behavior |
| --- | --- |
| `scripts/bot-launch.js` | Owns branded Chrome, dedicated profile, loopback debug verification, CDP attachment, exactly two bot tabs and shutdown. Current viewport/window size is 1920×1080; headless additionally uses `--screen-info={0,0 1920x1080}`. A random player title confines automatic tab capture selection. Windowed mode uses `--window-position=-10000,-10000`. |
| `scripts/experiment.js` | Starts local controller, installs Meet/player init scripts before navigation, grants relevant permissions, constructs driver and optional presentation support. |
| `scripts/bot-run.js` | Joins saved meeting, installs chat observer, runs one-second meeting/route watchdog. Skips route checks while commands navigate; ignores only transient destroyed-context errors. Fatal errors close the owned harness. |
| `controller/bot-command.js` | Strict link/parser logic, sequential command queue, busy flag, stable message dispatch. Reports sanitized errors/action/source locations. A command failure currently stops playback and clears the source. |
| `controller/playback.js` | Coordinates stop/mute/camera, source navigation, service adapters, presentation and controls. `playing()` checks position/readiness, not sustained progress or receiver delivery. |
| `controller/meet-driver.js` | Centralized English Meet selectors, prejoin/admission, media controls, settings, presentation stop, chat read/send. Chat panel opens once in the bot; subsequent reads use a JS observer. Stable IDs guard rerender duplicates. |
| `controller/meet-init.js` | Exact BlackHole input with processing disabled, guarded later constraints, synthetic canvas camera, incoming HTML/Web Audio silence. Also exposes numeric outbound-video diagnostics. |
| `controller/player-init.js` | Routes current/future/detached/shadow media and AudioContexts to BlackHole. Serialized sink operations, media registry, pause/resume/positions/check/status. No default output fallback. |
| `controller/presentation-init.js` | Arms native display capture only for browser tabs with audio, rejects windows/monitors, suppresses local audio. Current cap is 1280×720 at up to 30 fps with motion hint; guards later constraints and video clones. |
| `controller/youtube.js` | Navigates official player, pauses for preparation, fixes random capture title, requests true fullscreen and validates bounds, then starts playback. Latest saved edits force contain/center and avoid toggling out of existing fullscreen. No sustained player-error recovery. |
| `controller/spotify.js` | Both old PKCE/device-targeted API code and current DOM web-player adapter. DOM Play is scoped to the main action bar and requested track title is checked. |
| `controller/applemusic.js`, `controller/youtubemusic.js` | Minimal service pilots; not end-to-end qualified. |
| `controller/server.js` and local `/player` | Loopback controller and diagnostic tone/beep/local-file page. This page must not accidentally become the shared YouTube surface. |

Useful metadata-only browser diagnostics:

- Meet: `window.meetCompanion.inputSettings()`, `await window.meetCompanion.sendStats()`, `window.meetCompanion.senderParameters()`.
- Player: `window.companionRoute.status()`, plus its `check`, `positions`, `pause` and `resume` methods.
- Presentation: `window.companionPresentation.status()`.

Prefer one controlling connection. The last read-only inspection used Node 22's WebSocket client and CDP `Runtime.evaluate`, avoiding a second Playwright connection's defaults. Local Playwright 1.63 supports `connectOverCDP(..., { noDefaults: true })`; a temporary diagnostic used it, but the main launcher does not. Whether repeated attachments contributed to failures is **unproven**. For CDP-attached Playwright, `browser.close()` disconnects that connection; the launcher's explicit browser shutdown is a different operation.

## Open issues, in priority order

### 1. Repeated YouTube playback error — unresolved

The receiver repeatedly sees “Something went wrong. Refresh or try again later.” Direct inspection of YouTube's `.ytp-error` / `.ytp-error-content-wrap-reason` confirmed this in the source tab. It is not merely a receiver presentation error.

Observed player response had `playabilityStatus.status: "OK"`, but the video later had readiness/network state 0, time 0, paused true, no native MediaError and player state -1. Therefore checking playability alone is insufficient.

In one controlled headless retry, request metadata showed 12 HTTP 403 responses and 12 aborted requests from Google video delivery; ad playback also had successful responses. The requested content subsequently advanced to approximately 39.78 seconds during a 60-second observation that included approximately 20 seconds of advertising. Final counts included 12 HTTP 200, one 204 and 12 HTTP 403 responses. The error returned later. **The 403s are evidence to investigate, not a proven root cause; successful playback coexisted with them.** No media bodies were downloaded for diagnosis.

The owner says the same URL works normally beyond one minute in regular Chrome. A same-profile windowed comparison outside Meet was proposed but **not run**. A vanilla-player versus injected-routing comparison was also not run. The asynchronous `HTMLMediaElement.play` override still waits for routing on every call; compatibility effects remain a hypothesis. No synchronous already-routed fast path has been implemented.

Keep comparisons controlled and retain only status counts and safe error codes. Do not dump whole YouTube responses, signed URLs or tracking metadata, and do not attempt access-control/DRM workarounds. There is no implemented YouTube error watchdog, so the bot can remain LISTENING while the player displays an error.

### 2. Cropping, tall framing and asymmetric bars — unresolved at receiver

The owner reported theatre mode, an overly tall picture/red bars, cropped lyrics/right edges, and a top black bar without a matching bottom bar. Earlier headless screen dimensions were 800×600 and one observed CSS viewport was only 609×457. The virtual screen/window configuration was corrected to 1920×1080.

Later source measurements showed true fullscreen and a 1920×1080 player/viewport, while capture initially reached 3840×2160. Current capture caps produce approximately 1278×720 (small pixel rounding). **Those dimensions did not prove the receiver had an uncropped picture.**

YouTube's video was observed with `object-fit: cover`. The latest saved patch forces `contain` and centered positioning. It was also injected into one live tab, but that tab was already failed with intrinsic video dimensions 0×0, so this did not validate the correction. Intermittent `YOUTUBE_FULLSCREEN_UNVERIFIED` failures occurred; the latest saved guard avoids blindly toggling an already-fullscreen player. Neither final change has live acceptance.

Next validate whole-frame geometry with a local synthetic four-corner pattern, then actual source/receiver bounds. Do not introduce further cropping to hide bars without determining whether they belong to the source or layout.

### 3. Very low/variable presentation frame rate — not qualified

Before tuning, numeric outbound statistics showed approximately 4–5 fps at 1920×1080 with `qualityLimitationReason: "bandwidth"`. After the 720p cap and motion/clone guards, observed outbound samples included **14, 25, 30, 25, 5 and 9 fps**, at approximately 1278×720. The limitation reason was `none` during those latter samples. This is improvement, not stable 30-fps delivery.

Observed sender parameters included motion content hint, `maintain-framerate-and-resolution`, an active encoding with max frame rate 30, max bitrate 4,000,000 and scale factor 1; other encodings were inactive. Source/ad transitions, static content and owner resubmissions confounded the run. No sustained smooth receiver confirmation was obtained. Compare source frame progress, outbound frame deltas, encoding/bandwidth limits and receiver observation before further bitrate changes.

### 4. Source changes and command lifecycle — partial verification

Verified earlier failure: stopping the original display track did not reliably clear Meet's presentation UI/clone. Navigating afterward exposed the local diagnostic player to the meeting. The driver now clicks “You are presenting” → “Stop presenting”, waits for the UI to clear, then navigates. Offline guards and the live stop action passed.

Video clone handling was adjusted to avoid an asynchronous constraint application racing clone creation. Tests pass. However, presentation mute/status currently follows the original audio track, not all possible cloned audio tracks; this is an **unverified gap**, not a confirmed receiver bug.

Full end-to-end pause/resume/mute/unmute/stop/help and source-switch coverage is unfinished. Any command error currently stops and clears the source, which can turn a transient control failure into lost playback. Stable-ID chat dedupe has a regression test, but remember that the owner was also intentionally sending commands.

### 5. Spotify quality and no-echo behavior — improved, limited acceptance

Wrong-song selection was traced to an overly broad Play selector. The adapter now targets the main action bar and checks the requested track title. Quiet/processed audio was investigated: Meet Studio sound can remain on independently of getUserMedia processing flags. The driver disables those UI filters and guards echo cancellation, noise suppression and AGC as false. Live input settings showed 48 kHz stereo with all three flags false. This does not make Meet's transmitted codec lossless/raw.

The owner first heard brief audio and then silence; a later retry received “Stays audible.” That is useful acceptance of that retry, not a long-duration quality result. Spotify's visible eight-second loop was not the song audio: the actual song used a detached VIDEO element, observed at approximately 236 seconds duration. Registry-based detached-media controls passed two real-player pause/resume cycles. Do not revive the incorrect diagnosis that pausing the decorative loop necessarily stopped the song.

The earlier self-echo stopped when the bot disconnected. Local HTML/Web Audio silence checks pass, but the final complete no-echo/receiver-quality matrix remains pending.

### 6. Runtime exits and diagnosis — partly addressed

Several earlier stops reported `HARNESS_OPERATION_FAILED`; their exact causes were not established. An occurrence around 21:33:44 UTC happened during diagnostics. Some intentional interruptions also logged `BROWSER_CRASHED`; distinguish intentional shutdown from an actual crash.

The route-watchdog/navigation race was addressed with command-busy handling and narrowly ignored destroyed-context errors. More useful safe diagnostics now include stage, error type, action and code source locations. A successful STARTED observation still does not check sustained source progress. Broad meeting-state text matching and repeated CDP attachment effects are audit concerns, not verified diagnoses.

### 7. Other services and original acceptance remain incomplete

- Apple Music was signed out. Manual owner login and an agreed test link are needed. Track selection for album URLs with a song parameter may need a narrower selector; current broad Play behavior has not been qualified.
- YouTube Music session and requested-song playback are unverified. No owner test link has been collected.
- E5 sender attribution is not passed; current chat controller accepts commands without participant authorization.
- Full E0–E6 acceptance, five cold starts, two-hour operation and production readiness have not been demonstrated.

## Checks and evidence available

Current saved source was checked immediately before handoff:

- `npm run check`: **30 ESM files passed**.
- `npm run verify:offline`: **14/14 tests passed**.
- Latest earlier `verify:presentation`: passed a local synthetic fullscreen browser-tab capture at approximately 1278×720, one audio track, local-playback suppression true, synthetic RMS approximately 0.08734.
- Earlier local Meet-silence test passed.

Offline coverage includes command/link parsing, serialized dispatch/failure behavior, stable-ID chat dedupe, detached-media controls, sink concurrency/device changes/closed contexts/device absence, admission false positives, presentation stop before navigation, tab-capture constraints/motion/clones, media-off verification, raw-input constraints, Meet Web Audio silence, PKCE state and device-targeted Spotify API calls.

These tests are **not** proof of stable YouTube playback, uncropped receiver output, steady frame rate, service authentication or complete live controls. Do not run another browser harness against the occupied profile just to repeat a passing check.

## Dirty work to preserve

HEAD when handed over: `6176f2f` (`docs: adopt native tab video and audio for YouTube`). Earlier commits include `9a525f0` (Meet Web Audio silence), `3e9f272` (media/admission verification), and `8f859a6` (BlackHole labels/admission).

Modified tracked files:

```text
AGENTS.md
README.md
controller/AGENTS.md
controller/meet-driver.js
controller/meet-init.js
controller/player-init.js
controller/spotify.js
docs/BRIEF.md
package.json
scripts/AGENTS.md
scripts/bot-launch.js
scripts/experiment.js
scripts/offline.test.js
```

New files, including this handoff:

```text
controller/bot-command.js
controller/playback.js
controller/presentation-init.js
controller/youtube.js
docs/CHAT_BOT.md
docs/HANDOFF.md
scripts/bot-run.js
scripts/verify-presentation.js
```

Do not commit ignored configuration, profile data or evidence. Existing learning entries were appended to the machine project/mistake files, controller/scripts AGENTS and machine testing/debugging notes during the session. Preserve them. Some final hypotheses/untested patches have deliberately not been recorded as verified fixes.

## Suggested next sequence

1. Read instructions and this handoff; inspect the existing diff and live ownership. Agree on a quiet command-observation window with the owner. Restart only the owned bot when ready so saved source and runtime align.
2. Isolate YouTube's source failure: compare the same dedicated profile in windowed and headless Chrome outside Meet, then compare routing injection as needed. Observe well beyond the failing interval, recording only safe metadata. The regular-profile owner comparison already passed; do not make them repeat it without a reason.
3. Validate full-frame geometry with a local four-corner synthetic presentation, then true-fullscreen YouTube using contain/center and measured source bounds. Obtain receiver confirmation before declaring cropping fixed.
4. Measure sustained source and outbound frame progress during moving content. Qualify frame rate and receiver sound rather than relying on configured 30 fps or a single STARTED event.
5. Exercise source switches and pause/resume/mute/unmute/stop; inspect whether cloned presentation audio needs explicit control. Ensure no diagnostic page appears during replacement.
6. Recheck Spotify requested-track accuracy, durable receiver audio and absence of echo. Then request only missing Apple Music/YouTube Music sign-in and test links.
7. Update stale runtime/feasibility documentation with measured results, review the diff and preserve/commit work as authorized. Do not mark the broader playback objective complete while service and receiver acceptance remains open.

## Owner-provided public reproduction links

- Spotify: https://open.spotify.com/track/7J3gWwFF84eXhB6Ek4ry4N
- YouTube: https://www.youtube.com/watch?v=qJa_WD5mNho&list=RDqJa_WD5mNho&start_radio=1

The parser canonicalizes supported URLs; YouTube tests also used the watch URL without radio parameters. Read the saved meeting link from ignored local configuration. The meeting code and participant chat are intentionally absent from this tracked document.
