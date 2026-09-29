import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { Spotify, playbackBody } from '../controller/spotify.js';
import { meetingURL, MeetDriver, selectors } from '../controller/meet-driver.js';
import { meetInit } from '../controller/meet-init.js';

test('Meet admission requires more than a leave button and respects waiting/terminal states', async () => {
  let body = '', visible = new Set();
  const element = key => ({ first() { return this; }, isVisible: async () => visible.has(key), innerText: async () => body });
  const driver = new MeetDriver({ url: () => 'https://meet.google.com/abc-defg-hij', locator: element, getByRole: (_role, { name }) => element(name) });
  visible = new Set([selectors.leave, selectors.leaveControl]);
  assert.equal(await driver.state(), 'joining');
  visible.add(selectors.meetingDetails);
  assert.equal(await driver.state(), 'in_call');
  for (const [text, expected] of [
    ['Asking to be let in', 'awaiting_admission'],
    ['Your request to join was denied', 'ADMISSION_DENIED'],
    ["You've been removed", 'REMOVED'],
    ['You left the meeting', 'MEETING_ENDED'],
  ]) {
    body = text;
    assert.equal(await driver.state(), expected);
  }
});

test('Meet media-off check handles controls hidden from accessibility and refuses unknown state', async () => {
  const visible = new Set([selectors.cameraOffControl, selectors.muteControl]);
  const pairs = new Map([[selectors.cameraOffControl, selectors.cameraOnControl], [selectors.muteControl, selectors.unmuteControl]]);
  const driver = new MeetDriver({ locator: key => ({
    first() { return this; },
    isVisible: async () => visible.has(key),
    evaluate: async action => action({ click() { visible.delete(key); visible.add(pairs.get(key)); } }),
    waitFor: async () => { if (!visible.has(key)) throw new Error('fixture missing control'); },
  }) });
  await driver.disableMedia();
  assert.deepEqual(visible, new Set([selectors.cameraOnControl, selectors.unmuteControl]));
  await driver.disableMedia(); // Already off must not toggle back on.
  visible.clear();
  await assert.rejects(() => driver.disableMedia(), /MEDIA_OFF_UNVERIFIED/);
});

test('meeting and Spotify links reject lookalike origins and unsupported resources', () => {
  assert.equal(meetingURL('https://meet.google.com/abc-defg-hij?authuser=1'), 'https://meet.google.com/abc-defg-hij');
  for (const link of ['http://meet.google.com/abc-defg-hij', 'https://meet.google.com.evil.test/abc-defg-hij', 'https://meet.google.com/lookup/foo', 'invalid']) assert.throws(() => meetingURL(link));
  assert.deepEqual(playbackBody('https://open.spotify.com/track/fixture123'), { uris: ['spotify:track:fixture123'] });
  assert.deepEqual(playbackBody('https://open.spotify.com/playlist/fixture123'), { context_uri: 'spotify:playlist:fixture123' });
  assert.throws(() => playbackBody('https://open.spotify.com.evil.test/track/fixture123'));
  assert.throws(() => playbackBody('https://open.spotify.com/episode/fixture123'));
});

test('PKCE validates state before token exchange, uses S256, and consumes callbacks once', async () => {
  let calls = 0, verifier;
  const spotify = new Spotify({ clientId: 'offline-fixture', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://accounts.spotify.com/api/token');
    verifier = options.body.get('code_verifier');
    assert.equal(options.body.get('redirect_uri'), 'http://127.0.0.1:3210/callback');
    assert.equal(options.body.has('client_secret'), false);
    return { ok: true, json: async () => ({ access_token: 'offline-fixture-access', expires_in: 3600 }) };
  } });
  try {
    const auth = spotify.beginAuthorization(), url = new URL(auth.url);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['user-modify-playback-state', 'user-read-playback-state']);
    assert.equal((await spotify.callback(new URL('http://127.0.0.1:3210/callback?code=fixture&state=wrong'))).status, 400);
    assert.equal(calls, 0);
    const callback = new URL('http://127.0.0.1:3210/callback');
    callback.search = new URLSearchParams({ code: 'offline-fixture', state: url.searchParams.get('state') });
    assert.equal((await spotify.callback(callback)).status, 200); await auth.completion;
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
    assert.equal((await spotify.callback(callback)).status, 400); assert.equal(calls, 1);
  } finally { spotify.close(); }
});

