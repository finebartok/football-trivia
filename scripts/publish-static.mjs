#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

// The laziest, most robust layout: the game lives at the root.
// No redirects, no subfolders, no loops.
const FILES = [
  ['client', '.'], // Copy CONTENTS of client/ to dist/
  ['js/engine', 'js/engine'],
  ['js/presets.js', 'js/presets.js'],
  ['lib', 'lib'],
  ['data/fixtures/pool.sample.json', 'data/fixtures/pool.sample.json'],
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

console.log(`published ${FILES.length} paths into dist/`);
