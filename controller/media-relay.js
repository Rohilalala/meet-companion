import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import * as ytdlp from './ytdlp.js';

const tokenValid = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
export function validTarget(value) {
  if (typeof value !== 'string') return false;
  if (/^ytsearch1:[^\r\n\0]{1,200}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.origin === 'https://www.youtube.com' && url.pathname === '/watch' &&
      /^[\w-]{11}$/.test(url.searchParams.get('v') ?? '') &&
      [...url.searchParams.keys()].every(key => key === 'v') && !url.username && !url.password;
  } catch { return false; }
}

// A Mac on a working network runs yt-dlp locally. Only the SSH reverse tunnel
// exposes this loopback listener to the AWS bot; no media is saved to disk.
export async function startMediaWorker({ port = 3212, token } = {}) {
  if (!tokenValid(token)) throw new Error('MEDIA_WORKER_CONFIG_INVALID');
  const expected = Buffer.from(`Bearer ${token}`), children = new Set();
  const server = createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin ||
        supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(403, { error: 'AUTH_REFUSED' });
    if (request.method !== 'POST' || !['/resolve', '/stream'].includes(request.url)) return send(404, { error: 'NOT_FOUND' });
    try {
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > 4096) return send(413, { error: 'BODY_TOO_LARGE' }); }
      const { target, kind } = JSON.parse(raw);
      if (!validTarget(target) || !['audio', 'video'].includes(kind)) return send(400, { error: 'MEDIA_TARGET_INVALID' });
      if (request.url === '/resolve') return send(200, await ytdlp.resolve(target, { kind, timeoutMs: 25000 }));
      const child = ytdlp.stream(target, kind); children.add(child);
      const end = () => { child.kill('SIGKILL'); children.delete(child); };
      child.on('error', () => response.destroy()); child.on('close', code => { children.delete(child); if (code !== 0) response.destroy(); });
      response.on('close', end);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      child.stdout.pipe(response);
    } catch (error) {
      if (!response.headersSent) send(502, { error: /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'MEDIA_UNAVAILABLE' });
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  return { async close() { children.forEach(child => child.kill('SIGKILL')); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

// The AWS side speaks only to its own loopback port, forwarded through SSH.
export function remoteMedia({ port = 3212, token } = {}) {
  if (!tokenValid(token) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('MEDIA_WORKER_CONFIG_INVALID');
  const endpoint = `http://127.0.0.1:${port}`;
  const post = (path, body, signal) => fetch(endpoint + path, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal });
  return {
    async resolve(target, { kind = 'audio' } = {}) {
      if (!validTarget(target)) throw new Error('MEDIA_TARGET_INVALID');
      let response, result;
      try { response = await post('/resolve', { target, kind }, AbortSignal.timeout(30000)); result = await response.json(); }
      catch { throw new Error('MEDIA_WORKER_UNAVAILABLE'); }
      if (!response.ok) throw new Error(/^[A-Z][A-Z0-9_]+$/.test(result.error ?? '') ? result.error : 'MEDIA_WORKER_UNAVAILABLE');
      if (!validTarget(result.link) || typeof result.title !== 'string' || !['webm', 'm4a', 'mp4'].includes(result.ext)) throw new Error('MEDIA_WORKER_RESPONSE_INVALID');
      return result;
    },
    stream(target, kind = 'audio') {
      const abort = new AbortController();
      const handle = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill() { abort.abort(); handle.stdout.destroy(); } });
      void (async () => {
        try {
          const response = await post('/stream', { target, kind }, abort.signal);
          if (!response.ok || !response.body) throw new Error('MEDIA_WORKER_STREAM_FAILED');
          const input = Readable.fromWeb(response.body);
          input.on('error', () => { if (!abort.signal.aborted) handle.emit('error', new Error('MEDIA_WORKER_STREAM_FAILED')); });
          input.on('end', () => handle.emit('close', 0));
          handle.stdout.on('close', () => input.destroy());
          input.pipe(handle.stdout);
        } catch { if (!abort.signal.aborted) handle.emit('error', new Error('MEDIA_WORKER_STREAM_FAILED')); handle.stdout.destroy(); }
      })();
      return handle;
    },
  };
}
