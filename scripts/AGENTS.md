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
