// Integration check: localhost only, no accounts or meetings, no media capture.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './settings.js';
import { setTimeout as delay } from 'node:timers/promises';
import { launchBot } from './bot-launch.js';
import { startServer } from '../controller/server.js';
import { meetInit } from '../controller/meet-init.js';
import { playerInit } from '../controller/player-init.js';
let bot, server;
const observations = { checkedAt: new Date().toISOString(), scope: 'Local browser integration; no live E0–E6 result' };
try {
  bot = await launchBot({ headless: !process.argv.includes('--windowed') });
  Object.assign(observations, bot.observation);
  await mkdir(join(root, '.local'), { recursive: true });
  const fixtureFolder = await mkdtemp(join(root, '.local/player-check-'));
  // A generated silent WAV fixture, never a recording. Retained in ignored .local/.
  const fixture = Buffer.alloc(44 + 4410 * 2);
  fixture.write('RIFF'); fixture.writeUInt32LE(fixture.length - 8, 4); fixture.write('WAVEfmt ', 8);
  fixture.writeUInt32LE(16, 16); fixture.writeUInt16LE(1, 20); fixture.writeUInt16LE(1, 22);
  fixture.writeUInt32LE(44100, 24); fixture.writeUInt32LE(88200, 28); fixture.writeUInt16LE(2, 32); fixture.writeUInt16LE(16, 34);
  fixture.write('data', 36); fixture.writeUInt32LE(fixture.length - 44, 40);
  await writeFile(join(fixtureFolder, 'tone.wav'), fixture, { flag: 'wx' });
  const extensionId = 'a'.repeat(32);
  server = await startServer({ port: bot.config.port, allowDefaultTone: true, musicFolder: fixtureFolder, extensionId });
  const http = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = request(server.origin + path, { method, headers }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) })); });
    req.on('error', reject); req.end();
  });
  assert.equal((await http('/player', { Host: 'evil.test' })).status, 403);
  assert.equal((await http('/player', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await http('/status')).status, 403);
  assert.equal((await http('/status', { Origin: 'chrome-extension://' + extensionId, Authorization: 'Bearer incorrect' })).status, 403);
  assert.equal((await http('/status', { Origin: 'chrome-extension://' + extensionId, Authorization: 'Bearer ' + server.token })).status, 200);
  assert.equal((await http('/callback?state=invalid')).status, 400);
  const fileId = await server.localFile('tone.wav');
  const range = await http('/player?file=' + fileId, { Range: 'bytes=0-43' });
  assert.equal(range.status, 206); assert.equal(range.body.length, 44); assert.equal(range.body.toString('ascii', 0, 4), 'RIFF');
  await assert.rejects(() => server.localFile('../../package.json'), /MEDIA_UNAVAILABLE/);
  observations.http = { hostGuard: true, originGuard: true, bearerGuard: true, callbackStateGuard: true, localFileRange: true, folderConfinement: true };
  await bot.context.grantPermissions(['microphone', 'camera'], { origin: server.origin });
  await bot.meet.addInitScript(meetInit);
  await bot.meet.goto(server.origin + '/player');
  observations.meetInit = await bot.meet.evaluate(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    const { width, height, frameRate } = track.getSettings();
    const result = { syntheticCameraListed: devices.some(device => device.label === 'Meet Companion Cam'), camera: { width, height, frameRate }, audioFailure: null };
    track.stop();
    try { const unexpected = await navigator.mediaDevices.getUserMedia({ audio: true }); unexpected.getTracks().forEach(track => track.stop()); }
    catch (error) { result.audioFailure = error.message; }
    const element = document.createElement('audio'); document.body.append(element); element.muted = false;
    result.remoteMuted = element.muted;
    return result;
  });
  assert.equal(observations.meetInit.camera.width, 1280);
  assert.equal(observations.meetInit.camera.height, 720);
  assert.equal(observations.meetInit.remoteMuted, true);
  assert.equal(observations.meetInit.audioFailure, 'BLACKHOLE_2CH_MISSING');
  // Explicit exception for the synthetic local tone, never for service playback.
  await bot.player.goto(server.origin + '/player');
  await bot.player.evaluate(() => window.companionPlayer.tone());
  await delay(1200);
  observations.defaultTone = await bot.player.evaluate(() => window.companionPlayer.status());
  assert.equal(observations.defaultTone.paused, false);
  assert.ok(observations.defaultTone.currentTime > 0.5);
  assert.equal(observations.defaultTone.duration, 60);
  await bot.player.evaluate(() => window.companionPlayer.stop());
  await bot.player.addInitScript(playerInit);
  await bot.player.reload();
  observations.playerInit = await bot.player.evaluate(async () => {
    const result = {};
    try { await window.companionRoute.check(); } catch (error) { result.lookupFailure = error.message; }
    const detached = new Audio();
    try { await detached.play(); } catch (error) { result.playFailure = error.message; }
    result.detachedPaused = detached.paused;
    detached.muted = false; result.failedRouteStaysMuted = detached.muted;
    const context = new AudioContext();
    try { await context.resume(); } catch (error) { result.contextFailure = error.message; }
    result.contextState = context.state; result.contextSinkType = context.sinkId?.type ?? context.sinkId;
    await context.close();
    return result;
  });
  assert.equal(observations.playerInit.lookupFailure, 'BLACKHOLE_2CH_MISSING');
  assert.equal(observations.playerInit.playFailure, 'BLACKHOLE_2CH_MISSING');
  assert.equal(observations.playerInit.detachedPaused, true);
  assert.equal(observations.playerInit.failedRouteStaysMuted, true);
  assert.equal(observations.playerInit.contextFailure, 'BLACKHOLE_2CH_MISSING');
  assert.equal(observations.playerInit.contextSinkType, 'none');
  observations.result = 'PASS';
} catch (error) {
  observations.result = 'FAIL';
  // Local synthetic check only: assertion text contains no user content.
  observations.error = error.code === 'ERR_ASSERTION' ? 'LOCAL_ASSERTION_FAILED' : /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_BROWSER_CHECK_FAILED';
  process.exitCode = 1;
} finally {
  await bot?.close(); await server?.close();
  console.log(JSON.stringify(observations, null, 2));
}
