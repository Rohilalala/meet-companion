You are building v1 of "Meet Companion", a private Google Meet bot that joins as its own participant and plays music into the meeting through a virtual microphone. Work in a new git repo at ~/Documents/meet-companion. macOS on Apple Silicon. Node 22, plain ESM JavaScript, Playwright (connectOverCDP). Chrome MV3 extension in plain JS, no bundler, no frameworks. Keep code minimal. Do NOT build later activities (video, games, artwork); build only the boundaries named below.

CONTEXT THE OWNER HAS ACCEPTED
Music streaming services do not permit routing playback into a meeting. The owner accepts that terms risk for private, non-commercial use with their own subscriptions. The rule is still absolute: never decrypt, capture, download or bypass protected media. Audio reaches the meeting only by choosing the OUTPUT DEVICE of the services' own players (setSinkId → BlackHole). No yt-dlp, no librespot/spotifyd, no stream-ripping, no Web Audio capture of protected media.

ARCHITECTURE (do not change without stopping to ask)

1. extension/ (the owner's own Chrome, MV3)
   - Content script on https://meet.google.com/*: detects when the owner is really in a call (meeting code in the URL + in-call UI) and reports user-joined/user-left(code).
   - Service worker: calls the controller at http://127.0.0.1:<port> with a bearer token set once on the options page. If the code equals the saved meeting code, asks the bot to join ONCE.
   - Popup: bot meeting, current activity, playback state, now playing, queue, errors, current owner PIN. Controls: add link, play/pause/resume/skip/stop/volume/clear, "Join another meeting" (manual link), "Remove from meeting". Poll status every 2 s while open.

2. controller/ (Node process, binds 127.0.0.1 only)
   - HTTP API. Bearer token required. Origin must be the extension's chrome-extension:// origin (the /player page and the OAuth callback are the only token-free routes).
   - SessionController: state machine idle → launching → joining → awaiting_admission → in_call → leaving → idle.
     - Never joins a meeting it is already in.
     - After the owner removes it, does not rejoin that meeting until the owner leaves and joins again.
     - Leaves after 2 min alone.
     - Error codes: ADMISSION_DENIED, ADMISSION_TIMEOUT, SIGNED_OUT(service), MEDIA_UNAVAILABLE, AUDIO_ROUTE_LOST, MUTED_BY_HOST, STREAM_TAKEN_OVER (service paused because the account played elsewhere), CHAT_UNAVAILABLE, REMOVED, MEETING_ENDED, BROWSER_CRASHED.
   - CommandRouter: extension calls and chat messages both become {name, args, source, sender}. Session commands: leave, status, help. Everything else goes to the current activity.
   - Permissions:
     - Each activity exports a commands table {name: 'owner'|'participant'}.
     - Owner-only: leave/remove, clear, stop. Extension calls count as owner.
     - Owner commands in chat need a 4-digit one-time PIN shown in the popup (e.g. "/clear 4821"). The PIN rotates after every use.
     - The sender's display name must also match the configured owner name, as a second check only.
     - Per-sender rate limit on chat commands.
   - Activity contract (plain object, no plugin loader): { id, commands, start(outputs), handle(cmd), stop(), status() }. One activity at a time. v1 has only MusicActivity. outputs = { player, canvas }.
   - MusicActivity:
     - Queue entries are links.
     - A single-track entry advances when its track ends.
     - A playlist/album entry plays through in the service's own player. Skip moves to the next track inside it. When the adapter reports stopped at the end of the collection, advance to the next entry.
     - Commands: play <link|text>, pause, resume, skip, stop, volume <0-100>, clear, queue, np.
   - Service adapters. Each exports { matches(link), open(link), play(), pause(), next(), setVolume(v), nowPlaying() } and drives the PLAYER TAB:
     - spotify: control through the official Spotify Web API player endpoints (start/resume with context_uri or uris, pause, next, volume, queue add, player state), targeting the open.spotify.com web player in the player tab as the Connect device. OAuth Authorization Code + PKCE, redirect http://127.0.0.1:<port>/callback, scopes user-read-playback-state user-modify-playback-state. Owner's Premium account, development-mode app.
     - applemusic: open the music.apple.com link in the player tab and drive its play/pause/next controls through the DOM. Use the Apple Music API with a developer token (team ID, key ID, .p8 path from config) only for titles/artwork in status.
     - youtubemusic: open music.youtube.com / youtube.com links in the player tab and drive the DOM controls.
     - local: the controller serves http://127.0.0.1:<port>/player, a minimal page with an <audio> element playing files from a configured music folder. "play <text>" fuzzy-matches filenames/tags.
     - jamendo: Jamendo API v3 links (client_id from config), played in the same /player page. Show the artist and the Jamendo backlink in status and chat. Never write Jamendo audio to disk.
     - All service DOM selectors live in one file per adapter.

3. Bot browser
   - Branded Google Chrome, NOT Chrome for Testing (Widevine is needed). Dedicated non-default --user-data-dir from config.
   - The controller spawns Chrome itself with --remote-debugging-port=<fixed port> --remote-address=127.0.0.1 and attaches with Playwright connectOverCDP, so Chrome is not launched with automation flags.
   - Flags: --autoplay-policy=no-user-gesture-required --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling. Do NOT use --mute-audio.
   - Window mode is decided by E0: headless if E0 passes, else a normal window moved off-screen/minimized.
   - `npm run bot:login` opens the profile WITHOUT remote debugging, with tabs for accounts.google.com, open.spotify.com, music.apple.com and music.youtube.com. The owner signs every account in BY HAND. Never automate any sign-in. Detect a signed-out state per service → SIGNED_OUT(service).
   - Two tabs:
     a. MEET TAB, meet-driver.js (ALL Meet selectors live here): pre-join (mic = "BlackHole 2ch", camera off), join / ask to join, admission wait (3 min timeout), unmute, detect removal / meeting end / host mute, open the chat panel, read new messages via MutationObserver, send replies, leave.
        Init script in this tab:
        - Mute Meet's remote-audio elements, so the meeting does not play on the Mac and can never loop back.
        - Override getUserMedia/enumerateDevices:
          - Audio requests always get the BlackHole deviceId with echoCancellation, noiseSuppression and autoGainControl all false.
          - Video requests get a synthetic "Meet Companion Cam" = 1280x720 canvas.captureStream(30), dark card by default, camera off in v1.
          This canvas is the future virtual-camera route.
     b. PLAYER TAB: whichever service page or the local /player page the current entry needs.
        Init script in this tab:
        - Route every HTMLMediaElement (including ones created later) and every AudioContext to BlackHole with setSinkId / AudioContext.setSinkId.
        - Grant the permissions this needs per origin via CDP/Playwright.
        This is the virtual-microphone route: player tab → BlackHole → Meet mic.
   - BlackHole must never be the macOS system default output. Check this at startup and error out if it is.
   - Audio watchdog: player reports playing, but BlackHole is silent (sample via a getUserMedia(BlackHole) AnalyserNode in the Meet tab), Meet shows the bot muted, or the service tab lost playback → AUDIO_ROUTE_LOST / MUTED_BY_HOST / STREAM_TAKEN_OVER.
   - Controller-only diagnostic "camtest": test pattern on the camera (frame counter, 12–48 px text, a flash every 2 s) with a 1 kHz beep on the flash played through the /player page, camera on. Diagnostic only.

4. Privacy: never record meeting audio or video. Chat text lives only in memory. Logs contain command names and errors, not chat content or links.

PHASE 0 — FEASIBILITY (do these first, write results with evidence to docs/FEASIBILITY.md, then STOP and report before Phase 1)
E0 Headless: headless branded Chrome (a) joins a test meeting, (b) plays open.spotify.com, (c) routes it to BlackHole so a second device hears it. All pass → headless. Any fail → hidden normal window. Not a stop.
E1 Admission: bot joins the saved meeting (a) as a Calendar invitee, (b) by asking to join; (c) asks to join a meeting the owner does not own. Record exactly what host and bot see. Google says bots using "Ask to join" may be auto-denied.
E2 Sessions: Google, Spotify, Apple Music and YouTube Music stay signed in across 5 controller relaunches.
E3 Audio route: for EACH of local /player (60 s 440 Hz tone), Spotify, Apple Music and YouTube Music, a second device hears continuous, ungated audio through the bot's tile. Also confirm there is no echo/feedback, and the owner's own Meet on the same Mac is unaffected. Capture chrome://webrtc-internals on the receiver.
E4 Camera via camtest: on the receiver (pinned and unpinned, laptop and phone) record frameWidth/frameHeight/framesPerSecond/framesDropped, smallest readable text, and the flash-to-beep offset (film the receiver at 240 fps). First turn off "Video framing" and turn on "Show my full video to others" in the bot profile.
E5 Chat: 50 messages from 2 participants incl. bursts. Capture rate, latency, sender names, bot reply.
E6 Spotify control: Web API play/pause/next/volume/queue on the web-player device works, and the player state reflects it.

STOP CONDITIONS (stop, record what failed with evidence, ask the owner)
- E1: not admitted via (a), (b) or the Meet REST spaces.members route → STOP. Do not substitute the owner's account, screen presentation or another route.
- E2: Google sign-in cannot persist → STOP.
- E3: fails for every source including local /player → STOP. Fails only for some services → mark those adapters unavailable with the reason and continue. Do not install paid tools (Loopback/SoundSource) without asking.
- E4 or E5 failing is NOT a stop: record the numbers; ship with chat disabled (CHAT_UNAVAILABLE) if E5 fails.
- Anything requiring DRM circumvention, stream downloading, automated sign-in, or recording meeting media → STOP.

PHASE 1 ACCEPTANCE (observed from a second device; record each in docs/ACCEPTANCE.md)
1. Owner joins the saved meeting → the bot joins exactly once. A refresh or rejoin makes no second bot.
2. Manual join to another link works, or shows ADMISSION_DENIED / ADMISSION_TIMEOUT in the popup.
3. A local file, a Jamendo track, a Spotify playlist, an Apple Music album and a YouTube Music link each play audibly from the bot's tile. play/pause/resume/skip/stop/volume/queue work from the popup.
4. Playing the owner's Spotify on another device shows STREAM_TAKEN_OVER.
5. Chat (if E5 passed): /play, /pause, /skip, /queue work for any participant. /clear and /leave are refused without a valid PIN, work with it, and a reused PIN is rejected.
6. "Remove from meeting" → the bot leaves within 5 s and does not auto-rejoin.
7. Host muting the bot shows MUTED_BY_HOST. An unplayable link shows MEDIA_UNAVAILABLE. Killing BlackHole routing shows AUDIO_ROUTE_LOST.
8. grep shows no code path writes meeting audio or chat text to disk.
9. A 2-hour run with no crash. The Mac is kept awake by `caffeinate -i -w <controller pid>`.

Tests: one small node:test file for permissions/PIN, the command parser and link→adapter matching. No network in tests. README covers: installing BlackHole 2ch, creating the bot Google account, adding it to the saved meeting's Calendar invite, `npm run bot:login`, Spotify app + redirect URI, Apple developer token config, Jamendo client_id, the music folder, loading the unpacked extension. Commit in small steps. Do not implement video, games, artwork, yt-dlp or a co-watching add-on.


## Owner clarification — 2026-09-30

Build the Phase 0 harness before live setup is available, including launch/attach, both init scripts, /player, camtest, minimal Meet driver, Spotify PKCE/player control, and E0–E6 runners. Default-output synthetic local tone verification is explicitly authorized; protected service routing still requires BlackHole.

Human filming during camtest is authorized in a consenting test meeting: humans silent and cameras off, frame only the bot tile, no protected music, beep only from local /player. Footage stays in ignored .local/evidence/ and is deleted after extracting offsets; only numbers enter FEASIBILITY.md. The prohibition applies to bot code capturing meeting media and remains in force.

## Owner direction — YouTube presentation, 2026-09-30

For future YouTube video playback, use Meet's native presentation of the dedicated YouTube player tab instead of feeding video through the synthetic camera. This updates the earlier video exclusion for this specific route. The existing canvas is a diagnostic card, not a working YouTube video route. Keep the bot camera off during presentation; join and obtain normal admission before presenting. Share only the selected player tab.

The owner selected native shared-tab video and audio. During YouTube presentation keep the bot microphone and camera off, keep received meeting audio silenced, and send audio only through Meet's tab presentation. Do not also send a BlackHole microphone copy. This is an explicit exception to the original BlackHole-only audio requirement for this mode; other music adapters retain their existing routing requirements. No media extraction, downloading, recording, or DRM bypass is introduced.

Google documents [tab presentation with audio](https://support.google.com/meet/answer/9308856?co=GENIE.Platform%3DDesktop&hl=en) and recommends it for [higher-quality video and audio](https://workspaceupdates.googleblog.com/2020/04/high-quality-video-audio-meet.html). This is a design direction, not measured feasibility or a guaranteed priority/resolution. Before implementation is qualified, test the selected-tab picker and permissions, headless/windowed behavior, receiver resolution/frame rate, audio/video sync, and absence of echo. Phase 0 reporting still precedes Phase 1.

## Active owner goal — chat playback, 2026-09-30

Implement `/bot <link>` in Meet chat for Spotify, Apple Music and YouTube Music audio, and YouTube tab video/audio presentation. The owner explicitly chose direct Spotify web-player controls with audio through BlackHole into the microphone; no developer app is required by this runtime. Existing PKCE experiments remain separate. Add pause/resume, stop, mute/unmute, help and service-specific command forms. A new link replaces the current source. The owner requested microphone echo cancellation, noise suppression and automatic gain control off; also disable Meet Studio sound for music.

This goal authorizes the minimal chat runtime beyond the original Phase 0-only stopping point. It does not request an extension, queues, games or media recording. Success requires actual Meet-chat command receipt, the correct linked content from all four services, usable receiver audio without echo, working playback controls, and visible/audible YouTube presentation. Local tests alone do not prove that outcome. Current results and usage are in [CHAT_BOT.md](CHAT_BOT.md).
