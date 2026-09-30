import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { Spotify, playbackBody } from '../controller/spotify.js';
import { meetingURL, MeetDriver, selectors, observeMeetChat } from '../controller/meet-driver.js';
import { meetInit } from '../controller/meet-init.js';
import { playerInit } from '../controller/player-init.js';
import { playback } from '../controller/playback.js';
import { presentationInit } from '../controller/presentation-init.js';
import { parseBotCommand, ChatBot } from '../controller/bot-command.js';
import { resolveArgs, streamArgs, errorCode as ytdlpError, target as ytdlpTarget, oneTimeIds } from '../controller/ytdlp.js';

test('yt-dlp arguments are anonymous, single-video, audio-only, and end option parsing before the target', () => {
  for (const build of [resolveArgs, streamArgs]) {
    for (const value of ['https://www.youtube.com/watch?v=abcdefghijk', ytdlpTarget({ search: '--cookies-from-browser chrome' })]) {
      const args = build(value);
      assert.equal(args.some(arg => /^--cookies(?:-from-browser)?(?:=|$)/.test(arg) || arg === '--username' || arg === '--netrc'), false);
      for (const flag of ['--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-cache-dir', '--no-playlist']) assert.ok(args.includes(flag), flag);
      assert.equal(args[args.indexOf('-f') + 1], 'bestaudio');
      assert.equal(args.at(-2), '--'); assert.equal(args.at(-1), value);
    }
  }
  assert.equal(ytdlpTarget({ search: 'bairi piya' }), 'ytsearch1:bairi piya');
  for (const build of [resolveArgs, streamArgs]) {
    const args = build('x', 'video');
    for (const flag of ['--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-cache-dir', '--no-playlist']) assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf('-f') + 1], 'bv*[height<=1080][ext=webm]+ba[ext=webm]');
    assert.equal(args[args.indexOf('--merge-output-format') + 1], 'webm');
    assert.equal(args.at(-2), '--');
  }
  assert.deepEqual(streamArgs('x').slice(-4), ['-o', '-', '--', 'x']);
});

