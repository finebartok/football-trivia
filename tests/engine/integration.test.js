import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuiz, answerRound } from '../../js/engine/index.js';
import { loadFixture } from '../../js/engine/fixture.js';

const scope = {
  v: 2, name: 'La Liga 2010s',
  clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }],
};

test('generateQuiz returns a playable plan', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({ scope, pool: players, registry, seed: 2024, rounds: 10 });
  assert.equal(plan.rounds.length, 10);
  for (const r of plan.rounds) {
    assert.equal(r.options.length, 4);
    assert.equal(r.options.filter(o => o.correct).length, 1);
    assert.ok(r.clues.length >= 3);
  }
});

test('generateQuiz forwards the stat mix', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({
    scope, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  assert.equal(plan.rounds.filter((r) => r.template === 'stat_value').length, 3);
  assert.equal(plan.rounds.filter((r) => r.template === 'identify').length, 7);
});

test('answering a stat round scores correctly', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({
    scope, pool: players, registry, seed: 3, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  const statRound = plan.rounds.find((r) => r.template === 'stat_value');
  assert.ok(statRound, 'the mix contains a stat round');
  assert.equal(statRound.options.length, 4);
  assert.equal(statRound.options.filter((o) => o.correct).length, 1);
  assert.ok(statRound.unit, 'the stat round carries a unit');
  const correct = statRound.options.find((o) => o.correct);
  const res = answerRound(statRound, { answer: correct.value, stage: 1, elapsedMs: 1500 });
  assert.equal(res.correct, true);
  assert.equal(res.points, 7500);
});

test('answering an identify round accepts the right name and rejects a wrong one', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({ scope, pool: players, registry, seed: 8, rounds: 10 });
  const idRound = plan.rounds.find(r => r.template === 'identify');
  if (!idRound) return;
  assert.equal(answerRound(idRound, { answer: idRound.subjectName, stage: 2, elapsedMs: 5000 }).correct, true);
  assert.equal(answerRound(idRound, { answer: 'Definitely Not A Player', stage: 2, elapsedMs: 5000 }).correct, false);
});

test('the engine imports cleanly with no DOM', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'the engine must not require a DOM');
});
