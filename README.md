# Meet Companion

The owner-authorized `/bot` chat runtime is now being tested. Start it with `npm run bot -- --live` under Node 22. See [chat commands and current verification](docs/CHAT_BOT.md). Spotify in this runtime uses its official web player directly; it does not need a developer app. The Phase 0 API experiments below remain separate.

Private Google Meet music bot for macOS Apple Silicon. This repository contains the **Phase 0 feasibility harness**, not the Phase 1 product. The extension, queue/activity engine, PIN permissions and production session controller are deferred. Read [FEASIBILITY.md](docs/FEASIBILITY.md) for actual evidence and remaining gates, and [BRIEF.md](docs/BRIEF.md) for the architecture and owner clarification.

## Install and check

```sh
cd ~/Documents/meet-companion
source ~/.nvm/nvm.sh
nvm use
npm ci --ignore-scripts
npm run check
npm run verify:offline
npm run verify:browser
```

Node 22.23.3 is installed through the existing nvm. Playwright attaches to **branded Google Chrome**; do not install Playwright browsers or use Chrome for Testing. Plain ESM JavaScript, no bundler/framework.

`verify:offline` is one `node:test` file with mocked network responses and zero network calls. `verify:browser` is explicitly a localhost integration check. It opens the dedicated Chrome profile, plays about 1.2 seconds of a generated 60-second 440 Hz tone through the **default output**, tests the canvas and missing-BlackHole guards, then closes Chrome. This exception is restricted to the synthetic local tone check. It expects BlackHole to be absent; after installation use E3 to qualify the positive route. It does not establish human audibility. Generated silent WAV fixtures remain in ignored `.local/player-check-*` folders.

```sh
npm run verify:browser -- --windowed
npm run bot:launch
npm run bot:launch -- --windowed --hold
npm run preflight
```

`bot:launch` launches/attaches and exits; `--hold` keeps the two blank bot tabs available until Ctrl-C. It does not join, route audio or open service players; use experiment runners for those. Windowed mode requests an off-screen position. Actual port ownership and loopback-only binding are checked before attachment. Shutdown uses CDP `Browser.close`; live profile locks are refused, and Chrome handles stale locks belonging to dead processes. Do not delete profile locks manually. No default browser profile is inspected or reused.

## Prepare BlackHole and manual accounts

