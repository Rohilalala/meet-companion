import { live, run, emit, blocked, harness, settledSession } from './experiment.js';
import { session as spotifySession } from '../controller/spotify.js';
import { session as appleSession } from '../controller/applemusic.js';
import { session as youtubeSession } from '../controller/youtubemusic.js';
await run('E2', async () => {
  if (!live) return blocked('E2', ['--live', 'all four accounts manually signed in with bot:login']);
  for (let cycle = 1; cycle <= 5; cycle++) {
    const h = await harness({ audio: false });
    try {
      await h.meet.goto('https://meet.google.com/', { waitUntil: 'domcontentloaded' });
      const google = await settledSession(() => h.driver.googleSession());
      const results = { google };
      for (const [name, origin, inspect] of [['spotify', 'https://open.spotify.com/', spotifySession], ['applemusic', 'https://music.apple.com/', appleSession], ['youtubemusic', 'https://music.youtube.com/', youtubeSession]]) {
        await h.player.goto(origin, { waitUntil: 'domcontentloaded' });
        results[name] = await settledSession(() => inspect(h.player));
      }
      emit('E2', { cycle, sessions: results });
      if (google !== 'signed_in') { emit('E2', { gate: 'STOP_GOOGLE_SESSION_UNPROVEN', cycle }); break; }
    } finally { await h.close(); }
  }
});
