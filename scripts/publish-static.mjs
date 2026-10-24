#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

const FILES = [
  ['client', 'client'],
  ['js/engine', 'js/engine'],
  ['js/presets.js', 'js/presets.js'],
  ['lib', 'lib'],
  ['data/fixtures/pool.sample.json', 'data/fixtures/pool.sample.json'],
];

await rm(out, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const target = join(out, to);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, from), target, { recursive: true });
}

// Netlify redirects: send root to the client folder.
await writeFile(join(out, '_redirects'), '/  /client/  301');

console.log(`published ${FILES.length} paths into dist/`);
