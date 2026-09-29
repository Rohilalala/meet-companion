// Explicit localhost integration: share only the generated diagnostic tab.
import assert from 'node:assert/strict';
import { harness, errorCode } from './experiment.js';
let h, stage = 'launch';
try {
  h = await harness({ presentation: true });
  stage = 'prepare';
  await h.player.setViewportSize({ width: 1920, height: 1080 });
  await h.player.evaluate(title => {
    document.title = title;
    document.querySelector('#tone').onclick = async () => { await document.documentElement.requestFullscreen(); await window.companionPlayer.tone(); };
  }, h.presentationTitle);
  await h.meet.goto(h.server.origin + '/player');
  await h.meet.evaluate(() => {
    document.querySelector('#beep').onclick = async () => {
      try {
        window.companionPresentation.arm();
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // Synthetic local tone only. Inspect energy in memory; never record.
        const context = new AudioContext({ sinkId: { type: 'none' } });
        const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser();
        source.connect(analyser); await context.resume();
        await new Promise(resolve => setTimeout(resolve, 700));
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        source.disconnect(); await context.close();
        const video = stream.getVideoTracks()[0].getSettings();
        window.presentationResult = { surface: video.displaySurface, width: video.width, height: video.height, audioTracks: stream.getAudioTracks().length, suppression: stream.getAudioTracks()[0]?.getSettings().suppressLocalAudioPlayback };
        window.presentationResult.syntheticAudioEnergy = rms;
      } catch { window.presentationResult = { error: 'PRESENTATION_FAILED', ...window.companionPresentation.status() }; }
    };
  });
  stage = 'capture';
  await h.player.bringToFront();
  await h.player.locator('#tone').click();
  await h.player.waitForFunction(() => !!document.fullscreenElement);
  await h.meet.bringToFront();
  await h.meet.locator('#beep').click();
  await h.meet.waitForFunction(() => window.presentationResult, null, { timeout: 20000 });
  const result = await h.meet.evaluate(() => window.presentationResult);
  console.log(JSON.stringify({ stage, observation: result }));
  assert.equal(result.surface, 'browser'); assert.equal(result.audioTracks, 1);
  // Allow two pixels of rounding in the native tab surface.
  assert.ok(Math.abs(result.width - 1280) <= 2); assert.ok(Math.abs(result.height - 720) <= 2);
  assert.ok(Math.abs(result.width / result.height - 16 / 9) < 0.005);
  assert.ok(result.syntheticAudioEnergy > 0.001);
  await h.meet.evaluate(() => window.companionPresentation.stop());
  assert.equal(await h.meet.evaluate(() => window.companionPresentation.status().active), false);
  console.log(JSON.stringify({ scope: 'Local native tab presentation only; no meeting or service media', ...result, result: 'PASS' }));
} catch (error) {
  console.log(JSON.stringify({ result: 'FAIL', stage, error: errorCode(error) })); process.exitCode = 1;
} finally { await h?.close(); }
