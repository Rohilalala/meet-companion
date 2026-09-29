import { play as spotifyPlay } from './spotify.js';
import { play as applePlay } from './applemusic.js';
import { play as musicPlay } from './youtubemusic.js';
import * as youtube from './youtube.js';
import * as ytdlp from './ytdlp.js';

export function playback(h) {
  const adapters = { spotify: spotifyPlay, applemusic: applePlay, youtubemusic: musicPlay };
  let active = null, paused = false, muted = false;
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
    async help() { await h.driver.sendChat('Meet Companion: /bot <link> or /bot play <link>; /bot spotify <link>, /bot applemusic <link>, /bot youtube <link or search>, /bot yt <search>, /bot ytvideo <link> (video share); /bot pause, resume, stop, mute, unmute, help. A new link replaces playback.'); },
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
      try {
        await startMusic(command, async () => {
          const source = ytdlp.target(command), resolved = await ytdlp.resolve(source);
          title = resolved.title;
          // Direct googlevideo URL first; if it does not start within 10 s, pipe yt-dlp stdout through a one-time local URL.
          let timer;
          const direct = Promise.race([load(resolved.url), new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('DIRECT_TIMEOUT')), 10000); })]);
          try { await direct; } catch { await load(h.server.origin + '/stream/' + h.server.streamOnce(source, resolved.ext)); } finally { clearTimeout(timer); }
        });
      } catch (error) {
        await h.driver.sendChat('Meet Companion: ' + (/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'PLAYBACK_FAILED')).catch(() => {});
        throw error;
      }
      await h.driver.sendChat('Playing: ' + title);
    },
    async playVideo(command) {
      await youtube.prepare(h.player, command.link, h.presentationTitle);
      await h.driver.present();
      await youtube.play(h.player);
      await playing(command);
      if (!(await h.driver.muted())) throw new Error('PRESENTATION_MIC_NOT_MUTED');
      active = command;
      await h.meet.evaluate(muted => window.companionPresentation.mute(muted), muted);
    },
  };
}
