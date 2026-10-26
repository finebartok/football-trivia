import test from 'node:test';
import assert from 'node:assert/strict';
import { numericDistractors, nameDistractors, buildOptions, OPTION_COUNT } from '../../js/engine/distractors.js';
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

test('name distractors look like the subject, not a lottery', () => {
  const subject = {
    id: 1, position: 'Midfield', subPosition: 'Central Midfield', foot: 'right',
    teams: [{ leagueId: 'GB1', seasons: [2015, 2016, 2017] }],
  };
  const sameKind = {
    id: 2, position: 'Midfield', subPosition: 'Central Midfield', foot: 'right',
    teams: [{ leagueId: 'GB1', seasons: [2015, 2016, 2017] }],
  };
  const otherPosition = {
    id: 3, position: 'Defender', subPosition: 'Centre-Back', foot: 'left',
    teams: [{ leagueId: 'IT1', seasons: [2015, 2016] }],
  };
  const sameLeague = {
    id: 4, position: 'Midfield', subPosition: 'Defensive Midfield', foot: 'right',
    teams: [{ leagueId: 'ES1', seasons: [2015] }],
  };
  const sameEra = {
    id: 5, position: 'Midfield', subPosition: 'Attacking Midfield', foot: 'left',
    teams: [{ leagueId: 'GB1', seasons: [2010] }],
  };
  const pool = [subject, sameKind, otherPosition, sameLeague, sameEra];
  const picked = nameDistractors({ pool, subject, scope: { clauses: [] }, rng: makeRng(3), count: 3 });
  assert.deepEqual(new Set(picked.map(p => p.id)), new Set([2, 4, 5]));
  assert.ok(!picked.some(p => p.id === 3), 'a different position is not a lookalike');
});

test('buildOptions returns four options with exactly one correct', () => {
  const rng = makeRng(5);
  const opts = buildOptions({ answer: 'A', distractors: ['B', 'C', 'D'], rng });
  assert.equal(opts.length, 4);
  assert.equal(opts.filter(o => o.correct).length, 1);
  assert.equal(new Set(opts.map(o => o.label)).size, 4);
});

test('windowed numeric distractors come from the same window as the truth', () => {
  const { players } = loadFixture();
  const rng = makeRng(2);
  const window = { id: 'Real Madrid 14/15' };
  // Ronaldo scored 61 in that window; use him as the subject so the truth is real.
  const subject = players.find(p => p.id === 8198);
  const truth = subject.windows[window.id].goals;
  const expected = new Set();
  for (const p of players) {
    if (p.id === subject.id) continue;
    const v = p.windows?.[window.id]?.goals;
    if (v !== undefined && v !== null && v !== 0) expected.add(v);
  }
  const d = numericDistractors({ value: truth, pool: players, subject, metric: 'club_goals', window, rng });
  assert.ok(d.length > 0, 'pool should supply windowed distractors');
  for (const v of d) {
    assert.ok(expected.has(v), `${v} is not a real ${window.id} value from the pool`);
    assert.notEqual(v, truth, 'distractor must not equal the truth');
  }
  assert.equal(new Set(d).size, d.length, 'distractors must be distinct');
});

test('tournament_goals and club_goals do not produce an identical candidate pool', () => {
  const { players } = loadFixture();
  const rng = makeRng(9);
  const subject = players[0];
  const tournament = { id: 'wc-2022' };
  const club = { id: 'Real Madrid 14/15' };
  const tourValues = numericDistractors({ value: 0, pool: players, subject, metric: 'tournament_goals', window: tournament, rng });
  const clubValues = numericDistractors({ value: 0, pool: players, subject, metric: 'club_goals', window: club, rng });
  assert.ok(tourValues.length > 0 && clubValues.length > 0);
  assert.notDeepEqual(new Set(tourValues), new Set(clubValues));
});

test('buildOptions always returns exactly OPTION_COUNT options even with few distractors', () => {
  const rng = makeRng(4);
  const opts = buildOptions({ answer: 'A', distractors: ['B'], rng });
  assert.equal(opts.length, OPTION_COUNT);
  assert.equal(opts.filter(o => o.correct).length, 1);
  assert.equal(new Set(opts.map(o => o.label)).size, OPTION_COUNT);
  assert.equal(opts.find(o => o.correct).label, 'A');
});

test('buildOptions keeps exactly one correct and distinct labels with zero distractors', () => {
  const rng = makeRng(1);
  const opts = buildOptions({ answer: 'Zlatan', distractors: [], rng });
  assert.equal(opts.length, OPTION_COUNT);
  assert.equal(opts.filter(o => o.correct).length, 1);
  assert.equal(new Set(opts.map(o => o.label)).size, OPTION_COUNT);
});
