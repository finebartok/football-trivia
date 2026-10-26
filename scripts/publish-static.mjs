#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../js/presets.js';
import { buildLeanPool, buildMeta, buildPresetSlices } from './pool-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

// The laziest, most robust layout: the game lives at the root.
// No redirects, no subfolders, no loops.
const FILES = [
  ['client', '.'], // Copy CONTENTS of client/ to dist/
  ['js/engine', 'js/engine'],
  ['js/presets.js', 'js/presets.js'],
  ['lib', 'lib'],
];

await rm(out, { recursive: true, force: true });

for (const [from, to] of FILES) {
  const target = join(out, to);
  await mkdir(dirname(target), { recursive: true });

  // If 'to' is '.', we copy the contents of 'from' into 'out'
  if (to === '.') {
    await cp(join(root, from), out, { recursive: true });
  } else {
    await cp(join(root, from), target, { recursive: true });
  }
}

// The browser gets one small pool per preset plus a lean full pool for
// hand-built vibes. The fixture stays the complete input contract.
const pool = JSON.parse(await readFile(join(root, 'data/fixtures/pool.sample.json'), 'utf8'));
const slices = buildPresetSlices(pool, PRESETS);

await mkdir(join(out, 'data/fixtures'), { recursive: true });
await writeFile(
  join(out, 'data/fixtures/pool.sample.json'),
  JSON.stringify(buildLeanPool(pool)),
);

await mkdir(join(out, 'data/pools'), { recursive: true });
for (const slice of slices) {
  await writeFile(join(out, `data/pools/${slice.id}.json`), JSON.stringify(slice.data));
}
await writeFile(join(out, 'data/pools/meta.json'), JSON.stringify(buildMeta(slices)));

console.log(`published ${FILES.length} paths and ${slices.length} preset pools into dist/`);
