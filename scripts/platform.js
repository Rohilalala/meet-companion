import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Everything that differs between macOS (BlackHole + CoreAudio) and Linux (PulseAudio or PipeWire's pulse server).
// The audio route is one dedicated virtual device pair: the player tab outputs to it, the Meet tab uses it as its mic.
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });

const darwin = {
  id: 'darwin',
  // Chrome labels the device "BlackHole 2ch" or "BlackHole 2ch (Virtual)".
  route: { output: '^BlackHole 2ch(?: \\(Virtual\\))?$', input: '^BlackHole 2ch(?: \\(Virtual\\))?$', missing: 'BLACKHOLE_2CH_MISSING', defaultForbidden: 'BLACKHOLE_DEFAULT_OUTPUT_FORBIDDEN' },
  ownerProfile: join(homedir(), 'Library/Application Support/Google/Chrome'),
  brandedChrome: path => path.endsWith('/Google Chrome.app/Contents/MacOS/Google Chrome'),
  chromeVersion: chrome => run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', chrome.replace('/MacOS/Google Chrome', '/Info.plist')]).trim(),
  chromeArgs: [],
  lsof: '/usr/sbin/lsof',
  audio() {
    const devices = JSON.parse(run('/usr/sbin/system_profiler', ['SPAudioDataType', '-json'])).SPAudioDataType.flatMap(group => group._items ?? []);
    const defaults = devices.filter(device => device.coreaudio_default_audio_output_device === 'spaudio_yes' || device.coreaudio_default_audio_system_device === 'spaudio_yes');
    const route = devices.filter(device => /^BlackHole 2ch$/i.test(device._name));
    return {
      input: route.some(device => Number(device.coreaudio_device_input) > 0),
      output: route.some(device => Number(device.coreaudio_device_output) > 0),
      routeIsDefault: defaults.some(device => /blackhole/i.test(device._name)),
      defaultKnown: devices.some(device => device.coreaudio_default_audio_output_device === 'spaudio_yes'),
      aggregateNeedsReview: defaults.some(device => /multi.output|aggregate/i.test(device._name)),
    };
  },
};

// Names created by scripts/linux-audio.sh. Chrome shows the device.description as the label.
export const linuxAudio = { sink: 'meet_companion', sinkLabel: 'MeetCompanionSink', source: 'meet_companion_mic', sourceLabel: 'MeetCompanionMic', discard: 'meet_companion_discard' };
const linux = {
  id: 'linux',
  route: { output: `^${linuxAudio.sinkLabel}$`, input: `^${linuxAudio.sourceLabel}$`, missing: 'VIRTUAL_AUDIO_ROUTE_MISSING', defaultForbidden: 'VIRTUAL_SINK_DEFAULT_OUTPUT_FORBIDDEN' },
  ownerProfile: join(homedir(), '.config/google-chrome'),
  // /usr/bin/google-chrome-stable resolves to /opt/google/chrome/google-chrome; Chromium and Chrome for Testing are refused.
  brandedChrome: path => /^\/opt\/google\/chrome(?:-beta|-unstable)?\/(?:google-)?chrome$/.test(path),
  chromeVersion: chrome => run(chrome, ['--version']).replace(/^\D+/, '').trim(),
  // No desktop keyring on a server: without this Chrome can stall waiting for one.
  chromeArgs: ['--password-store=basic'],
  lsof: 'lsof',
  audio() {
    const names = list => run('pactl', ['list', 'short', list]).split('\n').map(line => line.split('\t')[1]).filter(Boolean);
    const sinks = names('sinks'), sources = names('sources');
    const defaultSink = run('pactl', ['get-default-sink']).trim(), defaultSource = run('pactl', ['get-default-source']).trim();
    return {
      input: sources.includes(linuxAudio.source),
      output: sinks.includes(linuxAudio.sink),
      // Fail closed: if the route were the default, any other program's sound, or Chrome's default mic, would reach the meeting.
      routeIsDefault: defaultSink === linuxAudio.sink || [linuxAudio.source, linuxAudio.sink + '.monitor'].includes(defaultSource),
      defaultKnown: !!defaultSink,
      aggregateNeedsReview: false,
    };
  },
};

export const platform = { darwin, linux }[process.platform] ?? null;

export function requireRuntime() {
  if (!platform || !['arm64', 'x64'].includes(process.arch) || (platform.id === 'darwin' && process.arch !== 'arm64')) throw new Error('UNSUPPORTED_PLATFORM');
  if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
}

// Shared by preflight and the live harness. Throws the first blocking code.
export function requireAudio(config = {}) {
  const audio = platform.audio();
  if (!audio.defaultKnown) throw new Error('DEFAULT_OUTPUT_UNKNOWN');
  if (audio.routeIsDefault) throw new Error(platform.route.defaultForbidden);
  if (audio.aggregateNeedsReview && config.defaultAggregateReviewed !== true) throw new Error('DEFAULT_AGGREGATE_REVIEW_REQUIRED');
  if (!audio.input || !audio.output) throw new Error(platform.route.missing);
}
