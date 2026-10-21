import test from 'node:test';
import assert from 'node:assert/strict';
import { playerInScope, scopePool, statMatches } from '../../js/engine/scope.js';

const player = {
  id: 1, name: 'Test', nationality: 'England', position: 'Forward',
  citizenship: ['England'], teams: [
    { clubId: 10, clubName: 'Arsenal FC', leagueId: 'GB1', seasons: [2018, 2019] },
  ],
  tournaments: ['wc-2022'],
  stats: { goals_after_age_30: 0 },
  windows: {},
};

test('an empty clause list matches everything', () => {
  assert.equal(playerInScope(player, { clauses: [] }), true);
  assert.equal(playerInScope(player, { clauses: [{}] }), true);
});

test('a league clause matches on league id, not on display name', () => {
  assert.equal(playerInScope(player, { clauses: [{ leagues: ['GB1'] }] }), true);
  assert.equal(playerInScope(player, { clauses: [{ leagues: ['Premier League'] }] }), false);
});

test('era ranges are inclusive at both ends', () => {
  const edge = { ...player, teams: [{ clubId: 10, clubName: 'Arsenal FC', leagueId: 'GB1', seasons: [2019] }] };
  assert.equal(playerInScope(edge, { clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }] }), true,
    'the end year itself is inside the range');
  assert.equal(playerInScope(edge, { clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2018 }] }), false,
    'a year past the end is outside the range');
});

test('a tournament clause matches roster membership', () => {
  assert.equal(playerInScope(player, { clauses: [{ tournaments: ['wc-2022'] }] }), true);
  assert.equal(playerInScope(player, { clauses: [{ tournaments: ['wc-2026'] }] }), false);
});

test('clauses are ORed and predicates inside a clause are ANDed', () => {
  const scope = { clauses: [
    { leagues: ['ES1'] },
    { leagues: ['GB1'], positions: ['Defender'] },
  ] };
  assert.equal(playerInScope(player, scope), false, 'GB1 AND Defender must fail for a Forward');
  assert.equal(playerInScope(player, { clauses: [{ leagues: ['GB1'], positions: ['Forward'] }] }), true);
});

test('a missing metric never satisfies a numeric predicate', () => {
  assert.equal(statMatches({ metric: 'goals_after_age_30', op: '>=', value: 1 }, { goals_after_age_30: 0 }), false);
  assert.equal(statMatches({ metric: 'club_goals', op: '>=', value: 1 }, {}), false);
  assert.equal(statMatches({ metric: 'club_goals', op: '>=', value: 1 }, { club_goals: undefined }), false);
});

test('a genuine zero satisfies == 0 and fails >= 1', () => {
  assert.equal(statMatches({ metric: 'goals_after_age_30', op: '==', value: 0 }, { goals_after_age_30: 0 }), true);
  assert.equal(statMatches({ metric: 'goals_after_age_30', op: '>=', value: 1 }, { goals_after_age_30: 0 }), false);
});

test('scopePool returns only matching players', () => {
  const pool = [player, { ...player, id: 2, teams: [{ clubId: 11, clubName: 'FC Barcelona', leagueId: 'ES1', seasons: [2014] }] }];
  const out = scopePool({ clauses: [{ leagues: ['ES1'] }] }, pool);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 2);
});