test('yt-dlp failures map to fixed codes', () => {
  assert.equal(ytdlpError('', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' })), 'YTDLP_MISSING');
  for (const text of ['ERROR: unable to download video data: HTTP Error 403: Forbidden', "ERROR: [youtube] x: Sign in to confirm you’re not a bot", 'ERROR: This video requires login', 'ERROR: login required']) assert.equal(ytdlpError(text), 'YOUTUBE_BLOCKED', text);
  for (const text of ['ERROR: [youtube] x: Video unavailable', 'ERROR: Requested format is not available', '']) assert.equal(ytdlpError(text), 'MEDIA_UNAVAILABLE', text);
});

test('stream ids are single-use and expire', async () => {
  const ids = oneTimeIds(50);
  const id = ids.add({ target: 't' });
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.deepEqual(ids.take(id), { target: 't' });
  assert.equal(ids.take(id), null);
  assert.equal(ids.take('unknown'), null);
  const late = ids.add({ target: 'u' });
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(ids.take(late), null);
});

test('/bot distinguishes music, YouTube audio and ytvideo presentation, and rejects lookalikes', () => {
  const cases = [
    ['https://open.spotify.com/track/fixture123?si=test', 'spotify', 'music'],
    ['https://music.apple.com/us/album/test/123?i=456', 'applemusic', 'music'],
    ['https://music.youtube.com/watch?v=abcdefghijk', 'youtube', 'audio'],
    ['https://youtu.be/abcdefghijk', 'youtube', 'audio'],
    ['https://www.youtube.com/shorts/abcdefghijk', 'youtube', 'audio'],
  ];
  for (const [link, service, mode] of cases) {
    for (const text of ['/bot ' + link, '/bot "' + link + '"']) {
      const command = parseBotCommand(text); assert.equal(command.service, service); assert.equal(command.mode, mode);
    }
  }
  assert.equal(parseBotCommand('ordinary chat'), null);
  for (const text of ['/bot https://youtube.com.evil.test/watch?v=abcdefghijk', '/bot https://evil.test@youtube.com/watch?v=abcdefghijk', '/bot http://youtu.be/abcdefghijk', '/bot https://youtu.be/abcdefghijk extra', '/bot https://music.apple.com/us/browse']) assert.throws(() => parseBotCommand(text));
  for (const action of ['pause', 'resume', 'stop', 'mute', 'unmute', 'help']) assert.deepEqual(parseBotCommand('/bot ' + action), { action });
  assert.deepEqual(parseBotCommand('/bot'), { action: 'help' });
  assert.deepEqual(parseBotCommand('/bot play'), { action: 'resume' });
  assert.equal(parseBotCommand('/bot play spotify https://open.spotify.com/track/fixture123').service, 'spotify');
  assert.equal(parseBotCommand('/bot youtube “https://youtu.be/abcdefghijk”').mode, 'audio');
  for (const alias of ['youtube', 'yt', 'ytmusic', 'youtube-music']) {
    assert.deepEqual(parseBotCommand(`/bot ${alias} https://www.youtube.com/watch?v=abcdefghijk&list=RDabc`), { action: 'play', service: 'youtube', mode: 'audio', link: 'https://www.youtube.com/watch?v=abcdefghijk' });
  }
  assert.deepEqual(parseBotCommand('/bot ytvideo https://youtu.be/abcdefghijk'), { action: 'play', service: 'youtube', mode: 'presentation', dlp: true, link: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.deepEqual(parseBotCommand('/video https://youtu.be/abcdefghijk'), { action: 'play', service: 'youtube', mode: 'presentation', dlp: true, link: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.deepEqual(parseBotCommand('/video bairi piya'), { action: 'play', service: 'youtube', mode: 'presentation', dlp: true, search: 'bairi piya' });
  assert.deepEqual(parseBotCommand('/bot ytweb https://youtu.be/abcdefghijk'), { action: 'play', service: 'youtube', mode: 'presentation', link: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.throws(() => parseBotCommand('/bot ytweb bairi piya'), /BOT_LINK_REQUIRED/);
  assert.deepEqual(parseBotCommand('/bot yt bairi piya shreya'), { action: 'play', service: 'youtube', mode: 'audio', search: 'bairi piya shreya' });
  assert.deepEqual(parseBotCommand('/bot play yt --cookies x'), { action: 'play', service: 'youtube', mode: 'audio', search: '--cookies x' });
  assert.deepEqual(parseBotCommand('/bot play fein travis'), { action: 'play', service: 'youtube', mode: 'audio', search: 'fein travis' });
  assert.deepEqual(parseBotCommand('/play fein travis'), { action: 'play', service: 'youtube', mode: 'audio', search: 'fein travis' });
  assert.deepEqual(parseBotCommand('/play https://youtu.be/abcdefghijk'), { action: 'play', service: 'youtube', mode: 'audio', link: 'https://www.youtube.com/watch?v=abcdefghijk' });
  for (const action of ['pause', 'resume', 'skip', 'queue', 'np', 'stop']) assert.deepEqual(parseBotCommand('/' + action), { action });
  assert.deepEqual(parseBotCommand('/play'), { action: 'resume' });
  assert.deepEqual(parseBotCommand('/volume 30'), { action: 'volume', level: 30 });
  for (const text of ['/playlist', '/shrug', '/me waves', 'play fein']) assert.equal(parseBotCommand(text), null, text);
  assert.throws(() => parseBotCommand('/bot https://www.youtube.com/playlist?list=PLabc'), /BOT_PLAYLIST_UNSUPPORTED/);
  assert.throws(() => parseBotCommand('/bot yt ' + 'x'.repeat(201)), /BOT_SEARCH_INVALID/);
  assert.throws(() => parseBotCommand('/bot spotify https://youtu.be/abcdefghijk'), /BOT_SERVICE_LINK_MISMATCH/);
});

test('chat playback serializes source changes, stops on failure, and never reports links', async () => {
  const events = [], reports = [];
  const bot = new ChatBot({
    stop: async () => events.push('stop'),
    playMusic: async ({ service }) => { events.push(service); throw new Error('PLAYBACK_NOT_STARTED'); },
    playVideo: async () => events.push('youtube'),
    report: result => reports.push(result),
  });
  bot.receive({ text: '/bot https://open.spotify.com/track/fixture123' });
  await bot.receive({ text: '/bot ytweb https://youtu.be/abcdefghijk' });
  assert.deepEqual(events, ['stop', 'spotify', 'stop', 'stop', 'youtube']);
  assert.deepEqual(reports.map(report => report.result), ['ERROR', 'STARTED']);
  assert.equal(JSON.stringify(reports).includes('https'), false);
  await bot.close();
  await bot.receive({ text: '/bot https://youtu.be/abcdefghijk' });
  assert.equal(events.at(-1), 'stop'); assert.equal(events.length, 6);
});

test('chat queue: play queues while playing, skip passes broken entries, advance, stop clears, no links echoed', async () => {
  for (const action of ['skip', 'queue', 'np', 'clear']) assert.deepEqual(parseBotCommand('/bot ' + action), { action });
  assert.deepEqual(parseBotCommand('/bot next'), { action: 'skip' });
  const events = [], said = [], prefetched = [];
  const bot = new ChatBot({
    stop: async () => events.push('stop'),
    playAudio: async command => { events.push('audio:' + command.search); if (command.search === 'broken') throw new Error('YOUTUBE_BLOCKED'); return 'Title ' + command.search; },
    playMusic: async command => { events.push('music:' + command.service); },
    pause: async () => { throw new Error('NOTHING_PLAYING'); },
    say: async text => said.push(text), prefetch: command => command && prefetched.push(command.search ?? command.service), report: () => {},
  });
  await bot.receive({ text: '/bot yt one' });
  for (const text of ['/bot yt broken', '/bot yt two', '/bot spotify https://open.spotify.com/track/fixture123']) await bot.receive({ text });
  assert.equal(bot.current.title, 'Title one');
  assert.deepEqual(said, ['Queued #1: "broken"', 'Queued #2: "two"', 'Queued #3: Spotify link']);
  assert.equal(prefetched[0], 'broken');
  await bot.receive({ text: '/bot queue' });
  assert.equal(said.at(-1), 'Queue: 1. "broken" · 2. "two" · 3. Spotify link');
  const stops = events.filter(event => event === 'stop').length;
  await bot.receive({ text: '/bot pause' });
  assert.equal(events.filter(event => event === 'stop').length, stops, 'a failed control command must not stop playback');
  await bot.receive({ text: '/bot skip' });
  assert.equal(bot.current.title, 'Title two'); assert.equal(bot.queue.length, 1);
  await bot.receive({ text: '/bot np' }); assert.equal(said.at(-1), 'Now playing: Title two');
  await bot.advance(); assert.equal(bot.current.service, 'spotify');
  await bot.advance(); assert.equal(bot.current, null); assert.equal(said.at(-1), 'Queue finished.');
  const count = events.length; await bot.advance(); assert.equal(events.length, count, 'advance is a no-op when nothing plays');
  for (const text of ['/bot yt a', '/bot yt b', '/bot yt c', '/bot stop']) await bot.receive({ text });
  assert.deepEqual(bot.queue, []); assert.equal(bot.current, null);
  for (let i = 0; i < 22; i++) await bot.receive({ text: '/bot yt x' + i });
  assert.equal(bot.queue.length, 20, 'queue is capped');
  await bot.receive({ text: '/bot clear' }); assert.deepEqual(bot.queue, []); assert.equal(said.at(-1), 'Queue cleared.');
  assert.equal(said.some(text => text.includes('https')), false);
  await bot.close();
});

test('volume, replay after stop, and chat replies for failed or unknown commands', async () => {
  assert.deepEqual(parseBotCommand('/bot volume 40'), { action: 'volume', level: 40 });
  assert.deepEqual(parseBotCommand('/bot vol 0%'), { action: 'volume', level: 0 });
  assert.deepEqual(parseBotCommand('/bot volume'), { action: 'volume' });
  assert.throws(() => parseBotCommand('/bot volume 101'), /BOT_VOLUME_INVALID/);
  const said = [], started = [], levels = [];
  const bot = new ChatBot({
    stop: async () => {}, playAudio: async command => { started.push(command.search); return 'T ' + command.search; },
    resume: async () => { throw new Error('NOTHING_PLAYING'); }, mute: async () => {},
    volume: async level => levels.push(level), say: async text => said.push(text), report: () => {},
  });
  await bot.receive({ text: '/bot resume' });
  assert.equal(said.at(-1), 'Nothing is playing. Try /bot yt <song>.');
  await bot.receive({ text: '/bot volume 30' }); assert.deepEqual(levels, [30]); assert.equal(said.at(-1), 'Volume: 30%');
  await bot.receive({ text: '/bot volume' }); assert.equal(said.at(-1), 'Volume: 30%');
  await bot.receive({ text: '/bot yt song' });
  await bot.receive({ text: '/bot stop' }); assert.equal(bot.current, null);
  await bot.receive({ text: '/bot play' });
  assert.deepEqual(started, ['song', 'song'], 'play after stop restarts the last track');
  assert.equal(bot.current.title, 'T song');
  await bot.receive({ text: '/bot stop' });
  await bot.receive({ text: '/bot unmute' }); assert.match(said.at(-1), /mic turns on when something plays/);
  await bot.receive({ text: '/bot https://example.com/song' }); assert.match(said.at(-1), /^Didn't understand that \(BOT_SERVICE_UNSUPPORTED\)/);
  await bot.close();
});

test('chat ignores rebuilt message nodes but accepts a new message with the same text', () => {
  let onMutation;
  const received = [];
  const message = (id, text) => ({
    getAttribute: name => name === 'data-message-id' ? id : null,
    closest: () => null, matches: () => false,
    querySelector: selector => selector === selectors.messageText ? { textContent: text } : null,
  });
  let nodes = [message('history', '/bot pause')];
  const context = {
    window: { companionChatMessage: async value => received.push(value.text) },
    document: { querySelectorAll: () => nodes }, selectors,
    MutationObserver: class { constructor(callback) { onMutation = callback; } observe() {} disconnect() {} },
  };
  runInNewContext(`(${observeMeetChat.toString()})(selectors)`, context);
  nodes.push(message('new', '/bot play')); onMutation();
  assert.deepEqual(received, ['/bot play']);
  nodes = [message('history', '/bot pause'), message('new', '/bot play')]; onMutation();
  assert.deepEqual(received, ['/bot play']);
  nodes.push(message('another', '/bot play')); onMutation();
  assert.deepEqual(received, ['/bot play', '/bot play']);
});

test('pause, resume, mute and help dispatch without replacing the current source', async () => {
  const events = [];
  const bot = new ChatBot({
    stop: async () => events.push('stop'), playMusic: async () => events.push('play'), playVideo: async () => events.push('video'),
    pause: async () => events.push('pause'), resume: async () => events.push('resume'),
    mute: async value => events.push(value ? 'mute' : 'unmute'), help: async () => events.push('help'), report() {},
  });
  for (const action of ['pause', 'resume', 'mute', 'unmute', 'help', 'stop']) await bot.receive({ text: '/bot ' + action });
  assert.deepEqual(events, ['pause', 'resume', 'mute', 'unmute', 'help', 'stop']);
});

test('resume turns the mic back on for yt-dlp audio and video, but not the ytweb share', async () => {
  const mic = [];
  const h = {
    driver: { configureMusicAudio: async () => {}, disableMedia: async () => mic.push('off'), unmute: async () => mic.push('on'), muted: async () => true, stopPresenting: async () => {}, present: async () => {}, sendChat: async () => {} },
    player: { evaluate: async () => {}, waitForFunction: async () => {}, goto: async () => {}, setViewportSize: async () => {} },
    meet: { evaluate: async () => true },
    server: { origin: 'http://127.0.0.1:3210', streamOnce: () => 'id', stopStreams() {} },
  };
  const actions = playback(h);
  const resolved = Promise.resolve({ link: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'T', ext: 'webm' });
  for (const command of [{ service: 'youtube', mode: 'audio', search: 's', resolved }, { service: 'youtube', mode: 'presentation', dlp: true, search: 's', resolved }]) {
    await (command.dlp ? actions.playVideo(command) : actions.playAudio(command));
    assert.equal(mic.at(-1), 'on', 'mic carries the track');
    await actions.pause(); assert.equal(mic.at(-1), 'off');
    await actions.resume(); assert.equal(mic.at(-1), 'on', 'resume must unmute the mic');
    await actions.stop();
  }
});

test('player controls include detached audio, preserve repeated pauses, and refuse missing routes', async () => {
  let available = true, deviceChange;
  class MediaElement {
    constructor(tagName = 'VIDEO') { Object.assign(this, { tagName, isConnected: false, paused: true, ended: false, currentTime: 10, readyState: 4 }); }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    async setSinkId(id) {
      if (this.switching) throw new DOMException('Overlapping switch', 'AbortError');
      this.switching = true; await Promise.resolve(); this.sinkId = id; this.switching = false;
    }
  }
  Object.defineProperty(MediaElement.prototype, 'muted', { configurable: true, get() { return this.silent ?? false; }, set(value) { this.silent = value; } });
  class Document { createElement(tag) { return new MediaElement(tag.toUpperCase()); } }
  class Element { attachShadow() {} }
  class AudioContext {
    constructor() { this.state = 'suspended'; }
    async setSinkId() { if (this.state === 'closed') throw new Error('CLOSED'); }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  const document = new Document();
  Object.assign(document, { querySelectorAll: () => [], addEventListener() {} });
  const context = {
    window: { Audio: MediaElement, AudioContext }, document, Document, Element, HTMLMediaElement: MediaElement,
    MutationObserver: class { observe() {} },
    navigator: { mediaDevices: { addEventListener(_name, callback) { deviceChange = callback; }, enumerateDevices: async () => available ? [{ kind: 'audiooutput', label: 'BlackHole 2ch', deviceId: 'fixture' }] : [] } },
  };
  runInNewContext(`(${playerInit.toString()})()`, context);
  const audio = new context.window.Audio(), video = document.createElement('video');
  video.isConnected = true;
  await Promise.all([audio.play(), audio.play(), video.play()]);
  const route = context.window.companionRoute;
  assert.equal(document.querySelectorAll().length, 0); // The fixture DOM query omits the detached song player.
  assert.equal(route.positions({ detachedOnly: true }).length, 1);
  await route.pause({ detachedOnly: true }); await route.pause({ detachedOnly: true });
  assert.equal(audio.paused, true); assert.equal(video.paused, true);
  await route.resume();
  assert.equal(audio.paused, false); assert.equal(video.paused, true);
  assert.equal(audio.sinkId, 'fixture');
  const closedContext = new context.window.AudioContext();
  await closedContext.resume(); await closedContext.close();
  deviceChange(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(route.status().error, null);
  assert.equal(audio.paused, false); // A harmless device notification must not stop music.
  await route.pause({ detachedOnly: true }); available = false;
  await assert.rejects(() => route.resume(), /BLACKHOLE_2CH_MISSING/);
  assert.equal(audio.paused, true);
  deviceChange(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(route.status().error, 'BLACKHOLE_2CH_MISSING');
  assert.equal(audio.muted, true);
});

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

test('stopping uses Meet presentation UI and never navigates while a share remains active', async () => {
  let presenting = true, menu = false, tracksStopped = false;
  const driver = new MeetDriver({
    locator: () => ({ isVisible: async () => presenting, click: async () => { menu = true; }, waitFor: async () => assert.equal(presenting, false) }),
    getByRole: () => ({ isVisible: async () => menu, click: async () => { assert.equal(menu, true); presenting = false; } }),
    evaluate: async () => { tracksStopped = true; },
  });
  await driver.stopPresenting();
  assert.equal(presenting, false); assert.equal(tracksStopped, true);
  let navigated = false;
  const actions = playback({ driver: { disableMedia: async () => {}, stopPresenting: async () => { throw new Error('PRESENTATION_STOP_UNVERIFIED'); } }, player: { goto: async () => { navigated = true; } }, server: { origin: 'http://127.0.0.1:3210' } });
  await assert.rejects(() => actions.stop(), /PRESENTATION_STOP_UNVERIFIED/);
  assert.equal(navigated, false);
});

test('presentation enforces tab audio, motion, bounded resolution and safe cloning', async () => {
  class Track {
    constructor() { this.kind = 'video'; this.readyState = 'live'; this.calls = 0; this.settings = { displaySurface: 'browser', width: 3840, height: 2160 }; }
    get contentHint() { return this.hint; } set contentHint(value) { this.hint = value; }
    getSettings() { return this.settings; }
    async applyConstraints(value) { this.calls++; this.constraints = value; this.settings.width = value.width.max; this.settings.height = value.height.max; this.settings.frameRate = value.frameRate.max; }
    clone() { const copy = new Track(); copy.settings = { ...this.settings }; return copy; }
    stop() { this.readyState = 'ended'; }
  }
  const video = new Track(), audio = { readyState: 'live', enabled: true, stop() { this.readyState = 'ended'; } };
  const stream = { getVideoTracks: () => [video], getAudioTracks: () => [audio], getTracks: () => [video, audio] };
  const context = { window: {}, MediaStreamTrack: Track, DOMException, navigator: { mediaDevices: { getDisplayMedia: async () => stream } } };
  runInNewContext(`(${presentationInit.toString()})()`, context);
  await assert.rejects(() => context.navigator.mediaDevices.getDisplayMedia(), /PRESENTATION_NOT_ARMED/);
  context.window.companionPresentation.arm(); await context.navigator.mediaDevices.getDisplayMedia();
  assert.equal(video.contentHint, 'motion'); assert.equal(video.getSettings().width, 1920);
  const copy = video.clone();
  assert.equal(copy.calls, 0); // Configuring a clone must not race the consumer's applyConstraints.
  copy.contentHint = 'detail';
  await copy.applyConstraints({ frameRate: 5, width: 3840, advanced: [{ width: { exact: 3840 } }] });
  assert.equal(copy.contentHint, 'motion'); assert.equal(copy.getSettings().frameRate, 30);
  assert.equal(copy.getSettings().width, 1920); assert.equal(copy.constraints.advanced, undefined);
  video.stop(); assert.equal(context.window.companionPresentation.status().active, true);
  context.window.companionPresentation.stop(); assert.equal(copy.readyState, 'ended');
  const rejectedVideo = new Track(); rejectedVideo.settings.displaySurface = 'window';
  stream.getVideoTracks = () => [rejectedVideo]; stream.getTracks = () => [rejectedVideo, audio];
  context.window.companionPresentation.arm();
  await assert.rejects(() => context.navigator.mediaDevices.getDisplayMedia(), /PRESENTATION_TAB_AUDIO_REQUIRED/);
  assert.equal(rejectedVideo.readyState, 'ended');
});

test('Meet media-off check handles controls hidden from accessibility and refuses unknown state', async () => {
  const visible = new Set([selectors.cameraOffControl, selectors.muteControl]);
  const pairs = new Map([[selectors.cameraOffControl, selectors.cameraOnControl], [selectors.muteControl, selectors.unmuteControl]]);
  const driver = new MeetDriver({ locator: key => ({
    first() { return this; },
    isVisible: async () => visible.has(key),
    evaluate: async action => action({ click() { visible.delete(key); visible.add(pairs.get(key)); } }),
    waitFor: async () => { if (!key.split(', ').some(selector => visible.has(selector))) throw new Error('fixture missing control'); },
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
  class MediaStream { constructor() { this.tracks = []; } addTrack(track) { this.tracks.push(track); } getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); } }
  class MediaElement { play() {} }
  class Document { createElement() {} }
  class Element { attachShadow() {} }
  Object.defineProperty(MediaElement.prototype, 'muted', { configurable: true, get() { return this.silent ?? false; }, set(value) { this.silent = value; } });
  let reapplied;
  const inputTrack = { kind: 'audio', readyState: 'live', addEventListener() {}, getSettings() { return reapplied ?? captured.audio; }, async applyConstraints(value) { reapplied = value; } };
  const mediaDevices = {
    enumerateDevices: async () => available ? [{ kind: 'audioinput', label, deviceId: 'blackhole-fixture' }, { kind: 'videoinput', label: 'Real camera', deviceId: 'real-camera' }] : [],
    getUserMedia: async constraints => { captured = constraints; const stream = new MediaStream(); stream.addTrack(inputTrack); return stream; },
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
  await inputTrack.applyConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, advanced: [{ echoCancellation: true }] });
  for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
    assert.equal(reapplied[key], false); assert.equal(reapplied.advanced[0][key], false);
  }
  assert.equal(reapplied.deviceId.exact, 'blackhole-fixture');
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

test('Meet Web Audio output stays silent across constructor options and sink changes', async () => {
  class MediaElement { play() {} }
  Object.defineProperty(MediaElement.prototype, 'muted', { configurable: true, get() { return this.silent ?? false; }, set(value) { this.silent = value; } });
  class AudioContext {
    constructor(options = {}) { this.options = options; this.sinkId = options.sinkId ?? ''; }
    async setSinkId(sink) { this.sinkId = sink; }
    async close() { this.closed = true; }
  }
  class Document { createElement() {} }
  class Element { attachShadow() {} }
  const context = {
    window: { Audio: MediaElement, AudioContext, webkitAudioContext: AudioContext },
    navigator: { mediaDevices: { enumerateDevices: async () => [], getUserMedia: async () => {} } },
    HTMLMediaElement: MediaElement, Document, Element, setInterval() {},
    MutationObserver: class { observe() {} },
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }), querySelectorAll: () => [], addEventListener() {} },
  };
  runInNewContext(`(${meetInit.toString()})()`, context);
  for (const Constructor of [context.window.AudioContext, context.window.webkitAudioContext]) {
    const audio = new Constructor({ sinkId: 'blackhole-fixture', sampleRate: 48000 });
    assert.equal(audio.sinkId.type, 'none');
    assert.equal(audio.options.sampleRate, 48000);
    await audio.setSinkId('');
    assert.equal(audio.sinkId.type, 'none');
    await audio.setSinkId('blackhole-fixture');
    assert.equal(audio.sinkId.type, 'none');
  }
});
