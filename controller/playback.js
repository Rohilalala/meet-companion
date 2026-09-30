import { play as spotifyPlay } from './spotify.js';
import { play as applePlay } from './applemusic.js';
import { play as musicPlay } from './youtubemusic.js';
import * as youtube from './youtube.js';
import * as ytdlp from './ytdlp.js';

export function playback(h) {
  const adapters = { spotify: spotifyPlay, applemusic: applePlay, youtubemusic: musicPlay };
  let active = null, paused = false, muted = false, level = 1;
  async function stop() {
    // Close the microphone before changing or clearing the player source.
    await h.driver.disableMedia();
    await h.driver.stopPresenting();
    h.server.stopStreams();
    await h.player.goto(h.server.origin + '/player', { waitUntil: 'domcontentloaded' });
    active = null; paused = false;
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
      if (command?.mode !== 'audio' || command.resolved) return;
      command.resolved = ytdlp.resolve(ytdlp.target(command));
      command.resolved.then(resolved => { command.title = resolved.title; }, () => {});
    },
    async help() { await h.driver.sendChat('Meet Companion: /bot <link> or /bot play <link>; /bot spotify <link>, /bot applemusic <link>, /bot youtube <link or search>, /bot yt <search>, /bot ytvideo <link> (video share); /bot skip, queue, np, clear, volume <0-100>, pause, resume, stop, mute, unmute, help. Links queue while something plays; stop clears the queue.'); },
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
      if (!muted && active.mode === 'music') await h.driver.unmute();
      if (active.mode === 'presentation') await h.meet.evaluate(muted => window.companionPresentation.mute(muted), muted);
    },
    async mute(value) {
      muted = value;
      if (value || paused || !active || active.mode === 'presentation') await h.driver.disableMedia();
      else await h.driver.unmute();
      await h.meet.evaluate(value => window.companionPresentation.mute(value), value || paused);
    },
    playMusic: command => startMusic(command, () => adapters[command.service](h.player, command.link)),
    async playAudio(command) {
      let title;
      await startMusic(command, async () => {
          const resolved = await (command.resolved ?? ytdlp.resolve(ytdlp.target(command)));
          title = resolved.title;
          // Always the local no-store stream: Chrome caches direct googlevideo audio in the bot profile, even with DevTools cache disabled.
          await load(h.server.origin + '/stream/' + h.server.streamOnce(resolved.link, resolved.ext));
      });
      // Best-effort: a chat failure must not stop music that is already playing.
      await h.driver.sendChat('Playing: ' + title).catch(() => {});
      return title;
    },
    async playVideo(command) {
      await youtube.prepare(h.player, command.link, h.presentationTitle);
      await h.driver.present();
      await youtube.play(h.player);
      await playing(command);
      await h.player.evaluate(level => window.companionRoute.volume(level), level);
      if (!(await h.driver.muted())) throw new Error('PRESENTATION_MIC_NOT_MUTED');
      active = command;
      await h.meet.evaluate(muted => window.companionPresentation.mute(muted), muted);
    },
  };
}