test('Spotify mutations target only the selected web player; takeover and volume limits fail', async () => {
  const requests = [];
  let takenOver = false;
  const spotify = new Spotify({ clientId: 'offline-fixture', fetchImpl: async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'accounts.spotify.com') return { ok: true, json: async () => ({ access_token: 'offline-fixture-access', expires_in: 3600 }) };
    requests.push({ parsed, options });
    if (parsed.pathname.endsWith('/devices')) return { ok: true, status: 200, json: async () => ({ devices: [{ id: 'web-fixture', name: 'Web Player (Chrome)', is_active: true, supports_volume: true }] }) };
    if (options.method === 'GET') return { ok: true, status: 200, json: async () => ({ device: { id: takenOver ? 'other-fixture' : 'web-fixture' }, is_playing: true }) };
    return { ok: true, status: 204 };
  } });
  try {
    assert.throws(() => spotify.play(), /SPOTIFY_WEB_PLAYER_DEVICE_REQUIRED/);
    const auth = spotify.beginAuthorization(), state = new URL(auth.url).searchParams.get('state');
    await spotify.callback(new URL('http://127.0.0.1:3210/callback?' + new URLSearchParams({ state, code: 'fixture' }))); await auth.completion;
    await spotify.selectDevice();
    await spotify.play('https://open.spotify.com/album/fixture123'); await spotify.pause(); await spotify.next(); await spotify.setVolume(37); await spotify.queue('https://open.spotify.com/track/fixture123');
    const mutations = requests.filter(call => call.options.method !== 'GET');
    assert.equal(mutations.length, 5);
    for (const call of mutations) assert.equal(call.parsed.searchParams.get('device_id'), 'web-fixture');
    assert.deepEqual(JSON.parse(mutations[0].options.body), { context_uri: 'spotify:album:fixture123' });
    assert.throws(() => spotify.setVolume(-1)); assert.throws(() => spotify.setVolume(101)); assert.throws(() => spotify.setVolume(1.5));
    assert.throws(() => spotify.queue('https://open.spotify.com/playlist/fixture123'));
    await spotify.nowPlaying(); takenOver = true;
    await assert.rejects(() => spotify.nowPlaying(), /STREAM_TAKEN_OVER/);
  } finally { spotify.close(); }
});

test('Meet microphone override pins BlackHole, disables processing, and never falls back', async () => {
  let available = true, captured, label = 'BlackHole 2ch (Virtual)';
  class MediaStream { constructor() { this.tracks = []; } addTrack(track) { this.tracks.push(track); } }
  class MediaElement { play() {} }
  class Document { createElement() {} }
  class Element { attachShadow() {} }
  Object.defineProperty(MediaElement.prototype, 'muted', { configurable: true, get() { return this.silent ?? false; }, set(value) { this.silent = value; } });
  const mediaDevices = {
    enumerateDevices: async () => available ? [{ kind: 'audioinput', label, deviceId: 'blackhole-fixture' }, { kind: 'videoinput', label: 'Real camera', deviceId: 'real-camera' }] : [],
    getUserMedia: async constraints => { captured = constraints; return new MediaStream(); },
  };
  const context = {
    window: { Audio: MediaElement }, navigator: { mediaDevices }, MediaStream, HTMLMediaElement: MediaElement, DOMException, Document, Element,
    MutationObserver: class { observe() {} }, setInterval() {},
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }), captureStream: () => ({ getVideoTracks: () => [{}] }) }), querySelectorAll: () => [], addEventListener() {} },
  };
  runInNewContext(`(${meetInit.toString()})()`, context);
  await mediaDevices.getUserMedia({ audio: { deviceId: { exact: 'real-mic' }, echoCancellation: true }, video: false });
  assert.equal(captured.audio.deviceId.exact, 'blackhole-fixture');
  for (const name of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) assert.equal(captured.audio[name], false);
  assert.equal(captured.video, false);
  label = 'BlackHole 2ch';
  await mediaDevices.getUserMedia({ audio: true });
  assert.equal(captured.audio.deviceId.exact, 'blackhole-fixture');
  const devices = await mediaDevices.enumerateDevices();
  assert.equal(devices.filter(device => device.kind === 'videoinput').length, 1);
  assert.equal(devices.at(-1).label, 'Meet Companion Cam');
  captured = undefined; available = false;
  await assert.rejects(() => mediaDevices.getUserMedia({ audio: true }), /BLACKHOLE_2CH_MISSING/);
  assert.equal(captured, undefined);
});
