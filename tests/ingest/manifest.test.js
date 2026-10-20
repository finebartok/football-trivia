import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readManifest, writeManifest, sha256File } from '../../scripts/ingest/lib/manifest.js';

test('manifest round-trips and records a real hash', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-'));
  const file = path.join(dir, 'thing.csv.gz');
  await fs.writeFile(file, 'hello');
  const hash = await sha256File(file);
  assert.equal(hash.length, 64);

  writeManifest(dir, { sources: { thing: { url: 'http://x/thing.csv.gz', sha256: hash, bytes: 5, fetchedAt: 1 } } });
  const m = readManifest(dir);
  assert.equal(m.sources.thing.sha256, hash);
  assert.equal(m.sources.thing.bytes, 5);
});

test('readManifest returns an empty manifest when the file is absent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-'));
  assert.deepEqual(readManifest(dir).sources, {});
});
