# Phase 0 scripts

## Purpose
Check local prerequisites and open a dedicated browser for manual login. These scripts do not implement a controller, join meetings, or play media.

## Run / test
From the repository root: `npm run check`, `npm run preflight`, `npm run bot:login`.

## Debug
Failures appear on stdout/stderr as prerequisite codes. Do not print Chrome output, private config values, cookies, or account details.

## Landmines
Use Node 22 and plain ESM. The login command must have no remote debugging, automation flags, or automated sign-in; reject the default Chrome profile including symlink aliases. Never change the system output or reuse an arbitrary running Chrome instance.

## Last updated
2026-09-30
