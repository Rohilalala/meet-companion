// Localhost integration only: synthetic sources, no microphone or meeting.
import assert from 'node:assert/strict';
import { launchBot } from './bot-launch.js';
import { startServer } from '../controller/server.js';
import { meetInit } from '../controller/meet-init.js';
import { errorCode } from './experiment.js';

let bot, server;
try {
  bot = await launchBot({ headless: !process.argv.includes('--windowed') });
  server = await startServer({ port: bot.config.port, allowDefaultTone: true });
  // Save the real property getter in the same init script, before the override.
  await bot.meet.addInitScript({ content: `window.nativeMutedForTest = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted').get; (${meetInit.toString()})();` });
  await bot.meet.goto(server.origin + '/player');
  const result = await bot.meet.evaluate(async () => {
    await window.companionPlayer.tone();
    const audio = document.querySelector('audio');
    audio.muted = false;
    const actualMuted = window.nativeMutedForTest.call(audio);
    const detached = new Audio(); detached.muted = false;
    const detachedMuted = window.nativeMutedForTest.call(detached);
    const context = new AudioContext({ sinkId: '' });
    const initialSink = context.sinkId?.type;
    await context.setSinkId('');
    const afterDefaultAttempt = context.sinkId?.type;
    await context.setSinkId('invalid-physical-device');
    const afterDeviceAttempt = context.sinkId?.type;
    const oscillator = context.createOscillator(); oscillator.connect(context.destination);
    oscillator.start(); await context.resume();
    const runningSilent = context.state === 'running' && context.sinkId?.type === 'none';
    oscillator.stop(); await context.close(); window.companionPlayer.stop();
    return { actualMuted, detachedMuted, initialSink, afterDefaultAttempt, afterDeviceAttempt, runningSilent };
  });
  assert.equal(result.actualMuted, true); assert.equal(result.detachedMuted, true);
  for (const key of ['initialSink', 'afterDefaultAttempt', 'afterDeviceAttempt']) assert.equal(result[key], 'none');
  assert.equal(result.runningSilent, true);
  // The Meet-only guard must not change the separate player's AudioContext.
  await bot.player.goto(server.origin + '/player');
  const playerUnaffected = await bot.player.evaluate(async () => {
    const context = new AudioContext();
    const unaffected = context.sinkId === ''; await context.close(); return unaffected;
  });
  assert.equal(playerUnaffected, true);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Local synthetic output isolation; live echo fix unverified', ...bot.observation, ...result, playerUnaffected, result: 'PASS' }));
} catch (error) {
  console.log(JSON.stringify({ result: 'FAIL', error: errorCode(error) })); process.exitCode = 1;
} finally { await bot?.close(); await server?.close(); }
