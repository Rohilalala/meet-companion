# Phase 0 controller harness

## Purpose
Own the diagnostic player, init scripts, Meet driver, Spotify PKCE experiment and owner-authorized `/bot` commands using official service players. Music uses BlackHole with processing disabled; YouTube uses native tab video/audio with microphone and camera off.

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

### 2026-09-30 — Meet modal can hide active media controls from role queries
On the host-confirmed retry, getByRole returned no camera/microphone/leave controls while rendered button aria-labels showed the synthetic camera and BlackHole microphone enabled. A modal intercepted pointer clicks. Never interpret missing controls as disabled or silently skip prejoin safety. Explicit OFF-only DOM button actions worked; verify the corresponding Turn on control afterward and throw MEDIA_OFF_UNVERIFIED if missing. Both disabled states were verified live. disableMedia now runs before the request and after UI admission; six offline tests pass, including unknown controls and repeated OFF checks. A full fresh join with this correction remains unqualified.

### 2026-09-30 — HTML media muting does not cover Web Audio output
An owner-reported echo stopped after disconnecting the bot. Inspection found that the Meet init script muted HTML media but left Web Audio output unconstrained; this is a verified code gap, not a proven live echo cause. Force AudioContext constructor and later setSinkId calls to the silent sink {type: none}, including the webkit alias, only in the Meet tab. Seven offline tests pass; npm run verify:meet-silence verified native media muting, a running silent oscillator, blocked output changes, and an unaffected separate player in branded headless Chrome. The live no-echo retest remains pending; do not label it fixed from local evidence.


### 2026-09-30 — Wait for media controls before changing prejoin state
Meet can display Join before its media controls are ready. Wait for either the on or off microphone/camera control before enforcing OFF. Fresh live joins and the offline media-state checks passed.


### 2026-09-30 — Use a trusted browser click to enable the microphone
A DOM-dispatched unmute action did not enable the microphone in live Meet. Bring Meet to the front, click the rendered unmute button through Playwright, and verify the Turn off microphone control. This reached STARTED with raw processing flags false.


### 2026-09-30 — Close the audio settings dialog precisely
A generic Close query matched the chat close button behind Meet settings. Use the Close dialog accessible name. The live Studio sound switch was independently enabled despite raw input flags; disable it in Audio settings before music playback. Live inputs reported 48 kHz, stereo, with echo cancellation, noise suppression and automatic gain control false.


### 2026-09-30 — Read current Meet chat markup and compact menus
The compact Meet layout puts chat under More options and messages use a nested jsname node. Open In-call messages through More options when the direct button is absent; observe data-message-id with nested jsname=dTKtvb. Actual participant commands reached the controller. Sender attribution remains unknown and E5 is not passed.


### 2026-09-30 — Scope Spotify Play to the requested page action bar
A broad Play selector started the wrong song from the sidebar. Use action-bar-row Play and compare main heading with now-playing title for track links. The requested title matched in live playback; the receiver later confirmed continuous audibility for an unspecified interval.


### 2026-09-30 — Spotify song audio can use a detached VIDEO element
The visible Spotify VIDEO was an eight-second visual; the song used a detached VIDEO with a 236-second duration. DOM-only pause/resume missed it, and filtering AUDIO tags also failed. Control registered media, and use detached media for Spotify song progress/resume. Two real-player cycles of pause twice then resume advanced the song. The offline fixture uses a detached VIDEO and a connected visual.


### 2026-09-30 — Serialize output-device switches on each media element
The supplied YouTube video produced AbortError during overlapping setSinkId calls, setting AUDIO_ROUTE_LOST. Share one pending route promise per element and avoid switching an already-correct sink. The same video then remained fullscreen with native tab audio for 16 seconds without route errors; the offline fixture rejects overlapping switches.


### 2026-09-30 — Closed audio contexts must leave the routing registry
Closing a context and dispatching devicechange reproduced a false AUDIO_ROUTE_LOST in branded Chrome. Remove contexts when close is called, ignore closed contexts during revalidation, and do not turn their rejected sink operation into a global route failure. The offline regression passes.


### 2026-09-30 — Device notifications must preserve healthy playback
The devicechange handler unconditionally paused all players and never resumed them. Revalidate HTML sinks while temporarily muted and retain play state when the exact BlackHole route remains valid. The offline fixture preserves playback for a harmless notification and mutes on actual device loss.


### 2026-09-30 — Stop a Meet presentation through its UI before navigation
Stopping the original display tracks left Meet showing You are presenting and exposed the diagnostic page when the tab navigated. Click You are presenting then Stop presenting and verify that indicator disappears before changing the player page. The live UI cleared, repeated live video requests subsequently reached STARTED, and an offline regression prevents navigation if stop verification fails.
