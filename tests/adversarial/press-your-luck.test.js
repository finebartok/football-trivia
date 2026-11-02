import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRound } from '../../js/engine/questions.js';
import { loadFixture } from '../../js/engine/fixture.js';
import { makeRng } from '../../js/engine/rng.js';

test('adversarial: teammate_trail falls back to mixed when subject has no teammates', () => {
  const { players, registry } = loadFixture();
  // Create a subject with no teams
  const lonely = {
    id: 999,
    name: 'Lonely Player',
    position: 'Forward',
    teams: [],
    windows: {},
    stats: {},
  };
  const pool = [lonely, ...players];
  
  const round = composeRound({
    subject: lonely,
    metric: 'identity',
    window: registry.windows['wc-2022'],
    scope: { clauses: [] },
    registry,
    pool,
    rng: makeRng(1),
    stages: 4,
    clueFamily: 'teammate_trail',
  });

  assert.equal(round.clueFamily, 'mixed', 'should fall back to mixed if teammates are unavailable');
});

test('adversarial: composeRound handles extreme stage counts without crashing', () => {
  const { players, registry } = loadFixture();
  const subject = players[0];
  
  const zeroStages = composeRound({
    subject,
    metric: 'identity',
    window: registry.windows['wc-2022'],
    scope: { clauses: [] },
    registry,
    pool: players,
    rng: makeRng(1),
    stages: 0,
  });
  assert.ok(zeroStages.clues.length >= 1, 'should always have at least one clue');

  const hugeStages = composeRound({
    subject,
    metric: 'identity',
    window: registry.windows['wc-2022'],
    scope: { clauses: [] },
    registry,
    pool: players,
    rng: makeRng(1),
    stages: 100,
  });
  assert.ok(hugeStages.clues.length <= 10, 'should be capped by available hints');
});

test('adversarial: composeRound handles unknown clue family gracefully', () => {
  const { players, registry } = loadFixture();
  const subject = players[0];
  
  const round = composeRound({
    subject,
    metric: 'identity',
    window: registry.windows['wc-2022'],
    scope: { clauses: [] },
    registry,
    pool: players,
    rng: makeRng(1),
    stages: 4,
    clueFamily: 'invalid_family_name',
  });

  assert.equal(round.clueFamily, 'mixed', 'unknown family should default to mixed');
});
