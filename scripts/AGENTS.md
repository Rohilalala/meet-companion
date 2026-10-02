# Phase 0 scripts

## Purpose
Run Phase 0 browser, routing and live experiment diagnostics. Live runners may join configured test meetings only when explicitly invoked with `--live`.

## Run / test
From the repository root: `npm run check`, `npm run verify:offline`, `npm run verify:browser`, `npm run e0` through `npm run e6`.

## Debug
Failures appear on stdout/stderr as prerequisite codes. Do not print Chrome output, private config values, cookies, or account details.

## Landmines
Use Node 22 and plain ESM. The login command must have no remote debugging, automation flags, or automated sign-in; reject the default Chrome profile including symlink aliases. Never change the system output or reuse an arbitrary running Chrome instance.

## Last updated
2026-09-30

## Learnings

### 2026-09-30 — Graceful CDP close and dead-PID profile locks
After the first Chrome check, SingletonLock remained while its recorded process PID no longer existed; a blanket file-exists check refused the next launch. Use CDP Browser.close, wait for the spawned process to exit, refuse locks for live or foreign-host PIDs, and let Chrome recover its own dead-PID lock without deleting profile data. Repeated headless and windowed launches attached and closed successfully.


### 2026-09-30 — Native tab sharing needs focus and a trusted gesture
The local native display request failed with InvalidStateError while its calling page was not focused. Bring the calling page to the front before its trusted click. The synthetic integration test returned a browser surface, one audio track, local suppression and nonzero tone energy without recording.


### 2026-09-30 — Do not treat player navigation as an audio-route crash
The route watchdog queried the player during navigation and aborted the runtime on destroyed execution context. Skip route polling while serialized commands are busy, and retry only the transient destroyed-context condition. Subsequent live Spotify and YouTube starts succeeded without this abort.


### 2026-09-30 — Configure the headless screen as well as fullscreen page size
The live tab reverted to an 800x600 virtual screen despite a temporary 1920x1080 page resize. Launch Chrome with window-size=1920,1080 and screen-info={0,0 1920x1080}; set the YouTube viewport in the owning runtime before fullscreen. Latest live metadata reported a 1920x1080 screen and player and a 3840x2160 browser display track, all 16:9. Receiver aspect-ratio recheck remains pending; the earlier receiver error is not proven fixed.


### 2026-10-02 — Two SIGINT handlers raced; Leave was never clicked
bot-launch.js registered its own SIGINT/SIGTERM handler (close Chrome, exit 130) while bot-run.js only set a flag polled once a second, so every stop closed Chrome before the Leave click and left a ghost participant. bot-run now passes signals: false and owns shutdown with process.on (a repeated signal must not restore Node's default kill). Verified through the launcher: exit code 0, second Leave refused, no Chrome left. The launcher spawns the bot detached so a force-kill can take the whole process group.
