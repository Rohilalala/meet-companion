import { live, run, emit, blocked, harness, authorize, waitForState } from './experiment.js';
import { playbackBody } from '../controller/spotify.js';
await run('E6', async () => {
  if (!live) return blocked('E6', ['--live', 'BlackHole', 'Spotify Premium/manual login', 'spotifyClientId', 'spotifyLink playlist/album', 'spotifyTrackLink']);
  const h = await harness();
  try {
    if (!h.config.spotifyLink || !h.config.spotifyTrackLink) return blocked('E6', ['spotifyLink and spotifyTrackLink']);
    const queueUri = playbackBody(h.config.spotifyTrackLink).uris?.[0];
    if (!queueUri) throw new Error('SPOTIFY_QUEUE_REQUIRES_TRACK');
    await h.player.goto('https://open.spotify.com/', { waitUntil: 'domcontentloaded' });
    await h.player.evaluate(() => window.companionRoute.check());
    await authorize(h); emit('E6', { device: await h.spotify.selectDevice() });
    await h.spotify.play(h.config.spotifyLink);
    const original = await waitForState(h.spotify, state => state?.is_playing);
    emit('E6', { operation: 'play', httpStatus: h.spotify.lastMutationStatus, stateConfirmed: true });
    await h.spotify.pause(); await waitForState(h.spotify, state => state && !state.is_playing);
    emit('E6', { operation: 'pause', httpStatus: h.spotify.lastMutationStatus, stateConfirmed: true });
    await h.spotify.play(); await waitForState(h.spotify, state => state?.is_playing);
    emit('E6', { operation: 'resume', httpStatus: h.spotify.lastMutationStatus, stateConfirmed: true });
    await h.spotify.next(); await waitForState(h.spotify, state => state?.item?.id && state.item.id !== original.item?.id);
    emit('E6', { operation: 'next', httpStatus: h.spotify.lastMutationStatus, stateConfirmed: true });
    await h.spotify.setVolume(37); await waitForState(h.spotify, state => state?.device?.volume_percent === 37);
    emit('E6', { operation: 'volume', httpStatus: h.spotify.lastMutationStatus, stateConfirmed: true });
    const count = value => value.queue.filter(item => item.uri === queueUri).length;
    const before = count(await h.spotify.queueState());
    await h.spotify.queue(h.config.spotifyTrackLink);
    let queueConfirmed = false;
    for (let i = 0; i < 20 && !queueConfirmed; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      queueConfirmed = count(await h.spotify.queueState()) > before;
    }
    emit('E6', { operation: 'queue', httpStatus: h.spotify.lastMutationStatus, stateConfirmed: queueConfirmed });
    if (Number.isInteger(original.device?.volume_percent)) await h.spotify.setVolume(original.device.volume_percent);
    await h.spotify.pause();
  } finally { await h.close(); }
});
