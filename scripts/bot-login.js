import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { requireRuntime, settings, assertProfileAvailable } from './settings.js';

try {
  requireRuntime();
  const { chrome, profile } = await settings();
  await assertProfileAvailable(profile);
  const args = [
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'https://accounts.google.com/',
    'https://open.spotify.com/',
    'https://music.apple.com/',
    'https://music.youtube.com/',
  ];
  if (process.argv.includes('--dry-run')) {
    console.log('LOGIN_CONFIG_OK: branded Chrome; dedicated profile; four service tabs; no remote debugging or automation flags. Browser not started.');
  } else {
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => { console.error('CHROME_LAUNCH_FAILED'); process.exitCode = 1; });
    child.once('spawn', () => {
      child.unref();
      console.log('Chrome launch requested. Sign in by hand in the bot window. Fully close this dedicated browser before controller relaunch checks.');
    });
  }
} catch (error) {
  const allowed = ['NODE_22_REQUIRED', 'UNSUPPORTED_PLATFORM', 'DEFAULT_CHROME_PROFILE_FORBIDDEN', 'BRANDED_CHROME_REQUIRED', 'CONFIG_INVALID', 'BOT_PROFILE_LOCKED_CLOSE_CHROME_FIRST'];
  console.error(allowed.includes(error.message) ? error.message : 'LOGIN_CONFIG_OR_CHROME_UNAVAILABLE');
  process.exitCode = 1;
}
