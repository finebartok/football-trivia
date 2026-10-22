#!/usr/bin/env node
// Put the shared code where the deploy bundler can reach it.
//
// The edge functions plan the quiz and score the answers, so they need
// the engine. The engine lives in js/ because the browser needs it too,
// and the browser and the server must run the same code.
//
// But the deploy bundler only includes what is inside supabase/ - it
// skips an import that points outside the project root and then fails
// with "module not found" on a file that is right there. So the shared
// code is copied into supabase/functions/_shared/vendor/ before a
// deploy, and the functions import it from there.
//
// The copy is generated. It is never edited, never committed, and it is
// refreshed every time the functions are prepared.

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'supabase/functions/_shared/vendor');

// The same layout the repository has, because the engine and the shared
// library point at each other across the repository root and their
// relative paths have to keep working.
const FILES = [
  ['js/engine', 'js/engine'],
  ['js/presets.js', 'js/presets.js'],
  ['lib', 'lib'],
];

await rm(vendor, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const target = join(vendor, to);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, from), target, { recursive: true });
}

console.log(`prepared ${FILES.length} paths in supabase/functions/_shared/vendor/`);
