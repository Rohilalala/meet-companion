import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFile, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { meetingURL } from '../controller/meet-driver.js';

// Always-on local launcher: a control page that starts the bot for a Meet link and stops it.
// Loopback only; the API also needs a custom header, which cross-site pages cannot send without a CORS preflight we never grant.
const kept = ['observedAt', 'state', 'result', 'action', 'service', 'mode', 'position', 'error', 'stage', 'errorType', 'sourceLocations', 'chromeExit', 'exit', 'stderr'];
const botRun = fileURLToPath(new URL('./bot-run.js', import.meta.url));

const defaultLog = fileURLToPath(new URL('../.local/bot-events.log', import.meta.url));
// Detached: the bot gets its own process group, so Ctrl+C on the launcher does not also hit the bot and its Chrome,
// and a hung bot can be force-killed together with its Chrome.
const spawnDetached = link => spawn(process.execPath, [botRun, '--live', '--meeting', link], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });

export function startControl({ port = 3211, savedLink, spawnBot = spawnDetached, logFile = defaultLog, graceMs = 20000 } = {}) {
  let child = null, meeting = null, leaving = false, pin = null;
  const events = [];
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });
  const record = event => {
    if (event.state === 'PIN') { pin = event.pin; return; } // shown on the page only; never listed or written to disk
    const entry = Object.fromEntries(kept.filter(key => event[key] !== undefined).map(key => [key, event[key]]));
    events.push(entry); if (events.length > 20) events.shift();
    // Sanitized events only (codes, stages, source locations): the page forgets them on restart, this file does not.
    if (logFile) appendFile(logFile, JSON.stringify({ meeting, ...entry }) + '\n', () => {});
  };
  // Ask the bot to leave (it clicks Leave, then closes Chrome); force-kill its whole group if it has not exited in time.
  const leave = bot => {
    if (leaving) return;
    leaving = true;
    bot.kill('SIGINT');
    setTimeout(() => {
      if (child !== bot) return;
      record({ observedAt: new Date().toISOString(), state: 'FORCE_KILLED' });
      try { process.kill(-bot.pid, 'SIGKILL'); } catch { bot.kill('SIGKILL'); }
    }, graceMs).unref();
  };
  const server = createServer((request, response) => {
    const self = `127.0.0.1:${server.address().port}`;
    const send = (status, body, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (request.headers.host !== self) return send(403, { error: 'HOST_REFUSED' });
    if (request.method === 'GET' && request.url === '/') {
      const nonce = randomBytes(18).toString('base64');
      response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'`);
      return send(200, page(nonce, !!savedLink), 'text/html; charset=utf-8');
    }
    const site = request.headers['sec-fetch-site'];
    if (request.headers['x-companion'] !== '1' || (request.headers.origin && request.headers.origin !== `http://${self}`) || (site && site !== 'same-origin')) return send(403, { error: 'ORIGIN_REFUSED' });
    if (request.method === 'GET' && request.url === '/status') return send(200, { running: !!child, leaving, meeting, pin: child ? pin : null, events });
    if (request.method !== 'POST') return send(405, { error: 'METHOD_REFUSED' });
    let raw = '';
    request.on('data', chunk => { raw += chunk; if (raw.length > 2048) request.destroy(); });
    request.on('end', () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'BAD_JSON' }); }
      if (request.url === '/join') {
        if (child) return send(409, { error: 'BOT_ALREADY_RUNNING' });
        let link;
        try { link = meetingURL(body.saved ? savedLink : body.link); } catch (error) { return send(400, { error: error.message }); }
        events.length = 0; leaving = false; pin = null; meeting = new URL(link).pathname.slice(1);
        const bot = child = spawnBot(link);
        createInterface({ input: bot.stdout }).on('line', line => { try { record(JSON.parse(line)); } catch { /* not an event */ } });
        // Keep how the process ended and the tail of its stderr so an unexpected exit is explainable.
        // Links are removed before the tail is cut, so a link split at the cut cannot slip through.
        let stderr = '';
        bot.stderr?.on('data', chunk => { stderr = (stderr + String(chunk).replace(/(?:https?:\/\/|\b[\w.-]+\.(?:com|google)\/)\S*/g, '[link]')).slice(-600); });
        const ended = (code, signal, error) => {
          if (child !== bot) return;
          child = null; leaving = false;
          record({ observedAt: new Date().toISOString(), state: 'EXITED', exit: { code, signal }, error, stderr: stderr.trim() || undefined });
        };
        // 'close' fires after stdout is drained, so the bot's last events are listed before EXITED.
        bot.on('close', (code, signal) => ended(code, signal));
        bot.on('error', () => ended(null, null, 'BOT_SPAWN_FAILED'));
        return send(202, { ok: true, meeting });
      }
      if (request.url === '/leave') {
        if (!child) return send(409, { error: 'NOT_RUNNING' });
        if (leaving) return send(409, { error: 'ALREADY_LEAVING' });
        leave(child);
        return send(202, { ok: true });
      }
      send(404, { error: 'NOT_FOUND' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('CONTROL_PORT_IN_USE')));
    server.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port,
      async close() {
        // Let a running bot leave before the launcher exits; leave() force-kills it after the grace period.
        const bot = child;
        if (bot) await new Promise(done => { bot.once('close', done); bot.once('error', done); leave(bot); setTimeout(done, graceMs + 2000).unref(); });
        server.closeAllConnections(); await new Promise(done => server.close(done));
      },
    }));
  });
}