Install BlackHole 2ch using its [official instructions](https://github.com/ExistentialAudio/BlackHole#installation-instructions):

```sh
brew install blackhole-2ch
```

The system installer may require administrator interaction and a restart. No driver was installed in this session. In Audio MIDI Setup, confirm BlackHole exposes input and output. Keep macOS media output and system sounds on physical speakers/headphones. Inspect any default Multi-Output Device: it must not include BlackHole. The harness never changes system devices or installs paid routing tools.

Create a separate bot Google account by hand. Have the host invite that exact account to the saved meeting's Calendar event. Open the dedicated profile:

```sh
cp -n config.example.json config.local.json
npm run bot:login
```

The login launcher opens Google Accounts, Spotify, Apple Music and YouTube Music without remote debugging. Sign every account in **by hand**; Google uses the bot account and services use the owner's subscriptions. Fully close the bot browser before running diagnostics. Existing owner Chrome windows can stay open. No script enters credentials or bypasses challenges.

Edit ignored `config.local.json` locally. Supported fields:

| Field | Meaning |
| --- | --- |
| `chromePath`, `userDataDir` | Branded Chrome executable and dedicated profile; relative paths resolve from the repo |
| `port`, `debugPort` | Fixed loopback ports, default 3210 / 9223 |
| `defaultAggregateReviewed` | Set true only after manually verifying the current default aggregate excludes BlackHole; inspect again if devices change |
| `meetingLink`, `externalMeetingLink` | Saved test meeting and cooperating external-host meeting |
| `musicFolder`, `localFile` | Absolute music folder and optional relative filename beneath it; traversal and escaping symlinks are refused |
| `spotifyClientId`, `spotifyDeviceId` | Public app ID; optional exact web-player device ID when discovery is ambiguous |
| `spotifyLink`, `spotifyTrackLink` | Playlist/album playback context and a single track for queue tests |
| `applemusicLink`, `youtubemusicLink` | Individual service test links |
| `chatParticipants` | Two distinct exact display names for E5, in A/B order; never printed |
| `chatClockOffsetsMs` | Optional A/B clock offsets: bot time minus participant time. Leave null if unknown |

Never store passwords, bearer tokens, OAuth tokens or `.p8` contents in configuration or Git. The profile stores its normal browser sign-in state. Keep it private. The harness's bearer and Spotify tokens remain in process memory and are not printed or persisted.

## Run the experiments

Without `--live`, E0 runs only local launch/attach; E1–E6 print unmet prerequisites without contacting service pages. `--windowed` selects normal Chrome; otherwise headless is used for the feasibility trial. Both modes passed local checks, but E0's actual meeting/Spotify/receiver test must decide the mode for Phase 1.

| Command | What it does / prints |
| --- | --- |
| `npm run e0 -- --live` | Join saved meeting, manually authorize Spotify, target its web-player device, monitor 60 s, ask receiver for audible continuity/echo/owner impact |
| `npm run e1 -- --live --route=invitee` | Admission and timing, then host's observation; repeat with `knock`, `external`, and `member` as needed |
| `npm run e2 -- --live` | Five complete browser/controller relaunches; signed-in/signed-out/unknown for all services; stops if Google is unproven |
| `npm run e3 -- --live` | 60-second local 440 Hz tone, optional local file, then each configured service; asks receiver observations per source |
| `npm run e4 -- --live --windowed` | Camtest camera on, 1280×720 card, frame counter, 12–48 px text, 2-second flash and local 1 kHz beep; collects receiver numbers |
| `npm run e5 -- --live` | Observe 50 synthetic chat messages, sender attribution, duplicates and optional latency; send one diagnostic reply |
| `npm run e6 -- --live` | Spotify play/pause/resume/next/volume/queue, explicit target device and state confirmation |

Run live scripts in an interactive terminal. They print JSON observations and fixed error codes; prompts accept human observations. Non-interactive receiver answers remain unobserved. Update FEASIBILITY.md with reviewed numbers and sanitized host/bot system wording. No raw chat, meeting links, browser consoles, traces or tokens are logged. Chrome and the localhost server close on completion; Ctrl-C also shuts down the spawned browser.

E1's `member` route assumes the host has provisioned the bot using the allowed Meet `spaces.members` route; this harness does not obtain host credentials or create membership. The actual join path and host observation are reported separately. If Calendar invitation, knocking and the allowed membership route all fail, stop. No alternate account or screen-sharing route is substituted.

All Meet selectors are in `controller/meet-driver.js`. Apple/YouTube pilot controls and auth selectors are in their individual files; Spotify selectors and official API controls are in `controller/spotify.js`. These selectors target an English UI and have **not** been validated against signed-in service pages. Unknown states remain unknown; adjust only from observed service DOM when live setup exists.

For E5, A sends `E5 A 1` through `E5 A 25`; B sends the equivalent B sequence. Include interleaved bursts. An optional trailing 13-digit send timestamp plus a measured `chatClockOffsetsMs` enables latency calculations. Message text and sender comparisons live only in memory. A failed E5 yields CHAT_UNAVAILABLE; it does not stop the other experiments.

## Spotify and other services

Create a Spotify development-mode app for the owner's Premium account and allowlist the playback account as required by the dashboard. Register **exactly** `http://127.0.0.1:3210/callback` (or your configured port). The harness uses Authorization Code + PKCE and scopes `user-read-playback-state user-modify-playback-state`, without a client secret. E0/E3/E6 open consent in the normal browser for you to complete manually; nothing signs in automatically. Authorize each run because tokens remain in memory. See [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) and [redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

The official open.spotify.com player must appear as a Connect device. Ambiguous/missing devices produce SPOTIFY_WEB_PLAYER_DEVICE_REQUIRED; configure its exact device ID if necessary. A state response belonging to another device produces STREAM_TAKEN_OVER. The script never falls back to another player. Actual Premium/dev-mode API behavior remains E6 work.

Apple Music playback remains in its official player, controlled through the DOM and `setSinkId`; no media capture or decryption exists. For the later Apple metadata API, prepare a developer team ID, key ID and path to the owner's existing MusicKit `.p8` key outside the repository; metadata token integration is deferred to Phase 1. [Apple developer tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)

### YouTube audio (yt-dlp)

`/bot youtube <link>`, `/bot yt <link or search text>`, `/bot ytmusic <link>` and plain YouTube links play **audio only** through yt-dlp, the way Discord music bots do. This breaches YouTube's terms; the owner accepts that for private, non-commercial use. `/bot ytvideo <link>` keeps the native tab-share video path.

```sh
brew install yt-dlp
brew upgrade yt-dlp   # when YouTube changes break extraction
```

`npm run preflight` reports the installed version or `YTDLP_MISSING`. yt-dlp is not vendored. It always runs anonymously with `--ignore-config --no-cookies --no-cookies-from-browser --no-cache-dir --no-playlist`, audio only, and never writes media to disk. The direct audio URL stays in memory and plays in the local `/player` page, routed to BlackHole. If it does not start within 10 s, `/player` loads a single-use `/stream/<id>` (60 s expiry) that pipes yt-dlp's stdout; the child is killed on stop, source change and exit. Errors reach chat as `YTDLP_MISSING`, `YOUTUBE_BLOCKED` or `MEDIA_UNAVAILABLE`. Never add cookies, PO-token plugins, proxies or user-agent changes; if anonymous extraction is blocked, the feature stops working.

Prepare a [Jamendo API v3](https://developer.jamendo.com/v3.0) client ID for Phase 1. Jamendo integration, artist/backlink attribution and text-to-local-file matching are not part of this Phase 0 harness. Local playback currently takes an exact configured file beneath `musicFolder`.

## Audio, camera and evidence boundaries

Only `/player` and `/callback` are token-free HTTP paths. Local file responses are opaque, session-lifetime IDs under `/player`; the page and media reject cross-origin requests. `/status` requires both the exact configured extension origin and the in-memory bearer token; the extension is not built yet. Both HTTP and Chrome debug listeners bind only to loopback.

The player init script routes HTMLMediaElements and AudioContexts to BlackHole. Pending/failed media stays muted/paused; new AudioContexts start on Chrome's silent sink until routing succeeds. Meet getUserMedia requests always choose exact BlackHole input with echo cancellation, noise suppression and gain control off. Video requests return only the synthetic canvas. Meet remote media is muted. The only default-sink exception is the explicitly generated local tone integration check; no service runner enables it.

Open `chrome://webrtc-internals` on the receiver before E3/E4. Save **statistics only** under ignored `.local/evidence/`; do not enable diagnostic audio recording. Retain only reviewed numeric excerpts in FEASIBILITY.md. Browser playback counters do not replace receiver listening or demonstrate continuous ungated audio.

E4 human filming is authorized only during camtest with consenting test participants, cameras off and silence. Frame only the bot tile. No protected music; the beep comes from the local player. Disable Video framing and enable Show my full video to others first. Human footage stays in `.local/evidence/` and must be deleted immediately after extracting offsets. Record positive offsets for beep-after-flash; keep only the numbers. Bot code never records meeting media. The beep/canvas share a clock epoch; measured receiver offsets include scheduling, encoding and transport delays.

## Phase 1 remains gated

No unpacked extension exists yet. After Phase 0 is reported and Phase 1 is implemented, load `extension/` in the owner's Chrome via `chrome://extensions` → Developer mode → Load unpacked. Its options page will store bearer/configuration; do not load the repository root as an extension.

Phase 1 must add the session state machine, MusicActivity, queue/permissions/PIN handling, complete adapters, popup and audio watchdog. Its second-device acceptance goes in `docs/ACCEPTANCE.md`, including the two-hour run under `caffeinate -i -w <controller pid>`. Keep the laptop open; idle-sleep inhibition does not prevent lid-close sleep. Do not proceed to Phase 1 from these local checks alone.
