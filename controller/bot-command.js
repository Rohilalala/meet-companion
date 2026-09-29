import { playbackBody } from './spotify.js';

export function parseBotCommand(text) {
  if (typeof text !== 'string' || !/^\/bot(?:\s|$)/i.test(text.trim())) return null;
  let input = text.trim().replace(/^\/bot\s*/i, '');
  if (!input) return { action: 'help' };
  if (/^(pause|resume|stop|mute|unmute|help)$/i.test(input)) return { action: input.toLowerCase() };
  if (/^play$/i.test(input)) return { action: 'resume' };
  input = input.replace(/^play\s+/i, '');
  const aliases = { spotify: 'spotify', applemusic: 'applemusic', apple: 'applemusic', ytmusic: 'youtubemusic', 'youtube-music': 'youtubemusic', youtube: 'youtube', yt: 'youtube' };
  const prefix = /^(spotify|applemusic|apple|ytmusic|youtube-music|youtube|yt)\s+/i.exec(input);
  if (prefix) input = input.slice(prefix[0].length);
  const match = /^(?:["“]([^"”\s]+)["”]|'([^'\s]+)'|([^\s]+))$/.exec(input);
  if (!match) throw new Error('BOT_LINK_REQUIRED');
  const command = parseLink(match[1] ?? match[2] ?? match[3]);
  if (prefix && command.service !== aliases[prefix[1].toLowerCase()]) throw new Error('BOT_SERVICE_LINK_MISMATCH');
  return { action: 'play', ...command };
}

function parseLink(link) {
  let url;
  try { url = new URL(link); } catch { throw new Error('BOT_LINK_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('BOT_LINK_INVALID');
  if (url.origin === 'https://open.spotify.com') {
    playbackBody(url.href);
    return { service: 'spotify', mode: 'music', link: url.origin + url.pathname };
  }
  if (url.origin === 'https://music.apple.com' && /^\/[a-z]{2}\/(?:album|song|playlist)\/(?:[^/]+\/)?[\w.-]+\/?$/.test(url.pathname)) {
    const track = url.searchParams.get('i');
    if (track && !/^\d+$/.test(track)) throw new Error('BOT_LINK_INVALID');
    return { service: 'applemusic', mode: 'music', link: url.origin + url.pathname + (track ? '?i=' + track : '') };
  }
  const music = url.origin === 'https://music.youtube.com';
  const video = ['https://www.youtube.com', 'https://youtube.com', 'https://m.youtube.com', 'https://youtu.be'].includes(url.origin);
  if (music || video) {
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : /^\/(?:shorts|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : url.pathname === '/watch' ? url.searchParams.get('v') : null;
    const list = url.searchParams.get('list');
    if (id && !/^[\w-]{11}$/.test(id)) throw new Error('BOT_LINK_INVALID');
    if (!id && !(url.pathname === '/playlist' && list)) throw new Error('BOT_LINK_INVALID');
    if (list && !/^[\w-]+$/.test(list)) throw new Error('BOT_LINK_INVALID');
    const canonical = new URL((music ? 'https://music.youtube.com' : 'https://www.youtube.com') + (id ? '/watch' : '/playlist'));
    if (id) canonical.searchParams.set('v', id);
    if (list) canonical.searchParams.set('list', list);
    return { service: music ? 'youtubemusic' : 'youtube', mode: music ? 'music' : 'presentation', link: canonical.href };
  }
  throw new Error('BOT_SERVICE_UNSUPPORTED');
}

// Commands are serialized so two chat callbacks cannot overlap audio routes.
export class ChatBot {
  constructor({ stop, playMusic, playVideo, pause, resume, mute, help, report }) {
    Object.assign(this, { stop, playMusic, playVideo, pause, resume, mute, help, report });
    this.pending = Promise.resolve(); this.closed = false;
    this.busy = false;
  }
  receive(message) {
    if (this.closed) return this.pending;
    let command;
    try { command = parseBotCommand(message.text); }
    catch (error) { this.report({ result: 'REJECTED', error: error.message }); return this.pending; }
    if (!command) return this.pending;
    this.pending = this.pending.then(async () => {
      if (this.closed) return;
      this.busy = true;
      try {
        if (command.action !== 'play') {
          if (command.action === 'mute' || command.action === 'unmute') await this.mute(command.action === 'mute');
          else await this[command.action]();
          this.report({ result: 'APPLIED', action: command.action });
          return;
        }
        await this.stop();
        if (this.closed) return;
        await (command.mode === 'presentation' ? this.playVideo(command) : this.playMusic(command));
        this.report({ result: 'STARTED', service: command.service, mode: command.mode });
      } catch (error) {
        await this.stop().catch(() => {});
        this.report({ result: 'ERROR', action: command.action, service: command.service, error: /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'PLAYBACK_FAILED', sourceLocations: error.stack?.match(/\/(?:controller|scripts)\/[\w.-]+\.js:\d+:\d+/g) ?? [] });
      } finally { this.busy = false; }
    });
    return this.pending;
  }
  async close() { this.closed = true; await this.pending; await this.stop(); }
}
