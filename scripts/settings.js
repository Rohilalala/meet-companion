import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

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
    raw = await readFile(join(root, 'config.example.json'), 'utf8');
  }
  const config = JSON.parse(raw);
  for (const key of ['chromePath', 'userDataDir']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error('CONFIG_INVALID');
  }
  const profile = await canonical(resolve(root, config.userDataDir));
  const ownerProfile = await canonical(join(homedir(), 'Library/Application Support/Google/Chrome'));
  if (profile === sep || profile === ownerProfile || profile.startsWith(ownerProfile + sep) || ownerProfile.startsWith(profile + sep)) {
    throw new Error('DEFAULT_CHROME_PROFILE_FORBIDDEN');
  }
  const chrome = await canonical(resolve(root, config.chromePath));
  if (!chrome.endsWith('/Google Chrome.app/Contents/MacOS/Google Chrome')) throw new Error('BRANDED_CHROME_REQUIRED');
  await access(chrome, constants.X_OK);
  return { chrome, profile };
}

export function requireRuntime() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('MACOS_ARM64_REQUIRED');
  if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
}
