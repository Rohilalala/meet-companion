# Meet Companion

## Purpose
Private Google Meet music participant using a dedicated branded Chrome profile and BlackHole 2ch. This checkout is Phase 0 preparation only; report feasibility and stop before Phase 1.

## Run / test
- `nvm use`
- `npm run preflight` (exit 1 means prerequisites are blocked, not that E0–E6 failed)
- `npm run check` (offline JavaScript syntax checks)
- `npm run bot:login` (owner performs every sign-in manually)
- `git diff --check`

## Debug
Read `docs/FEASIBILITY.md`. Preflight prints only allowlisted system metadata; persist no chat text, tokens, meeting links, or media in logs.

## Landmines
- Preserve the exact architecture in `docs/BRIEF.md`; no Phase 1 implementation before reporting Phase 0.
- Never automate sign-in, inspect the owner's default Chrome profile, or use Chrome for Testing.
- No recording, protected-media capture/download/decryption, paid routing substitutions, or default-output changes.
- Do not treat a missing prerequisite as an executed experiment or a headless API check as E0 passing.
- E4 filming conflicts with the no-recording rule; obtain the owner's interpretation before filming.
- No parallel workstreams without separate Git worktrees; no automatic merges or AI commit trailers.

## Last updated
2026-09-30