function page(nonce, hasSaved) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Meet Companion</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#15181d;--muted:#5b6470;--line:#dde1e6;--accent:#1a73e8;--danger:#c5221f}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1e24;--text:#e8eaed;--muted:#9aa3ad;--line:#2c323a;--accent:#8ab4f8;--danger:#f28b82}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:640px;margin:40px auto;padding:0 16px}h1{font-size:22px;margin:0 0 4px}p{color:var(--muted);margin:0 0 20px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
.row{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
button{padding:10px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:inherit;font:inherit;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--danger)}button:disabled{opacity:.5;cursor:default}
#state{font-weight:600}#error{color:var(--danger);min-height:1.5em;margin-top:8px}ul{list-style:none;padding:0;margin:0;font:13px/1.6 ui-monospace,monospace;color:var(--muted)}
</style>
<main><h1>Meet Companion</h1><p>Send the bot into a Google Meet, or bring it back out.</p>
<section><div class="row">${hasSaved ? '<button class="primary" id="saved">Join saved meeting</button>' : ''}</div>
<div class="row" style="margin-top:12px"><input id="link" placeholder="https://meet.google.com/abc-defg-hij" aria-label="Meet link"><button id="join">Join</button></div>
<div id="error" role="alert"></div></section>
<section><div class="row" style="justify-content:space-between;align-items:center"><div>Status: <span id="state">…</span></div><button class="danger" id="leave">Leave call</button></div>
<div id="pinrow" hidden style="margin-top:12px;color:var(--muted)">Owner PIN for chat: <b id="pin" style="color:var(--text);font:600 16px ui-monospace,monospace"></b> — use <code>/leave PIN</code> or <code>/clear PIN</code>. It changes after each use.</div></section>
<section><div style="margin-bottom:8px">Recent events</div><ul id="events"></ul></section></main>
<script nonce="${nonce}">
const $ = id => document.getElementById(id);
const api = (path, body) => fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-Companion': '1', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(r => r.json());
const describe = e => [e.state, e.result, e.action, e.service, e.mode, e.error, e.stage && 'at ' + e.stage, e.sourceLocations?.[0], e.chromeExit && (e.chromeExit.signal ?? e.chromeExit.code) != null && 'chrome ' + (e.chromeExit.signal ?? 'exit ' + e.chromeExit.code), e.exit && 'process ' + (e.exit.signal ?? 'exit ' + e.exit.code), e.stderr].filter(Boolean).join(' · ');
async function refresh() {
  try {
    const s = await api('/status');
    const joined = s.events.some(e => e.state === 'LISTENING'), failed = s.events.some(e => e.result === 'STOPPED');
    $('state').textContent = !s.running ? 'not in a call' : s.leaving ? 'leaving ' + s.meeting + '…' : failed ? 'stopping…' : joined ? 'in ' + s.meeting : 'joining ' + s.meeting + '…';
    $('leave').disabled = !s.running || s.leaving;
    $('pinrow').hidden = !s.pin; $('pin').textContent = s.pin ?? '';
    for (const id of ['join', 'saved']) if ($(id)) $(id).disabled = s.running;
    $('events').replaceChildren(...s.events.slice().reverse().map(e => { const li = document.createElement('li'); li.textContent = (e.observedAt || '').slice(11, 19) + '  ' + describe(e); return li; }));
  } catch { $('state').textContent = 'launcher not reachable'; }
}
async function act(path, body) {
  $('error').textContent = '';
  try { const r = await api(path, body); if (r.error) $('error').textContent = r.error; }
  catch { $('error').textContent = 'Launcher not reachable. Start it with: npm run control'; }
  refresh();
}
$('join').onclick = () => act('/join', { link: $('link').value.trim() });
if ($('saved')) $('saved').onclick = () => act('/join', { saved: true });
$('leave').onclick = () => act('/leave', {});
refresh(); setInterval(refresh, 2000);
</script></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { settings } = await import('./settings.js');
  const config = await settings();
  const control = await startControl({ savedLink: config.meetingLink });
  console.log(`Meet Companion control page: http://127.0.0.1:${control.port}`);
  const stop = async () => { await control.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
