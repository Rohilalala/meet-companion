import { randomInt } from 'node:crypto';
import { playbackBody } from './spotify.js';

// Removing the bot and clearing the queue need the owner PIN (shown on the control page / in the bot's output).
const ownerOnly = new Set(['leave', 'clear']);

export function parseBotCommand(text) {
  if (typeof text !== 'string') return null;
  let input = text.trim();
  // Discord-style bare commands (/play, /pause, /skip ...) work like /bot play, /bot pause, /bot skip.
  if (/^\/bot(?:\s|$)/i.test(input)) input = input.replace(/^\/bot\s*/i, '');
  else if (/^\/(?:play|pause|resume|stop|skip|next|queue|np|clear|leave|exit|volume|vol|mute|unmute|help|yt|youtube|youtube-music|ytmusic|video|ytvideo|ytweb|spotify|apple|applemusic)(?:\s|$)/i.test(input)) input = input.slice(1);
  else return null;
  if (!input) return { action: 'help' };
  // A control word must stand alone (leave/exit/clear may carry the owner PIN). With extra text it is rejected:
  // neither run ("/bot leave the door open" must not eject the bot) nor searched ("/bot exit" once played a film).
  const control = /^(pause|resume|stop|mute|unmute|help|skip|next|queue|np|clear|leave|exit)(?:\s+(.*))?$/i.exec(input);
  if (control) {
    const word = control[1].toLowerCase(), action = { next: 'skip', exit: 'leave' }[word] ?? word, extra = control[2];
    if (extra === undefined) return { action };
    if (ownerOnly.has(action) && /^\d{4}$/.test(extra)) return { action, pin: extra };
    throw new Error('BOT_COMMAND_EXTRA_TEXT');
  }
  const volume = /^vol(?:ume)?(?:\s+(\d{1,3})%?)?$/i.exec(input);
  if (volume) {
    if (volume[1] === undefined) return { action: 'volume' };
    const level = Number(volume[1]);
    if (level > 100) throw new Error('BOT_VOLUME_INVALID');
    return { action: 'volume', level };
  }
  if (/^play$/i.test(input)) return { action: 'resume' };
  input = input.replace(/^play\s+/i, '');
  const aliases = { spotify: 'spotify', applemusic: 'applemusic', apple: 'applemusic', ytmusic: 'youtubemusic', 'youtube-music': 'youtubemusic', youtube: 'youtube', yt: 'youtube', ytvideo: 'youtube', video: 'youtube', ytweb: 'youtube' };
  const prefix = /^(spotify|applemusic|apple|ytmusic|youtube-music|youtube|ytvideo|video|ytweb|yt)\s+/i.exec(input);
  const name = prefix?.[1].toLowerCase();
  if (prefix) input = input.slice(prefix[0].length);
  // YouTube kinds: yt-dlp audio (default), yt-dlp video presented as a tab (video/ytvideo), or the YouTube web player (ytweb).
  const kind = name === 'ytweb' ? 'web' : name === 'ytvideo' || name === 'video' ? 'video' : 'audio';
  // Plain text (no link) searches YouTube, like Discord's /play <query>.
  if ((!name || aliases[name] === 'youtube') && kind !== 'web' && !/^["“']?https?:/i.test(input)) {
    if (input.length > 200 || /[\u0000-\u001f\u007f]/.test(input)) throw new Error('BOT_SEARCH_INVALID');
    return { action: 'play', service: 'youtube', ...(kind === 'video' ? { mode: 'presentation', dlp: true } : { mode: 'audio' }), search: input };
  }
  const match = /^(?:["“]([^"”\s]+)["”]|'([^'\s]+)'|([^\s]+))$/.exec(input);
  if (!match) throw new Error('BOT_LINK_REQUIRED');
  const command = parseLink(match[1] ?? match[2] ?? match[3], kind);
  if (prefix && command.service !== aliases[name]) throw new Error('BOT_SERVICE_LINK_MISMATCH');
  return { action: 'play', ...command };
}

function parseLink(link, kind = 'audio') {
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
    if (music && kind === 'audio') {
      if (!id) throw new Error('BOT_PLAYLIST_UNSUPPORTED');
      return { service: 'youtubemusic', mode: 'music', link: 'https://music.youtube.com/watch?v=' + id };
    }
    // yt-dlp audio and video take one video only; ytweb keeps the YouTube web-player tab share.
    if (kind !== 'web') {
      if (!id) throw new Error('BOT_PLAYLIST_UNSUPPORTED');
      const link = 'https://www.youtube.com/watch?v=' + id;
      return kind === 'video' ? { service: 'youtube', mode: 'presentation', dlp: true, link } : { service: 'youtube', mode: 'audio', link };
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
const hints = { NOTHING_PLAYING: 'Nothing is playing. Try /bot yt <song>.', QUEUE_FULL: 'The queue is full (20).', OWNER_PIN_REQUIRED: 'That needs the owner PIN, e.g. /leave 1234. The PIN is on the control page.' };
const names = { spotify: 'Spotify link', applemusic: 'Apple Music link', youtubemusic: 'YouTube Music link', youtube: 'YouTube link' };
// Chat labels never echo links: a resolved title, the search text, or the service name.
const label = command => command.title ?? (command.search ? `"${command.search}"` : command.mode === 'presentation' ? 'YouTube video' : names[command.service]);

// Commands are serialized so two chat callbacks cannot overlap audio routes.
// Queue semantics follow Discord music bots: play queues while something plays, skip advances past broken entries, stop clears.
export class ChatBot {
  constructor({ stop, playMusic, playAudio, playVideo, pause, resume, mute, volume = async () => {}, help, say = async () => {}, prefetch = () => {}, leave = async () => {}, report }) {
    Object.assign(this, { stop, playMusic, playAudio, playVideo, pause, resume, mute, volume, help, say, prefetch, leave, report });
    this.pending = Promise.resolve(); this.closed = false;
    this.busy = false; this.queue = []; this.current = null; this.last = null; this.level = 100;
    this.pin = null;
  }
  // One-time owner PIN: a new one after every use, so a PIN seen in chat is already dead.
  announcePin() { this.pin = String(randomInt(1000, 10000)); this.report({ state: 'PIN', pin: this.pin }); }
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
  // `expected` is the track that ended: if a command already replaced it, do nothing.
  advance(expected = this.current) { return this.run(() => this.current && this.current === expected ? this.next() : undefined); }
  run(task) {
    this.pending = this.pending.then(async () => {
      if (this.closed) return;
      this.busy = true;
      // Nothing may reject this chain: one failure (a chat reply, a stop step) would silently drop every later command.
      try { await task(); }
      catch (error) { this.report({ result: 'ERROR', action: 'internal', error: code(error), sourceLocations: where(error) }); }
      finally { this.busy = false; }
    });
    return this.pending;
  }
  async apply(command) {
    const { action } = command;
    try {
      if (ownerOnly.has(action)) {
        if (!this.pin || command.pin !== this.pin) throw new Error('OWNER_PIN_REQUIRED');
        this.announcePin();
      }
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
      if (action === 'leave') { await this.say('Leaving the call. Bye!').catch(() => {}); await this.leave(); this.report({ result: 'APPLIED', action }); return; }
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
    // If stopping fails, keep the entry in the queue rather than losing it.
    try { await this.stop(); } catch (error) { if (!first && command) this.queue.unshift(command); throw error; }
    this.current = null;
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
    if (!first && !this.closed) await this.say('Queue finished.').catch(() => {});
  }
  async close() { this.closed = true; await this.pending; this.queue = []; await this.stop(); }
}
