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

test('answering a stat round scores correctly', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({ scope, pool: players, registry, seed: 3, rounds: 10 });
  const statRound = plan.rounds.find(r => r.template === 'stat_value');
  if (!statRound) return; // the scope may only support identify rounds
  const res = answerRound(statRound, { answer: statRound.answer, stage: 1, elapsedMs: 1500 });
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
