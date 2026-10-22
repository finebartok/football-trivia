#!/usr/bin/env node
// Copy the game into dist/ - exactly the game, and nothing else.
//
// The repository also holds the pre-v1 game: an index.html at the root,
// its own scripts under js/, and the raw data under data/raw. Publishing
// the repository as it stands would publish a second, older game with
// fabricated players in it, on the same address. So the files that go out
// are written down here, and everything else stays at home.
//
// There is no build: the browser loads the same files the repository
// holds. This only chooses which of them are public.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

// The client, the engine, the presets, the shared library and the player
// pool. The paths are absolute in the browser, so dist/ is the web root.
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

// The game lives at /client/. The root of the site sends you there, so the
// address that gets shared does not have to end in /client/.
await writeFile(join(out, 'index.html'), [
  '<!doctype html>',
  '<meta charset="utf-8">',
  '<title>Football Trivia</title>',
  '<meta http-equiv="refresh" content="0; url=/client/">',
  '<a href="/client/">Football Trivia</a>',
  '',
].join('\n'));

console.log(`published ${FILES.length} paths into dist/`);
