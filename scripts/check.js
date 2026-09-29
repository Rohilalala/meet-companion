import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, requireRuntime } from './settings.js';
requireRuntime();
let checked = 0;
for (const directory of ['scripts', 'controller']) {
  for (const file of readdirSync(join(root, directory)).filter(file => file.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', join(root, directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
    checked++;
  }
}
console.log(`Syntax checked ${checked} ESM files.`);
