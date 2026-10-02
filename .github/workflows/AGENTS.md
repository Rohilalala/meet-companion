# CI workflows

## Purpose
Define account-free Ubuntu ARM64 checks for the bot. The checks cover local browser, audio, and trial-desktop setup.

## Run / test
From the repository root: `npm run check`, `node --test aws/launch-test.test.js`, `git diff --check`.

## Debug
Inspect the failing step in `linux-port.yml` and the runner's standard output. Reproduce Linux-only failures on Ubuntu ARM64.

## Landmines
Do not add accounts, meetings, protected media, AWS launches, or persistent artifacts to CI. Run the desktop behind loopback-only VNC.

## Last updated
2026-10-02
