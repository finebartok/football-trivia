import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRound, STAGE_MULTIPLIERS } from '../../js/engine/scoring.js';

test('an incorrect answer scores zero', () => {
  assert.equal(scoreRound({ correct: false, stage: 1, elapsedMs: 0 }).points, 0);
});

test('the fastest answer at stage 1 scores the maximum', () => {
  const r = scoreRound({ correct: true, stage: 1, elapsedMs: 1500 });
  assert.equal(r.multiplier, 5);
  assert.equal(r.timeFactor, 1.5);
  assert.equal(r.points, 7500);
});

test('the same answer later in the round scores less', () => {
  const early = scoreRound({ correct: true, stage: 1, elapsedMs: 1500 }).points;
  const late = scoreRound({ correct: true, stage: 1, elapsedMs: 20000 }).points;
  assert.ok(late < early, 'time must matter');
});

test('the same answer at a later stage scores less', () => {
  const s1 = scoreRound({ correct: true, stage: 1, elapsedMs: 1500 }).points;
  const s4 = scoreRound({ correct: true, stage: 4, elapsedMs: 1500 }).points;
  assert.ok(s4 < s1, 'the stage multiplier must matter');
});

test('the time factor never falls below 1 or rises above 1.5', () => {
  assert.equal(scoreRound({ correct: true, stage: 1, elapsedMs: 0 }).timeFactor, 1.5);
  assert.equal(scoreRound({ correct: true, stage: 1, elapsedMs: 999999 }).timeFactor, 1);
});

test('the multipliers are the ones the ladder shows', () => {
  assert.deepEqual(STAGE_MULTIPLIERS, { 1: 5, 2: 3, 3: 2, 4: 1 });
});
