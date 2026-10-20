import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, pick } from '../../js/engine/rng.js';

test('seed 0 and seed 1 produce different sequences', () => {
  const rng0 = makeRng(0);
  const rng1 = makeRng(1);
  const v0 = Array.from({ length: 10 }, () => rng0());
  const v1 = Array.from({ length: 10 }, () => rng1());
  assert.notDeepEqual(v0, v1, 'seed 0 and seed 1 should not collide');
});

test('adjacent seeds (0-5) diverge', () => {
  const rngs = Array.from({ length: 6 }, (_, i) => makeRng(i));
  const sequences = rngs.map(r => Array.from({ length: 10 }, () => r()));
  
  for (let i = 0; i < sequences.length; i++) {
    for (let j = i + 1; j < sequences.length; j++) {
      assert.notDeepEqual(sequences[i], sequences[j], `seed ${i} and ${j} collided`);
    }
  }
});

test('non-numeric or missing seeds are handled consistently', () => {
  const inputs = [undefined, null, NaN, 'not-a-number', {}];
  const results = inputs.map(seed => {
    const rng = makeRng(seed);
    return Array.from({ length: 10 }, () => rng());
  });

  // Every invalid seed should result in the same fallback sequence (deterministic)
  for (let i = 1; i < results.length; i++) {
    assert.deepEqual(results[i], results[0], `invalid seed input ${inputs[i]} diverged from first fallback`);
  }
});

test('pick handles null, undefined, and empty arrays', () => {
  const rng = makeRng(1);
  assert.equal(pick(rng, null), null);
  assert.equal(pick(rng, undefined), null);
  assert.equal(pick(rng, []), null);
});

test('pick still works for valid arrays', () => {
  const rng = makeRng(1);
  const arr = [1, 2, 3];
  const res = pick(rng, arr);
  assert.ok(arr.includes(res), `pick returned ${res} which is not in ${arr}`);
});
