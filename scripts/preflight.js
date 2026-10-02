import { execFileSync } from 'node:child_process';
import { settings } from './settings.js';
import { platform, requireRuntime } from './platform.js';

const report = {
  checkedAt: new Date().toISOString(),
  scope: 'Local prerequisites only; no E0–E6 experiment was executed',
  platform: process.platform,
  architecture: process.arch,
  node: process.versions.node,
  blockers: [],
};
try { requireRuntime(); } catch (error) { report.blockers.push(error.message); }

try {
  const { chrome } = await settings();
  report.chromeVersion = platform.chromeVersion(chrome);
  report.dedicatedProfilePath = true;
} catch {
  report.blockers.push('CHROME_OR_PROFILE_CONFIG_INVALID');
}

// The dedicated audio route: BlackHole 2ch on macOS, the meet_companion sink and mic on Linux.
try {
  const audio = platform.audio();
  Object.assign(report, { routeInput: audio.input, routeOutput: audio.output, routeIsDefault: audio.routeIsDefault, defaultOutputKnown: audio.defaultKnown, defaultAggregateNeedsReview: audio.aggregateNeedsReview });
  if (!audio.input || !audio.output) report.blockers.push(platform.route.missing);
  if (audio.routeIsDefault) report.blockers.push(platform.route.defaultForbidden);
  if (!audio.defaultKnown) report.blockers.push('DEFAULT_OUTPUT_UNKNOWN');
  if (audio.aggregateNeedsReview) report.blockers.push('DEFAULT_AGGREGATE_MEMBERSHIP_REQUIRES_MANUAL_REVIEW');
} catch {
  report.blockers.push('AUDIO_DEVICES_UNKNOWN');
}

// Optional YouTube audio route: report only, never blocks the other prerequisites.
try { report.ytDlp = execFileSync('yt-dlp', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch { report.ytDlp = 'YTDLP_MISSING'; }

report.localPrerequisitesReady = report.blockers.length === 0;
report.liveExperimentsReady = false;
report.ownerSetupRequired = ['Dedicated bot accounts signed in by hand', 'Test meeting and cooperating hosts', 'Second receiver device', 'Spotify development app and Premium access'];
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.localPrerequisitesReady ? 0 : 1;
