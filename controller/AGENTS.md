# Phase 0 controller harness

## Purpose
Own the diagnostic localhost player, browser init scripts, Meet driver and Spotify PKCE/player calls. No extension, activity queue, or Phase 1 session controller belongs in this phase.

## Run / test
From the repository root: `npm run check`, `npm run verify:offline`, `npm run verify:browser`.

## Debug
Print fixed error codes and numeric/boolean observations only. Never log chat, links, OAuth responses or browser console output.

## Landmines
Never capture protected playback into Web Audio or record meeting media. All service audio fails closed without BlackHole; default output is permitted only on the local synthetic diagnostic page with explicit opt-in. Meet selectors belong in meet-driver.js; service selectors in each service file. Tokens live only in memory. HTTP routes bind to loopback and validate Host; only /player and /callback are token-free.

## Last updated
2026-09-30

## Learnings

### 2026-09-30 — Chrome appends Virtual to BlackHole device labels
After reboot, macOS preflight reported BlackHole 2ch but Chrome enumerateDevices labelled both input and output BlackHole 2ch (Virtual). The plain-name match blocked the first live attempt before requesting admission. Reproduced with the offline microphone fixture, then allowed only the exact optional (Virtual) suffix in both init scripts. All four tests pass. Live input settings select BlackHole with all three processing flags false; HTMLMediaElement and AudioContext sink IDs match BlackHole.
