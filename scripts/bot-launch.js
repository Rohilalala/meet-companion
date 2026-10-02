import { spawn, execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { requireRuntime, settings, assertProfileAvailable } from './settings.js';

export async function launchBot({ headless = true, presentation = false, signals = true } = {}) {
  requireRuntime();
  const config = await settings();
  await assertProfileAvailable(config.profile);
  const reservation = createServer();
  await new Promise((resolve, reject) => reservation.once('error', () => reject(new Error('DEBUG_PORT_IN_USE'))).listen(config.debugPort, '127.0.0.1', resolve));
  await new Promise(resolve => reservation.close(resolve));
  await mkdir(config.profile, { recursive: true, mode: 0o700 });
  const presentationTitle = presentation ? 'Meet Companion Player ' + randomBytes(8).toString('hex') : null;
  const args = [
    `--user-data-dir=${config.profile}`, `--remote-debugging-port=${config.debugPort}`,
    '--remote-address=127.0.0.1', '--remote-debugging-address=127.0.0.1',
    '--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--no-first-run', '--no-default-browser-check',
    ...(presentation ? [`--auto-select-tab-capture-source-by-title=${presentationTitle}`] : []),
    '--window-size=1920,1080',
    ...(headless ? ['--headless=new', '--screen-info={0,0 1920x1080}'] : ['--window-position=-10000,-10000']), 'about:blank',
  ];
  const child = spawn(config.chrome, args, { stdio: 'ignore' });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  let browser, closing;
  const interrupted = async () => { await close(); process.exit(130); };
  const close = () => closing ??= (async () => {
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    if (browser?.isConnected()) {
      const cdp = await browser.newBrowserCDPSession().catch(() => null);
      await cdp?.send('Browser.close').catch(() => {});
      await browser.close().catch(() => {});
    }
    for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  })();
  // bot-run owns its shutdown (it must click Leave first), so it opts out of these handlers.
  if (signals) { process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted); }
  try {
    let listeners;
    for (let i = 0; i < 100; i++) {
      if (spawnFailed || child.exitCode !== null) throw new Error('BROWSER_CRASHED');
      try {
        const output = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(child.pid), `-iTCP:${config.debugPort}`, '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        listeners = output.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
      } catch { listeners = []; }
      if (listeners.length) break;
      await delay(100);
    }
    if (!listeners?.length) throw new Error('DEBUG_LISTENER_NOT_FOUND');
    if (listeners.some(value => value !== `127.0.0.1:${config.debugPort}` && value !== `[::1]:${config.debugPort}`)) throw new Error('DEBUG_LISTENER_NOT_LOOPBACK');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.debugPort}`, { timeout: 10000 });
    const context = browser.contexts()[0];
    // Only this dedicated process is attached. Close restored bot tabs before creating the two harness tabs.
    const meet = await context.newPage();
    const player = await context.newPage();
    for (const page of context.pages()) if (page !== meet && page !== player) await page.close();
    // How Chrome ended (exit code or signal), for diagnosing unexpected BROWSER_CRASHED stops.
    const chromeExit = () => ({ code: child.exitCode, signal: child.signalCode });
    return { config, browser, context, meet, player, close, chromeExit, presentationTitle, observation: { headless, loopbackOnly: true, attached: true, chromeVersion: browser.version(), tabs: 2 } };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bot = await launchBot({ headless: !process.argv.includes('--windowed') });
    console.log(JSON.stringify(bot.observation));
    if (process.argv.includes('--hold')) {
      const stop = async () => { await bot.close(); process.exit(0); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    } else await bot.close();
  } catch { console.error('BROWSER_LAUNCH_OR_ATTACH_FAILED'); process.exitCode = 1; }
}
