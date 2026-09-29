import { launchBot } from './bot-launch.js';
import { live, headless, run, emit, blocked, harness, authorize, monitor, receiverAudio, waitForState } from './experiment.js';
await run('E0', async () => {
  if (!live) {
    const bot = await launchBot({ headless });
    try { emit('E0', { launch: bot.observation, result: 'LOCAL_LAUNCH_ONLY', meetingAdmission: null, spotifyPlayback: null, receiverAudibility: null }); }
    finally { await bot.close(); }
    return;
  }
  const h = await harness();
  try {
    if (!h.config.meetingLink || !h.config.spotifyLink) return blocked('E0', ['meetingLink', 'spotifyLink', 'manual logins and receiver']);
    emit('E0', { launch: h.observation, admission: await h.driver.join(h.config.meetingLink) });
    await h.driver.unmute();
    await h.player.goto('https://open.spotify.com/', { waitUntil: 'domcontentloaded' });
    await h.player.evaluate(() => window.companionRoute.check());
    await authorize(h); emit('E0', { device: await h.spotify.selectDevice() });
    await h.spotify.play(h.config.spotifyLink);
    await waitForState(h.spotify, state => state?.is_playing);
    const playback = await monitor(h, 60, 'E0', 'spotify');
    const receiver = await receiverAudio();
    emit('E0', { playback, receiver, modeDecision: receiver.continuousAudio === true && playback.mediaPlayingSamples > 0 && !playback.routeErrors && !playback.botMutedSamples ? headless ? 'HEADLESS_CANDIDATE' : 'WINDOWED_CANDIDATE' : 'UNPROVEN_OR_RETRY_WINDOWED' });
    await h.spotify.pause(); await h.driver.leave();
  } finally { await h.close(); }
});
