# Meet Companion

## Purpose
Private Google Meet music participant using a dedicated branded Chrome profile and BlackHole 2ch. This checkout contains only the Phase 0 diagnostic harness; report feasibility and stop before Phase 1.

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
- Preserve the exact architecture in `docs/BRIEF.md`; no Phase 1 implementation before reporting Phase 0.
- Never automate sign-in, inspect the owner's default Chrome profile, or use Chrome for Testing.
- No recording, protected-media capture/download/decryption, paid routing substitutions, or default-output changes.
- Do not treat a missing prerequisite as an executed experiment or a headless API check as E0 passing.
- E4 human filming is authorized only during camtest in a consenting test meeting: humans silent/cameras off, frame only the bot tile, synthetic local beep only. Footage stays in ignored `.local/evidence/` and is deleted after extracting offsets. Bot code must never record meeting media.
- No parallel workstreams without separate Git worktrees; no automatic merges or AI commit trailers.

## Last updated
2026-09-30
