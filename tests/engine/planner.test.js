import test from 'node:test';
import assert from 'node:assert/strict';
import { planQuiz, MIN_POOL } from '../../js/engine/planner.js';
import { recipesFor } from '../../js/engine/recipes.js';
import { loadFixture } from '../../js/engine/fixture.js';

const scope = {
  v: 2, name: 'La Liga 2010s',
  clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }],
};

const wcScope = {
  v: 2, name: 'World Cup 2022',
  clauses: [{ tournaments: ['wc-2022'] }],
};

test('a plan has the requested number of rounds', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 1, rounds: 10 });
  assert.equal(plan.rounds.length, 10);
  assert.equal(plan.summary.rounds, 10);
});

test('the same seed produces an identical plan', () => {
  const { players, registry } = loadFixture();
  const a = planQuiz({ scope, pool: players, registry, seed: 99, rounds: 10 });
  const b = planQuiz({ scope, pool: players, registry, seed: 99, rounds: 10 });
  assert.deepEqual(a.rounds.map(r => r.subjectId), b.rounds.map(r => r.subjectId));
  assert.deepEqual(a.rounds.map(r => r.prompt), b.rounds.map(r => r.prompt));
});

test('a different seed produces a materially different plan', () => {
  const { players, registry } = loadFixture();
  const a = planQuiz({ scope, pool: players, registry, seed: 1, rounds: 10 });
  const b = planQuiz({ scope, pool: players, registry, seed: 2, rounds: 10 });
  const same = a.rounds.filter((r, i) => r.subjectId === b.rounds[i]?.subjectId).length;
  assert.ok(same / a.rounds.length < 0.5, 'a new seed should change most of the plan');
});

test('no subject is asked about twice', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 5, rounds: 10 });
  const ids = plan.rounds.map(r => r.subjectId);
  assert.equal(new Set(ids).size, ids.length);
});

test('a stat metric does not repeat consecutively when another stat recipe exists', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({
    scope: wcScope,
    pool: players,
    registry,
    seed: 1,
    rounds: 10,
    phases: ['v1.1'],
    statRounds: 3,
  });
  const stats = plan.rounds.map((r, i) => ({ i, template: r.template, metric: r.metric }));
  assert.equal(stats.filter((r) => r.template === 'stat_value').length, 3);
  for (let i = 1; i < stats.length; i++) {
    const a = stats[i - 1];
    const b = stats[i];
    if (a.template !== 'stat_value' || b.template !== 'stat_value') continue;
    assert.notEqual(a.metric, b.metric,
      `stat metric repeated at rounds ${i} and ${i + 1}`);
  }
});

test('a ten-round v1.2 quiz has three stat rounds and seven identity rounds', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({
    scope, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  const templates = plan.rounds.map((r) => r.template);
  assert.equal(templates.filter((t) => t === 'stat_value').length, 3);
  assert.equal(templates.filter((t) => t === 'identify').length, 7);
});

test('the same seed puts the stat rounds in the same places', () => {
  const { players, registry } = loadFixture();
  const make = (seed) => planQuiz({
    scope, pool: players, registry, seed, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  assert.deepEqual(
    make(1).rounds.map((r) => r.template),
    make(1).rounds.map((r) => r.template),
  );
});

test('a different seed can move the stat rounds', () => {
  const { players, registry } = loadFixture();
  const places = (seed) => planQuiz({
    scope, pool: players, registry, seed, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  }).rounds.map((r, i) => (r.template === 'stat_value' ? i : -1)).filter((i) => i >= 0);
  assert.notDeepEqual(places(1), places(2));
});

test('statRounds 0 keeps the v1 identity-only quiz', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({
    scope, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 0,
  });
  assert.ok(plan.rounds.every((r) => r.template === 'identify'));
});

test('a pool without stat data falls back to identity', () => {
  const { players, registry } = loadFixture();
  const late = {
    v: 2, name: 'Late Bloomers',
    clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 50 }] }],
  };
  const plan = planQuiz({
    scope: late, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  assert.equal(plan.rounds.length, 10);
  assert.ok(plan.rounds.every((r) => r.template === 'identify'));
});

test('the plan asks about different people, and gives different clues', () => {
  // v1 asks one kind of question - "Who is this?" - so the variety is in
  // the people and the clues, not in the question.
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 7, rounds: 10 });
  assert.equal(new Set(plan.rounds.map((r) => r.template)).size, 1, 'one kind of question');
  assert.equal(new Set(plan.rounds.map((r) => r.subjectId)).size, 10, 'ten different people');

  const cluesOf = (r) => r.clues.map((c) => `${c.label}=${c.value}`).join(' | ');
  assert.ok(
    plan.rounds.some((r) => cluesOf(r) !== cluesOf(plan.rounds[0])),
    'the rounds are not the same question ten times',
  );
});

test('a scope below the pool floor is refused with the count', () => {
  const { players, registry } = loadFixture();
  assert.throws(
    () => planQuiz({ scope: { clauses: [{ leagues: ['ZZ9'] }] }, pool: players, registry, seed: 1 }),
    (err) => err instanceof Error && /below the floor/.test(err.message),
  );
});

test('MIN_POOL is 20', () => {
  assert.equal(MIN_POOL, 20);
});

test('the difficulty curve never goes backwards', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 13, rounds: 10, difficulty: 'medium' });
  for (let i = 1; i < plan.rounds.length; i++) {
    assert.ok(plan.rounds[i].revealSchedule.length >= plan.rounds[i - 1].revealSchedule.length,
      `round ${i + 1} reveals fewer stages than round ${i}`);
  }
});

test('a hard plan reveals more stages than an easy one', () => {
  const { players, registry } = loadFixture();
  const easy = planQuiz({ scope, pool: players, registry, seed: 21, rounds: 10, difficulty: 'easy' });
  const hard = planQuiz({ scope, pool: players, registry, seed: 21, rounds: 10, difficulty: 'hard' });
  const last = r => r.rounds[r.rounds.length - 1].revealSchedule.length;
  assert.ok(last(hard) >= last(easy));
});

test('the v1 game is guess-the-player only', () => {
  // The v1 spec: "Guess the Player only in v1" (D4), and T2 stat_value
  // is listed as out of scope for v1 - it arrives in Phase 7.
  const quiz = planQuiz({
    scope: { clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] },
    pool: loadFixture().players,
    registry: loadFixture().registry,
    seed: 7,
    rounds: 10,
    difficulty: 'medium',
  });
  const templates = new Set(quiz.rounds.map((r) => r.template));
  assert.deepEqual([...templates], ['identify']);
  for (const round of quiz.rounds) {
    assert.equal(round.prompt, 'Who is this?');
  }
});

test('the v1.1 templates are still there, waiting for their phase', () => {
  const recipes = recipesFor({
    template: 'stat_value',
    window: { kind: 'career' },
    pool: loadFixture().players,
    phases: ['v1.1'],
  });
  assert.ok(recipes.length > 0, 'the stat_value recipes exist');
  assert.ok(recipes.every((r) => r.phase === 'v1.1'), 'they are marked for a later phase');
});
