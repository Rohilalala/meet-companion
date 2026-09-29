import { playbackBody } from './spotify.js';

export function parseBotCommand(text) {
  if (typeof text !== 'string' || !/^\/bot(?:\s|$)/i.test(text.trim())) return null;
  let input = text.trim().replace(/^\/bot\s*/i, '');
  if (!input) return { action: 'help' };
  if (/^(pause|resume|stop|mute|unmute|help)$/i.test(input)) return { action: input.toLowerCase() };
  if (/^play$/i.test(input)) return { action: 'resume' };
  input = input.replace(/^play\s+/i, '');
  const aliases = { spotify: 'spotify', applemusic: 'applemusic', apple: 'applemusic', ytmusic: 'youtube', 'youtube-music': 'youtube', youtube: 'youtube', yt: 'youtube', ytvideo: 'youtube' };
  const prefix = /^(spotify|applemusic|apple|ytmusic|youtube-music|youtube|ytvideo|yt)\s+/i.exec(input);
  const name = prefix?.[1].toLowerCase();
  if (prefix) input = input.slice(prefix[0].length);
  if (aliases[name] === 'youtube' && name !== 'ytvideo' && !/^["“']?https?:/i.test(input)) {
    if (input.length > 200 || /[\u0000-\u001f\u007f]/.test(input)) throw new Error('BOT_SEARCH_INVALID');
    return { action: 'play', service: 'youtube', mode: 'audio', search: input };
  }
  const match = /^(?:["“]([^"”\s]+)["”]|'([^'\s]+)'|([^\s]+))$/.exec(input);
  if (!match) throw new Error('BOT_LINK_REQUIRED');
  const command = parseLink(match[1] ?? match[2] ?? match[3], name === 'ytvideo');
  if (prefix && command.service !== aliases[name]) throw new Error('BOT_SERVICE_LINK_MISMATCH');
  return { action: 'play', ...command };
}

function parseLink(link, video) {
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
  const youtube = ['https://www.youtube.com', 'https://youtube.com', 'https://m.youtube.com', 'https://youtu.be'].includes(url.origin);
  if (music || youtube) {
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : /^\/(?:shorts|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : url.pathname === '/watch' ? url.searchParams.get('v') : null;
    const list = url.searchParams.get('list');
    if (id && !/^[\w-]{11}$/.test(id)) throw new Error('BOT_LINK_INVALID');
    if (!id && !(url.pathname === '/playlist' && list)) throw new Error('BOT_LINK_INVALID');
    if (list && !/^[\w-]+$/.test(list)) throw new Error('BOT_LINK_INVALID');
    // Audio goes through yt-dlp (one video only); ytvideo keeps native tab sharing.
    if (!video) {
      if (!id) throw new Error('BOT_PLAYLIST_UNSUPPORTED');
      return { service: 'youtube', mode: 'audio', link: 'https://www.youtube.com/watch?v=' + id };
    }
    const canonical = new URL('https://www.youtube.com' + (id ? '/watch' : '/playlist'));
    if (id) canonical.searchParams.set('v', id);
    if (list) canonical.searchParams.set('list', list);
    return { service: 'youtube', mode: 'presentation', link: canonical.href };
  }
  throw new Error('BOT_SERVICE_UNSUPPORTED');
}

// Commands are serialized so two chat callbacks cannot overlap audio routes.
export class ChatBot {
  constructor({ stop, playMusic, playAudio, playVideo, pause, resume, mute, help, report }) {
    Object.assign(this, { stop, playMusic, playAudio, playVideo, pause, resume, mute, help, report });
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
        await ({ presentation: this.playVideo, audio: this.playAudio }[command.mode] ?? this.playMusic).call(this, command);
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
