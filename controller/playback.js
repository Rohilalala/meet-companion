import { play as spotifyPlay } from './spotify.js';
import { play as applePlay } from './applemusic.js';
import { play as musicPlay } from './youtubemusic.js';
import * as youtube from './youtube.js';

export function playback(h) {
  const adapters = { spotify: spotifyPlay, applemusic: applePlay, youtubemusic: musicPlay };
  let active = null, paused = false, muted = false;
  async function stop() {
    // Close the microphone before changing or clearing the player source.
    await h.driver.disableMedia();
    await h.driver.stopPresenting();
    await h.player.goto(h.server.origin + '/player', { waitUntil: 'domcontentloaded' });
    active = null; paused = false;
  }
  async function playing(command) {
    const detachedOnly = command.service === 'spotify';
    await h.player.waitForFunction(detachedOnly => window.companionRoute.positions({ detachedOnly }).some(time => time > 0), detachedOnly, { timeout: 20000 }).catch(() => { throw new Error('PLAYBACK_NOT_STARTED'); });
    await h.player.evaluate(() => window.companionRoute.check());
  }
  return {
    stop,
    async help() { await h.driver.sendChat('Meet Companion: /bot <link> or /bot play <link>; /bot spotify <link>, /bot applemusic <link>, /bot ytmusic <link>, /bot youtube <link>; /bot pause, resume, stop, mute, unmute, help. A new link replaces playback.'); },
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
    async playMusic(command) {
      await h.driver.configureMusicAudio();
      await adapters[command.service](h.player, command.link);
      await playing(command);
      const raw = await h.meet.evaluate(() => {
        const settings = window.meetCompanion.inputSettings();
        return settings.length > 0 && settings.every(input => input.echoCancellation === false && input.noiseSuppression === false && input.autoGainControl === false);
      });
      if (!raw) throw new Error('MIC_PROCESSING_UNVERIFIED');
      active = command;
      if (!muted) await h.driver.unmute();
    },    async playVideo(command) {
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
