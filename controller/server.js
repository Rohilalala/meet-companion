import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { oneTimeIds, stream } from './ytdlp.js';

export async function startServer({ port = 3210, musicFolder, extensionId, media, allowDefaultTone = false, callback = async () => ({ status: 400, text: 'No authorization pending.' }) } = {}) {
  const token = randomBytes(32).toString('hex');
  const files = new Map();
  const streams = oneTimeIds(), children = new Set();
  const stopStreams = () => { children.forEach(child => child.kill('SIGKILL')); children.clear(); };
  process.on('exit', stopStreams);
  const template = await readFile(new URL('./player.html', import.meta.url), 'utf8');
  const origin = `http://127.0.0.1:${port}`;
  const extensionOrigin = /^[a-p]{32}$/.test(extensionId ?? '') ? `chrome-extension://${extensionId}` : null;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const send = (status, text) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(text); };
    try {
      if (request.headers.host !== `127.0.0.1:${port}`) return send(403, 'HOST_REFUSED');
      const url = new URL(request.url, origin);
      if (url.origin !== origin) return send(403, 'HOST_REFUSED');
      if (request.method === 'OPTIONS' && extensionOrigin && request.headers.origin === extensionOrigin && url.pathname === '/status') {
        response.writeHead(204, { 'Access-Control-Allow-Origin': extensionOrigin, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization' }); response.end(); return;
      }
      if (request.method !== 'GET') return send(405, 'METHOD_REFUSED');
      if (url.pathname === '/callback') {
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const result = await callback(url);
        return send(result.status, result.text);
      }
      if (url.pathname.startsWith('/stream/')) {
        if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== origin)) return send(403, 'ORIGIN_REFUSED');
        const entry = streams.take(url.pathname.slice(8));
        if (!entry) return send(404, 'MEDIA_UNAVAILABLE');
        const child = media ? media.stream(entry.target, entry.kind) : stream(entry.target, entry.kind); children.add(child);
        const end = () => { child.kill('SIGKILL'); children.delete(child); };
        child.on('error', () => { end(); response.destroy(); }); child.on('close', () => children.delete(child));
        response.on('close', end);
        response.writeHead(200, { 'Content-Type': `${entry.kind === 'video' ? 'video' : 'audio'}/${entry.ext === 'webm' ? 'webm' : 'mp4'}` });
        child.stdout.pipe(response); return;
      }
      if (url.pathname === '/player') {
        if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== origin)) return send(403, 'ORIGIN_REFUSED');
        const file = files.get(url.searchParams.get('file'));
        if (url.searchParams.has('file')) {
          if (!file) return send(404, 'MEDIA_UNAVAILABLE');
          const size = (await stat(file.path)).size;
          let start = 0, end = size - 1;
          if (request.headers.range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
            if (!match) return send(416, 'RANGE_REFUSED');
            start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
            if (start > end || start >= size) return send(416, 'RANGE_REFUSED');
            response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          }
          response.writeHead(request.headers.range ? 206 : 200, { 'Content-Type': file.type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
          const stream = createReadStream(file.path, { start, end });
          stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); return;
        }
        const nonce = randomBytes(18).toString('base64');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(template.replace('__NONCE__', nonce).replace('__DEFAULT_ALLOWED__', String(allowDefaultTone))); return;
      }
      const authorization = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (!extensionOrigin || request.headers.origin !== extensionOrigin || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) return send(403, 'AUTH_REFUSED');
      response.setHeader('Access-Control-Allow-Origin', extensionOrigin);
      if (url.pathname === '/status') return send(200, JSON.stringify({ phase: 0 }));
      send(404, 'NOT_FOUND');
    } catch { if (!response.headersSent) send(500, 'REQUEST_FAILED'); else response.destroy(); }
  });
  await new Promise((resolve, reject) => server.once('error', () => reject(new Error('CONTROLLER_PORT_IN_USE'))).listen(port, '127.0.0.1', resolve));
  return {
    origin, token,
    async localFile(filename) {
      if (!musicFolder) throw new Error('MUSIC_FOLDER_REQUIRED');
      const folder = await realpath(musicFolder);
      const path = await realpath(join(folder, filename));
      if (!path.startsWith(folder + sep) || !(await stat(path)).isFile()) throw new Error('MEDIA_UNAVAILABLE');
      const type = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac' }[extname(path).toLowerCase()];
      if (!type) throw new Error('MEDIA_UNAVAILABLE');
      const id = randomBytes(16).toString('hex'); files.set(id, { path, type }); return id;
    },
    streamOnce(target, ext, kind = 'audio') { return streams.add({ target, ext, kind }); },
    stopStreams,
    async close() { stopStreams(); process.removeListener('exit', stopStreams); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
