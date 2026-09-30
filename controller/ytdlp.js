import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// Anonymous, audio-only, nothing on disk: ignore user config (it could add cookies), never read cookies, no cache dir.
const base = ['--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-cache-dir', '--no-playlist', '--no-warnings'];
// Video: VP9 <=1080p + WebM audio, muxed live by ffmpeg to WebM on stdout (Chrome plays it; nothing touches disk).
const pick = kind => kind === 'video' ? ['-f', 'bv*[height<=1080][ext=webm]+ba[ext=webm]', '--merge-output-format', 'webm'] : ['-f', 'bestaudio'];
export const resolveArgs = (target, kind = 'audio') => [...base, ...pick(kind), '--print', 'id', '--print', 'title', '--print', 'ext', '--print', 'urls', '--', target];
export const streamArgs = (target, kind = 'audio') => [...base, ...pick(kind), '-o', '-', '--', target];
export const target = command => command.search ? 'ytsearch1:' + command.search : command.link;

export function errorCode(text = '', spawnError = null) {
  if (spawnError?.code === 'ENOENT') return 'YTDLP_MISSING';
  if (/HTTP Error 403|confirm you.re not a bot|Sign in to confirm|login required|requires? (?:login|authentication)|members-only/i.test(text)) return 'YOUTUBE_BLOCKED';
  return 'MEDIA_UNAVAILABLE';
}

// Resolves title, container and direct audio URL in memory (validation only; nothing is logged or sent to chat).
export function resolve(value, { kind = 'audio', timeoutMs = 20000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn('yt-dlp', resolveArgs(value, kind), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('MEDIA_UNAVAILABLE')); }, timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => { clearTimeout(timer); fail(new Error(errorCode('', error))); });
    child.on('close', code => {
      clearTimeout(timer);
      // Video prints two URLs (video and audio streams); both are validation only.
      const [id, title, ext, ...urls] = out.trim().split('\n');
      if (code !== 0 || !/^[\w-]{11}$/.test(id ?? '') || !urls.length || urls.length > 2 || urls.some(url => !url.startsWith('https://'))) return fail(new Error(errorCode(err)));
      // Stream the exact resolved video, so a search cannot pick a different result the second time.
      done({ link: 'https://www.youtube.com/watch?v=' + id, title: title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120), ext });
    });
  });
}

// Playback source: yt-dlp writes the audio to stdout only. The caller kills the child when the response closes.
export const stream = (value, kind = 'audio') => spawn('yt-dlp', streamArgs(value, kind), { stdio: ['ignore', 'pipe', 'ignore'] });

export function oneTimeIds(ttlMs = 60000) {
  const ids = new Map();
  return {
    add(value) { const id = randomBytes(16).toString('hex'); ids.set(id, { value, expires: Date.now() + ttlMs }); return id; },
    take(id) { const entry = ids.get(id); ids.delete(id); return entry && entry.expires > Date.now() ? entry.value : null; },
  };
}
