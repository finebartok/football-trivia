import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRound, candidateSubjects, informativeness } from '../../js/engine/questions.js';
import { makeRng } from '../../js/engine/rng.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('informativeness is zero for a value everybody shares', () => {
  assert.equal(informativeness(5, [5, 5, 5, 5]), 0);
  assert.ok(informativeness(5, [1, 2, 3, 5]) > 0);
});

test('candidate subjects carry a score and only subjects with a real value', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const cands = candidateSubjects({ scope: { clauses: [] }, pool: players, registry, window, metric: 'tournament_goals' });
  assert.ok(cands.length > 0);
  for (const c of cands) {
    assert.ok(typeof c.score === 'number');
    assert.ok(c.value > 0, 'a candidate with no value must not be offered');
  }
});

test('a composed round has four options, one correct, and four clues', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const cands = candidateSubjects({ scope: { clauses: [] }, pool: players, registry, window, metric: 'tournament_goals' });
  const rng = makeRng(42);
  const round = composeRound({
    subject: cands[0].subject, metric: 'tournament_goals', window,
    scope: { clauses: [] }, registry, pool: players, rng, difficulty: 'medium',
  });

  assert.equal(round.options.length, 4);
  assert.equal(round.options.filter(o => o.correct).length, 1);
  assert.ok(round.clues.length >= 3);
  assert.ok(round.prompt.length > 0);
  assert.equal(round.revealSchedule.length, round.clues.length);
});

test('the round answer equals the correct option', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const cands = candidateSubjects({ scope: { clauses: [] }, pool: players, registry, window, metric: 'tournament_goals' });
  const round = composeRound({
    subject: cands[0].subject, metric: 'tournament_goals', window,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1), difficulty: 'medium',
  });
  const correct = round.options.find(o => o.correct);
  assert.equal(String(correct.label), String(round.answer));
});
