import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../js/engine/rng.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('the same seed produces the same sequence', () => {
  const a = makeRng(1234);
  const b = makeRng(1234);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('different seeds diverge', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  const va = Array.from({ length: 10 }, () => a());
  const vb = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(va, vb);
});

test('rng values stay in range', () => {
  const r = makeRng(99);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('the fixture loads and is shaped as the contract says', () => {
  const { registry, players } = loadFixture();
  assert.ok(players.length > 20, 'the fixture must have enough players to test with');
  assert.ok(registry.leagues.ES1);
  const messi = players.find(p => p.name === 'Lionel Messi');
  assert.ok(messi, 'Messi must be in the fixture');
  assert.equal(messi.windows['wc-2022'].goals, 7);
  assert.ok(messi.teams.length >= 2, 'Messi must have a multi-club path');
});
