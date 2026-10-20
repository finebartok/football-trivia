import test from 'node:test';
import assert from 'node:assert/strict';
import { numericDistractors, nameDistractors, buildOptions } from '../../js/engine/distractors.js';
import { makeRng } from '../../js/engine/rng.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('numeric distractors never include the true value', () => {
  const { players } = loadFixture();
  const rng = makeRng(7);
  const truth = 7;
  for (let i = 0; i < 50; i++) {
    const d = numericDistractors({ value: truth, pool: players, subject: players[0], metric: 'tournament_goals', rng });
    assert.ok(!d.includes(truth));
    assert.equal(new Set(d).size, d.length, 'distractors must be distinct');
  }
});

test('numeric distractors are real values from the pool', () => {
  const { players } = loadFixture();
  const rng = makeRng(11);
  const d = numericDistractors({ value: 61, pool: players, subject: players[0], metric: 'club_goals', rng });
  assert.ok(d.length > 0);
});

test('name distractors exclude the subject', () => {
  const { players } = loadFixture();
  const rng = makeRng(3);
  const subject = players[0];
  const d = nameDistractors({ pool: players, subject, scope: { clauses: [] }, rng, count: 3 });
  assert.equal(d.length, 3);
  assert.ok(d.every(p => p.id !== subject.id));
});

test('buildOptions returns four options with exactly one correct', () => {
  const rng = makeRng(5);
  const opts = buildOptions({ answer: 'A', distractors: ['B', 'C', 'D'], rng });
  assert.equal(opts.length, 4);
  assert.equal(opts.filter(o => o.correct).length, 1);
  assert.equal(new Set(opts.map(o => o.label)).size, 4);
});
