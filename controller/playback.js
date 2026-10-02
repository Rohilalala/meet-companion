import { play as spotifyPlay } from './spotify.js';
import { play as applePlay } from './applemusic.js';
import { play as musicPlay } from './youtubemusic.js';
import * as youtube from './youtube.js';
import * as ytdlp from './ytdlp.js';

export function playback(h) {
  const media = h.media ?? ytdlp;
  const adapters = { spotify: spotifyPlay, applemusic: applePlay, youtubemusic: musicPlay };
  let active = null, paused = false, muted = false, level = 1;
  // The BlackHole mic carries everything except the YouTube web-player share (ytweb), which uses tab audio.
  // yt-dlp video mutes its tab audio: Meet's presentation audio sounded much worse than the mic.
  const micCarries = command => command.mode !== 'presentation' || command.dlp;
  async function stop() {
    // Close the microphone before changing or clearing the player source. A failed mic-off must not leave the
    // stream running: still kill yt-dlp and reset the player, then report the failure.
    let failure;
    await h.driver.disableMedia().catch(error => { failure = error; });
    h.server.stopStreams();
    try {
      await h.driver.stopPresenting(); // If this fails, do not navigate: the share would show the bare player page.
      await h.player.goto(h.server.origin + '/player', { waitUntil: 'domcontentloaded' });
    } finally { active = null; paused = false; }
    if (failure) throw failure;
  }
  async function playing(command) {
    const detachedOnly = command.service === 'spotify';
    await h.player.waitForFunction(detachedOnly => window.companionRoute.positions({ detachedOnly }).some(time => time > 0), detachedOnly, { timeout: 20000 }).catch(() => { throw new Error('PLAYBACK_NOT_STARTED'); });
    await h.player.evaluate(() => window.companionRoute.check());
  }
  async function startMusic(command, start) {
    await h.driver.configureMusicAudio();
    await start();
    await playing(command);
    await h.player.evaluate(level => window.companionRoute.volume(level), level);
    const raw = await h.meet.evaluate(() => {
      const settings = window.meetCompanion.inputSettings();
      return settings.length > 0 && settings.every(input => input.echoCancellation === false && input.noiseSuppression === false && input.autoGainControl === false);
    });
    if (!raw) throw new Error('MIC_PROCESSING_UNVERIFIED');
    active = command;
    if (!muted) await h.driver.unmute();
  }
  const load = src => h.player.evaluate(src => window.companionPlayer.url(src), src);
  return {
    stop,
    say: text => h.driver.sendChat(text),
    async volume(percent) {
      level = percent / 100;
      if (active) await h.player.evaluate(level => window.companionRoute.volume(level), level);
    },
    // Resolve the next YouTube entry ahead of time (title for /bot queue, faster start, early failure).
    prefetch(command) {
      if (!(command?.mode === 'audio' || command?.dlp) || command.resolved) return;
      command.resolved = media.resolve(ytdlp.target(command), { kind: command.dlp ? 'video' : 'audio' });
      command.resolved.then(resolved => { command.title = resolved.title; }, () => {});
    },
    async help() { await h.driver.sendChat('Meet Companion: /play <song, search or link> (queues while something plays), /pause, /resume, /skip, /queue, /np, /clear, /volume <0-100>, /mute, /unmute, /stop (clears the queue). Owner PIN needed: /clear <pin>, /leave <pin>. /video <link or search> shares a YouTube video. /bot <command> also works.'); },
    async pause() {
      if (!active) throw new Error('NOTHING_PLAYING');
      if (paused) return;
      await h.driver.disableMedia();
      await h.meet.evaluate(() => window.companionPresentation.mute(true));
      await h.player.evaluate(detachedOnly => window.companionRoute.pause({ detachedOnly }), active.service === 'spotify');
      paused = true;
    },
    async resume() {
      if (!active) throw new Error('NOTHING_PLAYING');
      if (!paused) return;
      await h.player.evaluate(() => window.companionRoute.resume());
      await playing(active); paused = false;
      if (!muted && micCarries(active)) await h.driver.unmute();
      if (active.mode === 'presentation') await h.meet.evaluate(value => window.companionPresentation.mute(value), muted || !!active.dlp);
    },
    async mute(value) {
      muted = value;
      if (value || paused || !active || !micCarries(active)) await h.driver.disableMedia();
      else await h.driver.unmute();
      await h.meet.evaluate(value => window.companionPresentation.mute(value), value || paused || !!active?.dlp);
    },
    playMusic: command => startMusic(command, () => adapters[command.service](h.player, command.link)),
    async playAudio(command) {
      let title;
      await startMusic(command, async () => {
          const resolved = await (command.resolved ?? media.resolve(ytdlp.target(command)));
          title = resolved.title;
          // Always the local no-store stream: Chrome caches direct googlevideo audio in the bot profile, even with DevTools cache disabled.
          await load(h.server.origin + '/stream/' + h.server.streamOnce(resolved.link, resolved.ext));
      });
      // Best-effort: a chat failure must not stop music that is already playing.
      await h.driver.sendChat('Playing: ' + title).catch(() => {});
      return title;
    },
    async playVideo(command) {
      let title;
      if (command.dlp) {
        await h.driver.configureMusicAudio();
        // yt-dlp video in the bot's own /player page (no YouTube page), loaded paused so the tab is presented first.
        const resolved = await (command.resolved ?? media.resolve(ytdlp.target(command), { kind: 'video' }));
        title = resolved.title;
        await h.player.setViewportSize({ width: 1920, height: 1080 });
        const src = h.server.origin + '/stream/' + h.server.streamOnce(resolved.link, resolved.ext, 'video');
        await h.player.evaluate(({ src, title }) => window.companionPlayer.video(src, title), { src, title: h.presentationTitle });
      } else await youtube.prepare(h.player, command.link, h.presentationTitle);
      await h.driver.present({ audio: !command.dlp });
      if (command.dlp) await h.player.evaluate(() => window.companionPlayer.start());
      else await youtube.play(h.player);
      await playing(command);
      await h.player.evaluate(level => window.companionRoute.volume(level), level);
      if (command.dlp) {
        await h.meet.evaluate(() => window.companionPresentation.mute(true));
        active = command;
        if (!muted) await h.driver.unmute();
      } else {
        if (!(await h.driver.muted())) throw new Error('PRESENTATION_MIC_NOT_MUTED');
        active = command;
        await h.meet.evaluate(muted => window.companionPresentation.mute(muted), muted);
      }
      if (title) await h.driver.sendChat('Playing: ' + title).catch(() => {});
      return title;
    },
  };
}
