import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline/promises';
import { launchBot } from './bot-launch.js';
import { settings } from './settings.js';
import { startServer } from '../controller/server.js';
import { meetInit } from '../controller/meet-init.js';
import { playerInit } from '../controller/player-init.js';
import { MeetDriver } from '../controller/meet-driver.js';
import { Spotify } from '../controller/spotify.js';
import { presentationInit } from '../controller/presentation-init.js';

export const live = process.argv.includes('--live');
export const headless = !process.argv.includes('--windowed');
export function errorCode(error) {
  const message = error?.message ?? '';
  if (/^(?:[A-Z][A-Z0-9_]*|SIGNED_OUT\((?:google|spotify|applemusic|youtubemusic)\))$/.test(message)) return message;
  if (/browser has been closed|Target closed|Browser closed/i.test(message)) return 'BROWSER_CRASHED';
  return message.match(/\b(BLACKHOLE_2CH_MISSING|AUDIO_ROUTE_LOST|CHAT_UNAVAILABLE|MEDIA_UNAVAILABLE)\b/)?.[1] ?? 'HARNESS_OPERATION_FAILED';
}
export function emit(experiment, observation) { console.log(JSON.stringify({ experiment, observedAt: new Date().toISOString(), ...observation })); }
export function blocked(experiment, needs) { emit(experiment, { result: 'BLOCKED', needs }); }
export async function run(experiment, action) {
  try { await action(); } catch (error) { emit(experiment, { result: 'ERROR', error: errorCode(error) }); process.exitCode = 1; }
}
export function requireAudio(config) {
  const data = JSON.parse(execFileSync('/usr/sbin/system_profiler', ['SPAudioDataType', '-json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }));
  const devices = data.SPAudioDataType.flatMap(group => group._items ?? []);
  const defaults = devices.filter(device => device.coreaudio_default_audio_output_device === 'spaudio_yes' || device.coreaudio_default_audio_system_device === 'spaudio_yes');
  if (!defaults.length) throw new Error('DEFAULT_OUTPUT_UNKNOWN');
  if (defaults.some(device => /blackhole/i.test(device._name))) throw new Error('BLACKHOLE_DEFAULT_OUTPUT_FORBIDDEN');
  if (defaults.some(device => /multi.output|aggregate/i.test(device._name)) && config.defaultAggregateReviewed !== true) throw new Error('DEFAULT_AGGREGATE_REVIEW_REQUIRED');
  const route = devices.find(device => /^BlackHole 2ch$/i.test(device._name));
  if (!route?.coreaudio_device_input || !route?.coreaudio_device_output) throw new Error('BLACKHOLE_2CH_MISSING');
}
export async function harness({ audio = true, presentation = false } = {}) {
  const config = await settings();
  if (audio) requireAudio(config);
  const spotify = new Spotify({ clientId: config.spotifyClientId, port: config.port, deviceId: config.spotifyDeviceId });
  let server, bot;
  try {
    server = await startServer({ ...config, callback: url => spotify.callback(url) });
    bot = await launchBot({ headless, presentation });
    for (const origin of [server.origin, 'https://meet.google.com', 'https://open.spotify.com', 'https://music.apple.com', 'https://music.youtube.com', 'https://www.youtube.com', 'https://youtube.com']) {
      await bot.context.grantPermissions(origin === 'https://meet.google.com' ? ['microphone', 'camera'] : ['microphone'], { origin });
    }
    await bot.meet.addInitScript(meetInit);
    if (presentation) await bot.meet.addInitScript(presentationInit);
    await bot.player.addInitScript(playerInit);
    await bot.player.goto(server.origin + '/player');
    return { ...bot, config, server, spotify, driver: new MeetDriver(bot.meet), async close() { spotify.close(); await bot.close(); await server.close(); } };
  } catch (error) { spotify.close(); await bot?.close(); await server?.close(); throw error; }
}
export async function authorize(h) {
  const auth = h.spotify.beginAuthorization();
  // Open consent for the human; do not print the URL/state or automate sign-in.
  const child = spawn('/usr/bin/open', [auth.url], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('error', () => reject(new Error('SPOTIFY_AUTH_OPEN_FAILED'))); child.once('exit', code => code === 0 ? resolve() : reject(new Error('SPOTIFY_AUTH_OPEN_FAILED'))); });
  console.log('Complete Spotify consent manually in the opened browser tab; tokens remain in memory.');
  await auth.completion;
}
export async function answer(question) {
  if (!process.stdin.isTTY) return 'unobserved';
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(question + ' ')).trim(); } finally { reader.close(); }
}
export async function receiverAudio() {
  const heard = await answer('Receiver: continuous ungated audio for the full interval? [yes/no/unobserved]');
  const echo = await answer('Receiver: echo or feedback? [yes/no/unobserved]');
  const unaffected = await answer('Owner same-Mac Meet unaffected? [yes/no/unobserved]');
  const value = input => input === 'yes' ? true : input === 'no' ? false : null;
  return { continuousAudio: value(heard), echoOrFeedback: value(echo), ownerUnaffected: value(unaffected) };
}
export async function monitor(h, seconds, experiment, source) {
  const start = Date.now();
  const observation = { samples: 0, mediaPlayingSamples: 0, botMutedSamples: 0, routeErrors: 0, elapsedMs: 0 };
  while (Date.now() - start < seconds * 1000) {
    const state = await h.driver.state();
    if (state !== 'in_call') throw new Error(state === 'joining' ? 'MEETING_ENDED' : state);
    const media = await h.player.evaluate(() => {
      const route = window.companionRoute?.status();
      return { playing: !!(route?.playingElements || route?.runningContexts), error: route?.error ?? null };
    });
    observation.samples++; if (media.playing) observation.mediaPlayingSamples++;
    if (media.error) observation.routeErrors++;
    if (await h.driver.muted()) observation.botMutedSamples++;
    if (observation.samples % 15 === 0) emit(experiment, { source, elapsedSeconds: Math.round((Date.now() - start) / 1000), running: true });
    await delay(1000);
  }
  observation.elapsedMs = Date.now() - start; return observation;
}
export async function waitForState(spotify, predicate) {
  for (let i = 0; i < 30; i++) { const state = await spotify.nowPlaying(); if (predicate(state)) return state; await delay(500); }
  throw new Error('SPOTIFY_STATE_TIMEOUT');
}
export async function settledSession(inspect) {
  for (let i = 0; i < 20; i++) { const state = await inspect(); if (state !== 'unknown') return state; await delay(500); }
  return 'unknown';
}
