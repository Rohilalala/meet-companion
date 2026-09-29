import { live, run, emit, blocked, harness, authorize, monitor, receiverAudio, errorCode } from './experiment.js';
import { play as applePlay } from '../controller/applemusic.js';
import { play as youtubePlay } from '../controller/youtubemusic.js';
await run('E3', async () => {
  if (!live) return blocked('E3', ['--live', 'BlackHole', 'meetingLink', 'service logins/links', 'second receiver with WebRTC statistics open']);
  const h = await harness();
  try {
    if (!h.config.meetingLink) return blocked('E3', ['meetingLink']);
    emit('E3', { admission: await h.driver.join(h.config.meetingLink) }); await h.driver.unmute();
    let audible = 0;
    for (const source of ['local', ...(h.config.localFile ? ['local-file'] : []), 'spotify', 'applemusic', 'youtubemusic']) {
      try {
        if (source === 'local' || source === 'local-file') {
          await h.player.goto(h.server.origin + '/player');
          if (source === 'local-file') await h.player.evaluate(id => window.companionPlayer.file(id), await h.server.localFile(h.config.localFile));
          else await h.player.evaluate(() => window.companionPlayer.tone());
        } else {
          const link = h.config[source + 'Link'];
          if (!link) { blocked('E3', [source + 'Link']); continue; }
          if (source === 'spotify') {
            await h.player.goto('https://open.spotify.com/'); await authorize(h); await h.spotify.selectDevice(); await h.spotify.play(link);
          } else await (source === 'applemusic' ? applePlay : youtubePlay)(h.player, link);
        }
        const playback = await monitor(h, 60, 'E3', source), receiver = await receiverAudio();
        if (receiver.continuousAudio === true) audible++;
        emit('E3', { source, playback, receiver, receiverWebRTCStats: 'Enter reviewed statistics in FEASIBILITY.md; do not enable audio recording.' });
        if (source === 'spotify') await h.spotify.pause();
        await h.player.goto('about:blank');
      } catch (error) { emit('E3', { source, result: 'SOURCE_UNQUALIFIED', error: errorCode(error) }); await h.player.goto('about:blank'); }
    }
    emit('E3', { audibleSources: audible, gate: audible ? 'REVIEW_PER_SOURCE_EVIDENCE' : 'STOP_NO_SOURCE_PROVEN' });
    await h.driver.leave();
  } finally { await h.close(); }
});
