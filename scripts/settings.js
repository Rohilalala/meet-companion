import { access, readFile, realpath, readlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { platform } from './platform.js';
export { requireRuntime } from './platform.js';

export const root = fileURLToPath(new URL('../', import.meta.url));

async function canonical(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(await canonical(dirname(path)), path.slice(dirname(path).length));
  }
}

export async function settings() {
  let raw;
  try {
    raw = await readFile(join(root, 'config.local.json'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    raw = await readFile(join(root, platform?.id === 'linux' ? 'config.example.linux.json' : 'config.example.json'), 'utf8');
  }
  const config = JSON.parse(raw);
  for (const key of ['chromePath', 'userDataDir']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error('CONFIG_INVALID');
  }
  const profile = await canonical(resolve(root, config.userDataDir));
  // The owner's everyday Chrome profile must never be used by the bot.
  const ownerProfile = await canonical(platform.ownerProfile);
  if (profile === sep || profile === ownerProfile || profile.startsWith(ownerProfile + sep) || ownerProfile.startsWith(profile + sep)) {
    throw new Error('DEFAULT_CHROME_PROFILE_FORBIDDEN');
  }
  const chrome = await canonical(resolve(root, config.chromePath));
  if (!platform.brandedChrome(chrome)) throw new Error('BRANDED_CHROME_REQUIRED');
  await access(chrome, constants.X_OK);
  const port = config.port ?? 3210;
  const debugPort = config.debugPort ?? 9223;
  if (![port, debugPort].every(value => Number.isInteger(value) && value >= 1024 && value <= 65535) || port === debugPort) throw new Error('CONFIG_INVALID');
  return { ...config, chrome, profile, port, debugPort };
}

export async function assertProfileAvailable(profile) {
  try {
    const lock = await readlink(join(profile, 'SingletonLock'));
    const pid = Number(lock.match(/-(\d+)$/)?.[1]);
    if (!pid || lock.slice(0, lock.lastIndexOf('-')) !== hostname()) throw new Error('BOT_PROFILE_LOCKED_CLOSE_CHROME_FIRST');
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    throw new Error('BOT_PROFILE_LOCKED_CLOSE_CHROME_FIRST');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
