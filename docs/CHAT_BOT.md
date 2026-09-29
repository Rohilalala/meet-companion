# Meet chat bot

The owner-authorized runtime is under live qualification. It has not yet passed the full four-service acceptance check.

## Start

Use Node 22, the dedicated manually signed-in Chrome profile, BlackHole, and the saved meeting in ignored `config.local.json`. Close the manual login browser before starting.

```sh
nvm use
npm run bot -- --live
```

Chrome joins with microphone/camera off and opens its own chat panel once. A JavaScript observer reads new messages in memory. Existing chat history is ignored on startup. The owner's browser is not controlled. Ctrl-C closes the bot. The bot does not automatically rejoin after removal or meeting end.

## Commands

| Command | Behavior |
| --- | --- |
| `/bot <link>` | Infer the service and replace current playback |
| `/bot play <link>` | Same as above |
| `/bot spotify <link>` | Play the Spotify link in its web player |
| `/bot applemusic <link>` | Play an Apple Music link |
| `/bot ytmusic <link>` | Play a YouTube Music link as audio |
| `/bot youtube <link>` | Present a YouTube video tab with sound |
| `/bot pause` | Pause playback and silence outgoing audio |
| `/bot resume` or `/bot play` | Resume the paused source |
| `/bot mute` | Silence outgoing music or presentation audio |
| `/bot unmute` | Restore outgoing audio; does not resume paused playback |
| `/bot stop` | Stop playback/presentation, clear the player, mic/camera off |
| `/bot help` or `/bot` | Send the command list to Meet chat |

Links may be quoted. `/bot play spotify <link>` also works. A service prefix must match its link. Commands from any participant are accepted; no administrative clear/leave commands are exposed. Bodies, sender identities and links are not written to logs.

## Audio and video

Music plays in the official service tab. Its output goes to BlackHole; the bot microphone uses that exact input. Before unmuting, the runtime disables available Meet Studio sound/noise cancellation switches and verifies echoCancellation=false, noiseSuppression=false and autoGainControl=false on active input tracks. Later constraint changes must retain those values. Meet still encodes/transports the audio; this is not lossless PCM delivery.

YouTube video uses Meet's native tab presentation. The player is set to 1920 × 1080 and enters fullscreen; its bounds must fill the viewport before sharing. Chrome selects a uniquely titled player tab; the wrapper refuses a non-tab surface or a missing audio track. The camera and microphone remain off. Shared-tab local playback is suppressed. No recording, downloading or service-media extraction is used. BlackHole playback is not simultaneously transmitted through the microphone during presentation. Stop/replacement uses Meet's Stop presenting UI and verifies it clears before changing the player page.

## Verification status

| Requirement | Evidence / remaining work |
| --- | --- |
| Parsing and serialized playback | Twelve network-free tests pass, including explicit commands, detached audio controls, repeated pause, overlapping sink requests, and refusal to navigate before presentation stops |
| Native tab sharing | Local branded headless Chrome passed: browser surface, one audio track, local suppression true, synthetic tone RMS about 0.0649. YouTube fullscreen tab stayed active for 16 seconds with no route errors after serialized sink selection. Live presentation started; final receiver confirmation pending |
| Chat | New Meet message markup observed; reader updated for `[data-message-id] [jsname="dTKtvb"]`; compact UI chat opens through More options. Sender attribution can be unknown; E5 is not passed |
| Spotify | Signed-in session and requested-title match verified after scoping Play to the action bar. Receiver first reported a cutoff, then reported “Stays audible” after a retry. Duration, sound quality and no-echo qualification remain pending |
| Raw music input | Studio sound was disabled in live Meet; active inputs reported 48 kHz, two channels, echo cancellation/noise suppression/automatic gain control all false. These settings do not independently prove receiver quality |
| Apple Music | Session appeared signed out; full-song playback requires manual account setup/verification |
| YouTube Music | Session state unknown; playback pending |
| Pause/resume/mute/stop/help | Implemented. Spotify uses a detached VIDEO element for its song, separate from the visible eight-second visual. Registry controls passed two real-player pause-twice/resume cycles with song progress verified. Meet Stop presenting cleared the live UI. Remaining live command/receiver acceptance pending |

Run `npm run check`, `npm run verify:offline`, `npm run verify:meet-silence`, and `npm run verify:presentation`. The last two are explicit localhost integration tests using synthetic media. Do not run another launcher against a profile in use. Keep the goal active until all four service paths and controls are verified from Meet and a receiver.
