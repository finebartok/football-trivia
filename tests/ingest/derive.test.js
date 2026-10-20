import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveStints } from '../../scripts/ingest/derive.js';

test('a transfer and an appearance for the same club-season collapse to one stint', () => {
  const { stints } = deriveStints({
    transfers: [{ playerSourceKey: '1', season: 2014, toClubName: 'FC Barcelona', toClubId: 5, fromClubName: null, fromClubId: null }],
    appearances: [{ playerSourceKey: '1', season: 2014, clubId: 5 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  const barcelona = stints.filter(s => s.clubId === 5);
  assert.equal(barcelona.length, 1);
  assert.equal(barcelona[0].evidence, 'appearance');
  assert.equal(barcelona[0].seasonStart, 2014);
});

test('consecutive seasons at one club collapse into one stint', () => {
  const { stints } = deriveStints({
    transfers: [],
    appearances: [
      { playerSourceKey: '1', season: 2014, clubId: 5 },
      { playerSourceKey: '1', season: 2015, clubId: 5 },
      { playerSourceKey: '1', season: 2016, clubId: 5 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  const barcelona = stints.filter(s => s.clubId === 5);
  assert.equal(barcelona.length, 1);
  assert.equal(barcelona[0].seasonStart, 2014);
  assert.equal(barcelona[0].seasonEnd, 2016);
});

test('a gap breaks a stint', () => {
  const { stints } = deriveStints({
    transfers: [],
    appearances: [
      { playerSourceKey: '1', season: 2014, clubId: 5 },
      { playerSourceKey: '1', season: 2016, clubId: 5 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  assert.equal(stints.filter(s => s.clubId === 5).length, 2);
});

test('an appearance outranks a transfer for the same club', () => {
  const clubsById = { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } };
  const { stints } = deriveStints({
    transfers: [{ playerSourceKey: '1', season: 2014, toClubId: 5, fromClubId: null }],
    appearances: [{ playerSourceKey: '1', season: 2014, clubId: 5 }],
    clubsById,
  });
  assert.equal(stints[0].evidence, 'appearance');
});

test('a transfer alone is recorded as transfer evidence', () => {
  const { stints } = deriveStints({
    transfers: [{ playerSourceKey: '1', season: 2014, toClubId: 5, fromClubId: null }],
    appearances: [],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  assert.equal(stints[0].evidence, 'transfer');
});

test('an unknown club id is dropped, and a missing league yields null', () => {
  const { stints, seasons } = deriveStints({
    transfers: [],
    appearances: [{ playerSourceKey: '1', season: 2014, clubId: 5 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona' } },
  });
  assert.equal(seasons[0].leagueId, null);
  const dropped = deriveStints({
    transfers: [],
    appearances: [{ playerSourceKey: '1', season: 2014, clubId: 99 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  assert.equal(dropped.stints.length, 0);
  assert.equal(stints.length, 1);
});

test('player_seasons carries the league for every player-club-season', () => {
  const { seasons } = deriveStints({
    transfers: [],
    appearances: [{ playerSourceKey: '1', season: 2014, clubId: 5 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  assert.deepEqual(seasons, [{ playerSourceKey: '1', season: 2014, clubId: 5, leagueId: 'ES1' }]);
});
