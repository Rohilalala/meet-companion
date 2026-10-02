# Meet Companion

## Purpose
Private Google Meet music participant using a dedicated branded Chrome profile and a dedicated virtual audio route (BlackHole 2ch on macOS, a PulseAudio/PipeWire sink on Linux; see `scripts/platform.js`), with a Phase 0 diagnostic harness. The owner additionally authorized a minimal live `/bot` controller for Spotify, Apple Music and YouTube Music audio, plus native YouTube tab video/audio sharing.

## Run / test
- `nvm use`
- `npm run preflight` (exit 1 means prerequisites are blocked, not that E0–E6 failed)
- `npm run check` (offline JavaScript syntax checks)
- `npm run verify:offline` (no network)
- `npm run verify:browser` (localhost integration, short generated default-output tone)
- `npm run bot:login` (owner performs every sign-in manually)
- `git diff --check`

## Debug
Read `docs/FEASIBILITY.md`. Preflight prints only allowlisted system metadata; persist no chat text, tokens, meeting links, or media in logs.

## Landmines
- Preserve `docs/BRIEF.md` and its owner amendments; the requested chat runtime is authorized, while unrelated extension/PIN work remains deferred. Preserve diagnostic evidence and do not claim untested service support.
- Never automate sign-in, inspect the owner's default Chrome profile, or use Chrome for Testing.
- No recording, protected-media capture/download/decryption, paid routing substitutions, or default-output changes.
- Do not treat a missing prerequisite as an executed experiment or a headless API check as E0 passing.
- E4 human filming is authorized only during camtest in a consenting test meeting: humans silent/cameras off, frame only the bot tile, synthetic local beep only. Footage stays in ignored `.local/evidence/` and is deleted after extracting offsets. Bot code must never record meeting media.
- No parallel workstreams without separate Git worktrees; no automatic merges or AI commit trailers.

## Last updated
2026-09-30
