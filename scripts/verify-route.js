// Account-free check of the audio route on this machine (macOS or Linux): a generated tone in the player tab must
// arrive at the Meet-side microphone through the dedicated virtual device, and a missing route must fail closed.
// Energy is inspected in memory only; nothing is recorded.
import assert from 'node:assert/strict';
import { launchBot } from './bot-launch.js';
import { settings } from './settings.js';
import { platform, requireAudio } from './platform.js';
import { errorCode } from './experiment.js';
import { startServer } from '../controller/server.js';
import { meetInit } from '../controller/meet-init.js';
import { playerInit } from '../controller/player-init.js';

const observation = { scope: 'Local synthetic tone only; no meeting, account or service media', platform: platform.id, arch: process.arch };
let bot, server, stage = 'audio-preflight';
try {
  const config = await settings();
  requireAudio({ ...config, defaultAggregateReviewed: true });
  stage = 'launch';
  server = await startServer({ ...config });
  bot = await launchBot({ headless: !process.argv.includes('--windowed') });
  Object.assign(observation, bot.observation);
  await bot.context.grantPermissions(['microphone'], { origin: server.origin });

  stage = 'device-discovery';
  await bot.meet.addInitScript(meetInit, platform.route);
  await bot.player.addInitScript(playerInit, platform.route);
  await bot.meet.goto(server.origin + '/player');
  await bot.player.goto(server.origin + '/player');
  // Labels need a granted microphone; names are device labels, not personal data.
  const labels = await bot.meet.evaluate(async () => {
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(track => track.stop());
    return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind !== 'videoinput').map(device => `${device.kind}:${device.label}`);
  });
  // Report counts and the route's own labels only: other device names can be personal.
  const routeLabel = new RegExp(`${platform.route.output}|${platform.route.input}`, 'i');
  observation.devices = { inputs: labels.filter(label => label.startsWith('audioinput:')).length, outputs: labels.filter(label => label.startsWith('audiooutput:')).length, route: labels.filter(label => routeLabel.test(label.slice(label.indexOf(':') + 1))) };
  assert.ok(labels.some(label => label.startsWith('audiooutput:') && new RegExp(platform.route.output, 'i').test(label.slice(12))), 'route output visible to Chrome');
  assert.ok(labels.some(label => label.startsWith('audioinput:') && new RegExp(platform.route.input, 'i').test(label.slice(11))), 'route input visible to Chrome');

  stage = 'tone-routing';
  const energy = () => bot.meet.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const settings = stream.getAudioTracks()[0].getSettings();
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaStreamSource(stream).connect(analyser);
    await context.resume();
    await new Promise(resolve => setTimeout(resolve, 1500));
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    stream.getTracks().forEach(track => track.stop()); await context.close();
    return { rms, echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl };
  });
  const silent = await energy();
  await bot.player.evaluate(() => window.companionPlayer.tone());
  await bot.player.waitForFunction(() => window.companionPlayer.status().currentTime > 0.5, null, { timeout: 10000 });
  const tone = await energy();
  await bot.player.evaluate(() => window.companionPlayer.stop());
  Object.assign(observation, { silentRms: Number(silent.rms.toFixed(5)), toneRms: Number(tone.rms.toFixed(5)), micProcessingOff: [tone.echoCancellation, tone.noiseSuppression, tone.autoGainControl].every(value => value === false), playerSinkSelected: (await bot.player.evaluate(() => window.companionPlayer.status())).sinkSelected });
  assert.ok(tone.rms > 0.01, 'tone reaches the Meet-side microphone through the virtual device');
  assert.ok(silent.rms < tone.rms / 10, 'route is silent when nothing plays');
  assert.equal(observation.micProcessingOff, true);

  stage = 'fail-closed';
  // A route that does not exist must refuse to play rather than fall back to the default output.
  const page = await bot.context.newPage();
  await page.addInitScript(playerInit, { output: '^No Such Device$', missing: platform.route.missing });
  await page.goto(server.origin + '/player');
  const refused = await page.evaluate(async () => { try { await window.companionPlayer.tone(); return 'PLAYED'; } catch (error) { return window.companionRoute.status().error ?? error.message; } });
  const stayedPaused = await page.evaluate(() => window.companionPlayer.status().paused);
  await page.close();
  Object.assign(observation, { missingRouteResult: refused, missingRouteStayedPaused: stayedPaused });
  assert.equal(refused, platform.route.missing); assert.equal(stayedPaused, true);

  console.log(JSON.stringify({ ...observation, result: 'PASS' }));
} catch (error) {
  console.log(JSON.stringify({ ...observation, result: 'FAIL', stage, error: errorCode(error), detail: error.code === 'ERR_ASSERTION' ? error.message : undefined }));
  process.exitCode = 1;
} finally { await bot?.close(); await server?.close(); }
