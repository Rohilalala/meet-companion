import { playbackBody } from './spotify.js';

export function parseBotCommand(text) {
  if (typeof text !== 'string') return null;
  let input = text.trim();
  // Discord-style bare commands (/play, /pause, /skip ...) work like /bot play, /bot pause, /bot skip.
  if (/^\/bot(?:\s|$)/i.test(input)) input = input.replace(/^\/bot\s*/i, '');
  else if (/^\/(?:play|pause|resume|stop|skip|next|queue|np|clear|volume|vol|mute|unmute|help|yt|youtube|ytmusic|spotify|apple|applemusic)(?:\s|$)/i.test(input)) input = input.slice(1);
  else return null;
  if (!input) return { action: 'help' };
  if (/^(pause|resume|stop|mute|unmute|help|skip|queue|np|clear)$/i.test(input)) return { action: input.toLowerCase() };
  if (/^next$/i.test(input)) return { action: 'skip' };
  const volume = /^vol(?:ume)?(?:\s+(\d{1,3})%?)?$/i.exec(input);
  if (volume) {
    if (volume[1] === undefined) return { action: 'volume' };
    const level = Number(volume[1]);
    if (level > 100) throw new Error('BOT_VOLUME_INVALID');
    return { action: 'volume', level };
  }
  if (/^play$/i.test(input)) return { action: 'resume' };
  input = input.replace(/^play\s+/i, '');
  const aliases = { spotify: 'spotify', applemusic: 'applemusic', apple: 'applemusic', ytmusic: 'youtube', 'youtube-music': 'youtube', youtube: 'youtube', yt: 'youtube', ytvideo: 'youtube' };
  const prefix = /^(spotify|applemusic|apple|ytmusic|youtube-music|youtube|ytvideo|yt)\s+/i.exec(input);
  const name = prefix?.[1].toLowerCase();
  if (prefix) input = input.slice(prefix[0].length);
  // Plain text (no link) searches YouTube, like Discord's /play <query>.
  if ((!name || aliases[name] === 'youtube') && name !== 'ytvideo' && !/^["“']?https?:/i.test(input)) {
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

const code = error => /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'PLAYBACK_FAILED';
const where = error => error.stack?.match(/\/(?:controller|scripts)\/[\w.-]+\.js:\d+:\d+/g) ?? [];
const hints = { NOTHING_PLAYING: 'Nothing is playing. Try /bot yt <song>.', QUEUE_FULL: 'The queue is full (20).' };
const names = { spotify: 'Spotify link', applemusic: 'Apple Music link', youtube: 'YouTube link' };
// Chat labels never echo links: a resolved title, the search text, or the service name.
const label = command => command.title ?? (command.search ? `"${command.search}"` : command.mode === 'presentation' ? 'YouTube video' : names[command.service]);

// Commands are serialized so two chat callbacks cannot overlap audio routes.
// Queue semantics follow Discord music bots: play queues while something plays, skip advances past broken entries, stop clears.
export class ChatBot {
  constructor({ stop, playMusic, playAudio, playVideo, pause, resume, mute, volume = async () => {}, help, say = async () => {}, prefetch = () => {}, report }) {
    Object.assign(this, { stop, playMusic, playAudio, playVideo, pause, resume, mute, volume, help, say, prefetch, report });
    this.pending = Promise.resolve(); this.closed = false;
    this.busy = false; this.queue = []; this.current = null; this.last = null; this.level = 100;
  }
  receive(message) {
    if (this.closed) return this.pending;
    let command;
    try { command = parseBotCommand(message.text); }
    catch (error) {
      this.report({ result: 'REJECTED', error: error.message });
      return this.run(() => this.say(`Didn't understand that (${error.message}). Try /bot help.`).catch(() => {}));
    }
    if (!command) return this.pending;
    return this.run(() => this.apply(command));
  }
  // The runtime calls this when the current track has ended.
  advance() { return this.run(() => this.current ? this.next() : undefined); }
  run(task) {
    this.pending = this.pending.then(async () => {
      if (this.closed) return;
      this.busy = true;
      try { await task(); } finally { this.busy = false; }
    });
    return this.pending;
  }
  async apply(command) {
    const { action } = command;
    try {
      if (action === 'play') {
        if (!this.current) return await this.next(command);
        // ponytail: fixed cap; make it configurable if 20 is ever too small.
        if (this.queue.length >= 20) throw new Error('QUEUE_FULL');
        this.queue.push(command);
        if (this.queue.length === 1) this.prefetch(command);
        this.report({ result: 'QUEUED', service: command.service, mode: command.mode, position: this.queue.length });
        return await this.say(`Queued #${this.queue.length}: ${label(command)}`);
      }
      if (action === 'skip') return await this.next();
      // After stop, a bare play/resume restarts the last track from the beginning.
      if (action === 'resume' && !this.current && this.last) return await this.next(this.last);
      if (action === 'stop') { this.last = this.current ?? this.last; this.queue = []; this.current = null; await this.stop(); }
      else if (action === 'volume') {
        if (command.level !== undefined) { await this.volume(command.level); this.level = command.level; }
        await this.say(`Volume: ${this.level}%`);
      }
      else if (action === 'clear') { this.queue = []; await this.say('Queue cleared.'); }
      else if (action === 'queue') await this.say(this.queue.length ? 'Queue: ' + this.queue.slice(0, 10).map((entry, i) => `${i + 1}. ${label(entry)}`).join(' · ') + (this.queue.length > 10 ? ` · +${this.queue.length - 10} more` : '') : 'Queue is empty.');
      else if (action === 'np') await this.say(this.current ? `Now playing: ${label(this.current)}` : 'Nothing is playing.');
      else if (action === 'mute' || action === 'unmute') {
        await this.mute(action === 'mute');
        if (action === 'unmute' && !this.current) await this.say('The mic turns on when something plays. Try /bot yt <song>.');
      }
      else await this[action]();
      this.report({ result: 'APPLIED', action });
    } catch (error) {
      // A failed control command reports only; it no longer stops healthy playback.
      this.report({ result: 'ERROR', action, service: command.service, error: code(error), sourceLocations: where(error) });
      await this.say(hints[code(error)] ?? `Couldn't ${action}: ${code(error)}`).catch(() => {});
    }
  }
  // Starts `first`, or the head of the queue; broken entries are reported and skipped.
  async next(first) {
    let command = first ?? this.queue.shift();
    await this.stop(); this.current = null;
    while (command && !this.closed) {
      this.prefetch(this.queue[0]);
      try {
        const title = await ({ presentation: this.playVideo, audio: this.playAudio }[command.mode] ?? this.playMusic).call(this, command);
        this.current = { ...command, title: title ?? command.title };
        this.report({ result: 'STARTED', service: command.service, mode: command.mode });
        return;
      } catch (error) {
        await this.stop().catch(() => {});
        this.report({ result: 'ERROR', action: 'play', service: command.service, error: code(error), sourceLocations: where(error) });
        await this.say(`Couldn't play ${label(command)}: ${code(error)}`).catch(() => {});
        command = this.queue.shift();
      }
    }
    if (!first && !this.closed) await this.say('Queue finished.');
  }
  async close() { this.closed = true; await this.pending; this.queue = []; await this.stop(); }
}
