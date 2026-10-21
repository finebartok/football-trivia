import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRound, candidateSubjects, informativeness } from '../../js/engine/questions.js';
import { metricsFor } from '../../js/engine/stats.js';
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
  assert.equal(String(correct.value), String(round.answer));
});

test('a numeric option says what it counts', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const cands = candidateSubjects({ scope: { clauses: [] }, pool: players, registry, window, metric: 'tournament_goals' });
  const round = composeRound({
    subject: cands[0].subject, metric: 'tournament_goals', window,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1), difficulty: 'medium',
  });
  for (const opt of round.options) {
    assert.match(opt.label, /goals?$/, `option "${opt.label}" must name its unit`);
  }
  const correct = round.options.find(o => o.correct);
  assert.equal(correct.label, `${correct.value} goal${correct.value === 1 ? '' : 's'}`);
});

test('the clue ladder never reveals the stat round answer', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');

  // Tournament case: the exact answer number must not appear in any clue.
  const tWindow = registry.windows['wc-2022'];
  const tRound = composeRound({
    subject: messi, metric: 'tournament_goals', window: tWindow,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1),
  });
  assert.equal(tRound.template, 'stat_value');
  assert.equal(tRound.answer, 7);
  for (const c of tRound.clues) {
    assert.ok(!/\b7\b/.test(String(c.value ?? '')), `clue "${c.value}" reveals the tournament answer 7`);
  }

  // Windowed case: the answer number with a (since YYYY) suffix must not
  // appear in any clue, under any metric id that shares the same window.
  const sWindow = registry.windows['FC Barcelona 12/13'];
  assert.equal(sWindow.kind, 'season');
  const sRound = composeRound({
    subject: messi, metric: 'club_goals', window: sWindow,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1),
  });
  assert.equal(sRound.template, 'stat_value');
  assert.equal(sRound.answer, 60);
  for (const c of sRound.clues) {
    assert.ok(!/\b60\b/.test(String(c.value ?? '')), `clue "${c.value}" reveals the club_goals answer 60`);
  }
});

test('informativeness discriminates between values in the same pool', () => {
  assert.equal(informativeness(5, [5, 5, 5, 5]), 0);
  // A value shared by most of the pool scores low; a unique value scores high.
  assert.equal(informativeness(3, [5, 5, 3, 5]), 0.75);
  const shared = informativeness(5, [5, 5, 3, 5]); // 1 of 4 differs
  const unique = informativeness(3, [5, 5, 3, 5]);  // 3 of 4 differ
  assert.ok(shared > 0 && unique > 0);
  assert.ok(unique > shared, 'a unique value must be more informative than a shared one');
});

test('composeRound throws when the metric has no value for the subject', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const nobody = players.find(p => !(p.windows?.[window.id]?.goals > 0));
  assert.ok(nobody, 'fixture has a player without a wc-2022 goals value');
  assert.throws(
    () => composeRound({
      subject: nobody, metric: 'tournament_goals', window,
      scope: { clauses: [] }, registry, pool: players, rng: makeRng(1),
    }),
    /no value for metric/,
    'a missing metric must not reach buildOptions as "undefined"'
  );
});

test('composeRound throws when no recipe matches the metric for the window kind', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const sWindow = registry.windows['FC Barcelona 12/13']; // kind 'season'
  assert.equal(sWindow.kind, 'season');
  // tournament_goals has a recipe only for tournament windows, not season.
  assert.throws(
    () => composeRound({
      subject: messi, metric: 'tournament_goals', window: sWindow,
      scope: { clauses: [] }, registry, pool: players, rng: makeRng(1),
    }),
    /no recipe for metric/,
    'a round must not silently report a different metric than it asks'
  );
});

test('the reported metric and unit match the recipe actually used', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const window = registry.windows['wc-2022'];

  const round = composeRound({
    subject: messi, metric: 'tournament_goals', window,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1),
  });
  assert.equal(round.metric, 'tournament_goals');
  assert.equal(round.unit, 'goals');

  // An identify recipe reports metric 'identity' and a null unit.
  const idRound = composeRound({
    subject: messi, metric: 'identity', window,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1),
  });
  assert.equal(idRound.metric, 'identity');
  assert.equal(idRound.unit, null);
});

test('the ladder never leaks the answer through another metric (80 caps vs €80M)', () => {
  const { players, registry } = loadFixture();
  const dias = players.find(p => p.name === 'Rúben Dias');
  assert.ok(dias, 'Rúben Dias must be in the fixture');
  assert.equal(dias.internationalCaps, 80);
  assert.equal(dias.highestMarketValueEur, 80000000);

  const round = composeRound({
    subject: dias, metric: 'international_caps', window: undefined,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1),
  });
  assert.equal(round.template, 'stat_value');
  assert.equal(round.answer, 80);
  assert.equal(round.metric, 'international_caps');

  const nums = (s) => (String(s ?? '').match(/\d+/g) ?? []).map(Number);
  for (const c of round.clues) {
    assert.ok(!nums(c.value).includes(80), `clue "${c.value}" leaks the answer 80`);
  }
  assert.ok(!round.clues.some(c => c.label === 'International caps'), 'caps hint must not leak the answer');
  assert.ok(!round.clues.some(c => c.label === 'Peak market value'), 'market-value hint must not leak the answer');
});

test('metricsFor with a window never leaks a career total', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  assert.ok(messi.stats?.goals_after_age_30 !== undefined, 'fixture player must have a career goals_after_age_30');

  // With a window, a metric that only exists in the career block must not be
  // reported as a windowed value.
  const withWindow = metricsFor(messi, registry.windows['wc-2022']);
  assert.ok(!withWindow.some(m => m.id === 'goals_after_age_30'), 'windowed metricsFor must not dress a career total as windowed');

  // Without a window, the career total is a valid answer.
  const withoutWindow = metricsFor(messi, undefined);
  assert.ok(withoutWindow.some(m => m.id === 'goals_after_age_30' && m.value === messi.stats.goals_after_age_30),
    'no window: career total is the value');
});

test('a round whose every hint would reveal the answer still degrades safely', () => {
  const subject = {
    id: 1, name: 'Synthetic', internationalCaps: 7,
    internationalGoals: 0, highestMarketValueEur: 7000000,
    windows: {}, stats: {},
  };
  const round = composeRound({
    subject, metric: 'international_caps', window: undefined,
    scope: { clauses: [] },
    registry: { windows: {}, leagues: {}, clubs: [], tournaments: [] },
    pool: [subject], rng: makeRng(1),
  });
  assert.ok(round.clues.length >= 1, 'a round must keep at least one clue');
  assert.equal(round.revealSchedule.length, round.clues.length,
    'revealSchedule must match the clue count');
});
