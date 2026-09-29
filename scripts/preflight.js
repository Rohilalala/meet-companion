import { execFileSync } from 'node:child_process';
import { settings } from './settings.js';

const report = {
  checkedAt: new Date().toISOString(),
  scope: 'Local prerequisites only; no E0–E6 experiment was executed',
  platform: process.platform,
  architecture: process.arch,
  node: process.versions.node,
  blockers: [],
};
if (process.platform !== 'darwin' || process.arch !== 'arm64') report.blockers.push('MACOS_ARM64_REQUIRED');
if (process.versions.node.split('.')[0] !== '22') report.blockers.push('NODE_22_REQUIRED');

try {
  const { chrome } = await settings();
  const plist = chrome.replace('/MacOS/Google Chrome', '/Info.plist');
  report.chromeVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  report.dedicatedProfilePath = true;
} catch {
  report.blockers.push('CHROME_OR_PROFILE_CONFIG_INVALID');
}

try {
  const raw = execFileSync('/usr/sbin/system_profiler', ['SPAudioDataType', '-json'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
  const devices = JSON.parse(raw).SPAudioDataType.flatMap(group => group._items ?? []);
  const blackHole = devices.filter(device => /^BlackHole 2ch$/i.test(device._name));
  const defaults = devices.filter(device => device.coreaudio_default_audio_output_device === 'spaudio_yes' || device.coreaudio_default_audio_system_device === 'spaudio_yes');
  report.blackHoleInput = blackHole.some(device => Number(device.coreaudio_device_input) > 0);
  report.blackHoleOutput = blackHole.some(device => Number(device.coreaudio_device_output) > 0);
  report.blackHoleIsDefault = defaults.some(device => /blackhole/i.test(device._name));
  report.defaultOutputKnown = devices.some(device => device.coreaudio_default_audio_output_device === 'spaudio_yes');
  report.defaultAggregateNeedsReview = defaults.some(device => /multi.output|aggregate/i.test(device._name));
  if (!report.blackHoleInput || !report.blackHoleOutput) report.blockers.push('BLACKHOLE_2CH_MISSING');
  if (report.blackHoleIsDefault) report.blockers.push('BLACKHOLE_DEFAULT_OUTPUT_FORBIDDEN');
  if (!report.defaultOutputKnown) report.blockers.push('DEFAULT_OUTPUT_UNKNOWN');
  if (report.defaultAggregateNeedsReview) report.blockers.push('DEFAULT_AGGREGATE_MEMBERSHIP_REQUIRES_MANUAL_REVIEW');
} catch {
  report.blockers.push('AUDIO_DEVICES_UNKNOWN');
}

report.localPrerequisitesReady = report.blockers.length === 0;
report.liveExperimentsReady = false;
report.ownerSetupRequired = ['Dedicated bot accounts signed in by hand', 'Test meeting and cooperating hosts', 'Second receiver device', 'Spotify development app and Premium access'];
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.localPrerequisitesReady ? 0 : 1;
