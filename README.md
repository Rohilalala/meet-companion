# Meet Companion

Private Google Meet music bot for macOS on Apple Silicon. **Phase 0 preparation only; the bot is not implemented or qualified yet.** Read [the feasibility report](docs/FEASIBILITY.md) for measured checks, blockers, and E0–E6 procedures; [the original brief](docs/BRIEF.md) is the architecture contract.

## Available now

```sh
cd ~/Documents/meet-companion
source ~/.nvm/nvm.sh
nvm use
npm run check
npm run preflight
npm run bot:login -- --dry-run
```

Node 22.23.3 was installed through the existing nvm. No npm dependencies are needed for these setup scripts. `preflight` exits 1 when a prerequisite is missing; that is not an executed feasibility failure. It checks the local runtime, branded Chrome, profile path, audio device presence and direct default-output assignments. An aggregate/multi-output default needs manual membership inspection.

The future controller uses Playwright `connectOverCDP` to branded Google Chrome; no alternative browser or automation launch configuration is substituted here.

## BlackHole 2ch

Install the free driver using the [official BlackHole installation instructions](https://github.com/ExistentialAudio/BlackHole#installation-instructions):

```sh
brew install blackhole-2ch
```

The system installer can require administrator interaction; restart if prompted. Installation was not performed in this session. In Audio MIDI Setup, verify BlackHole 2ch appears as both input and output. Keep the Mac's output on speakers/headphones. Inspect any Multi-Output Device used for system sounds and ensure it does not include BlackHole. Do not use the generic “route system audio” instructions: this project routes only the player tab using `setSinkId`.

Rerun `npm run preflight`. No paid routing tool, global output switching, CoreAudio restart, or device reconfiguration is performed by the scripts.

## Bot account and manual login

Create a separate Google account manually. The host adds that exact account as a guest to the saved meeting's Google Calendar event. Arrange a test receiver and a cooperating host; invitation and host access settings require live E1 verification.

Default bot profile: `.local/chrome-bot` under this repository. Optional local configuration:

```sh
cp -n config.example.json config.local.json
npm run bot:login
```

The launcher opens accounts.google.com, open.spotify.com, music.apple.com and music.youtube.com in a dedicated normal Chrome window **without remote debugging**. Sign every account in by hand. The Google account must be the bot's; the music subscriptions are the owner's. No script enters credentials or solves sign-in challenges. Close the dedicated browser completely before later relaunch experiments. A profile lock is a refusal, not a reason to delete Chrome lock data or kill the owner's browser.

The two supported configuration keys are `chromePath` and `userDataDir`; relative paths resolve from the repository. Do not point this at the owner's default Chrome data directory or its subprofiles. The login launcher validates the path, including symlink resolution. Keep the bot profile private and outside tracked files if using an external location.

## Service setup needed for the live experiments

These are preparation requirements, **not implemented adapter configuration yet**. Never paste passwords, bearer tokens, OAuth tokens or private keys into chat, source files, logs or Git.

- **Spotify:** Create a development-mode app for the owner's Premium account and allowlist the playback account as required by the dashboard. Register exactly `http://127.0.0.1:3210/callback` for the proposed controller port. Authorization Code + PKCE requires `user-read-playback-state user-modify-playback-state`; no client secret is needed for PKCE. The controller and callback are not present yet. E6 must verify the official API controls the open.spotify.com web player as the selected Connect device. See [Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) and [redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).
- **Apple Music:** Sign in to music.apple.com manually. Prepare the Apple developer team ID, key ID and path to the owner's existing MusicKit `.p8` key outside the repository. The planned developer token is for title/artwork metadata only; actual playback uses DOM controls in the official player. No `.p8` key or token is loaded by the current scripts. See [Apple developer tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).
- **YouTube Music:** Sign in manually at music.youtube.com. Playback must stay in the official player and use DOM controls plus sink selection; no downloader or capture path.
- **Jamendo:** Obtain a client ID for the [Jamendo API v3](https://developer.jamendo.com/v3.0). The future local `/player` plays API-provided audio without writing it to disk; status/chat must include artist attribution and Jamendo backlink.
- **Local music:** Choose an existing music folder with files the owner can play. The Phase 1 config will point to that folder; filename/tag matching and local playback are not implemented yet. The E3 pilot first needs a generated 60-second 440 Hz tone so source availability does not depend on subscriptions.

## Extension and Phase 1

No `extension/` is created before the Phase 0 report. Once Phase 1 is authorized and implemented, load that directory in the **owner's Chrome** using `chrome://extensions` → Developer mode → Load unpacked. The options page will store the bearer token and saved meeting configuration; the controller will allow only that extension's exact origin and bind only to `127.0.0.1`. Do not try to load this repository root as an extension.

Phase 1 must include the session state machine, single MusicActivity, service adapters, the extension popup, PIN/rate-limit permissions, audio watchdog and diagnostic-only canvas boundary from BRIEF.md. It must add exactly one small offline `node:test` file for permissions/PIN, parsing and adapter matching. Live second-device acceptance goes in `docs/ACCEPTANCE.md`; a two-hour run uses `caffeinate -i -w <controller pid>` after the controller exists. Keep the laptop open; an idle-sleep inhibitor does not guarantee operation through lid-close sleep.

No meeting media or raw chat may be recorded. Raw WebRTC **statistics** stay in ignored `.local/evidence/`, with only reviewed numeric excerpts in the report. E4's requested receiver filming is blocked until the owner resolves its conflict with the no-recording rule.
