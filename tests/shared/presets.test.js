import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetById } from '../../js/presets.js';

test('every preset has an id, a name and clauses', () => {
  assert.ok(PRESETS.length >= 7, 'there are at least seven vibes');
  const ids = new Set();
  for (const p of PRESETS) {
    assert.ok(p.id, 'a preset has an id');
    assert.ok(p.name, 'a preset has a name');
    assert.ok(Array.isArray(p.clauses) && p.clauses.length > 0, 'a preset has clauses');
    assert.equal(ids.has(p.id), false, `preset id ${p.id} is unique`);
    ids.add(p.id);
  }
});

test('a preset can be found by its id', () => {
  const first = PRESETS[0];
  assert.equal(presetById(first.id)?.name, first.name);
  assert.equal(presetById('no-such-vibe'), null);
});

test('the client re-exports the same presets', async () => {
  // The browser imports the presets through client/src/pool.js. That module
  // uses an absolute path, so it is read as text rather than imported.
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../../client/src/pool.js', import.meta.url), 'utf8'));
  assert.match(src, /from '\/js\/presets\.js'/);
});
