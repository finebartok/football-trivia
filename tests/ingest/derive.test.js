import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveStints, deriveWindows } from '../../scripts/ingest/derive.js';

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

test('a club-season window carries the exact goals scored in it', () => {
  const { windows, windowStats } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2015 },
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2015, year: 2016 },
    ],
    games: [],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: { ES1: { id: 'ES1', name: 'laliga', type: 'domestic_league' } },
  });

  const w = windows.find(x => x.kind === 'season' && x.clubId === 5 && x.seasonStart === 2014);
  assert.ok(w, 'a club-season window must exist');
  assert.equal(w.label, 'FC Barcelona 2014/15');

  const stat = windowStats.find(s => s.windowId === w.id && s.metric === 'goals');
  assert.equal(stat.value, 1);
  assert.equal(stat.exact, true);

  // the next season is its own window, not more goals in the first one
  const w2 = windows.find(x => x.kind === 'season' && x.clubId === 5 && x.seasonStart === 2015);
  const stat2 = windowStats.find(s => s.windowId === w2.id && s.metric === 'goals');
  assert.equal(stat2.value, 1);
});

test('a tournament window counts only that competition', () => {
  const { windows, windowStats } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'FIWC', season: 2022, year: 2022 },
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2022, year: 2022 },
    ],
    games: [],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: {
      FIWC: { id: 'FIWC', name: 'world-cup', type: 'national_team_competition' },
      ES1: { id: 'ES1', name: 'laliga', type: 'domestic_league' },
    },
  });

  const w = windows.find(x => x.kind === 'tournament' && x.tournamentId === 'wc-2022');
  assert.ok(w);
  const stat = windowStats.find(s => s.windowId === w.id && s.metric === 'goals');
  assert.equal(stat.value, 1);
});

test('window ids are deterministic and collision free across clubs', () => {
  const { windows } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2014 },
      { playerSourceKey: '1', clubId: 9, competitionId: 'GB1', season: 2014, year: 2014 },
    ],
    games: [],
    clubsById: {
      5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' },
      9: { id: 9, name: 'Arsenal FC', leagueId: 'GB1' },
    },
    competitionsById: {
      ES1: { id: 'ES1', name: 'laliga', type: 'domestic_league' },
      GB1: { id: 'GB1', name: 'premier-league', type: 'domestic_league' },
    },
  });
  const seasonWindows = windows.filter(w => w.kind === 'season');
  assert.equal(new Set(seasonWindows.map(w => w.id)).size, seasonWindows.length);
  assert.ok(seasonWindows.every(w => w.id.includes('-')));
});

test('the same window carries separate stats per player', () => {
  const { windowStats } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2015 },
      { playerSourceKey: '2', clubId: 5, competitionId: 'ES1', season: 2014, year: 2015 },
      { playerSourceKey: '2', clubId: 5, competitionId: 'ES1', season: 2014, year: 2015 },
    ],
    games: [],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: { ES1: { id: 'ES1', name: 'laliga', type: 'domestic_league' } },
  });
  const goals = windowStats.filter(s => s.windowId === '5-2014' && s.metric === 'goals');
  assert.equal(goals.find(s => s.playerSourceKey === '1').value, 1);
  assert.equal(goals.find(s => s.playerSourceKey === '2').value, 2);
});

test('a domestic league never produces a tournament window', () => {
  const { windows } = deriveWindows({
    goals: [{ playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2022, year: 2022 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: { ES1: { id: 'ES1', name: 'laliga', type: 'domestic_league' } },
  });
  assert.equal(windows.filter(w => w.kind === 'tournament').length, 0);
});

test('a window is never invented: an unknown club or missing season yields none', () => {
  const { windows } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 99, competitionId: 'ES1', season: 2014, year: 2014 },
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: null, year: 2014 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: { ES1: { id: 'ES1', name: 'laliga', type: 'domestic_league' } },
  });
  assert.equal(windows.length, 0);
});

test('goals since a season and the career window are totalled per player', () => {
  const { windows, windowStats } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2010, year: 2011 },
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2015 },
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2016, year: 2017 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: { ES1: { id: 'ES1', name: 'laliga', type: 'domestic_league' } },
  });
  const career = windows.find(w => w.id === 'career');
  assert.ok(career, 'a career window must exist');
  assert.equal(windowStats.find(s => s.windowId === 'career' && s.metric === 'goals').value, 3);
  const since = windowStats.find(s => s.windowId === 'since-2014' && s.metric === 'goals_since_2014');
  assert.equal(since.value, 2, '2014 and 2016 count, 2010 does not');
});

test('an appearance adds to the same club-season window as a goal', () => {
  const { windowStats } = deriveWindows({
    goals: [{ playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2015 }],
    appearances: [
      { playerSourceKey: '1', clubId: 5, season: 2014 },
      { playerSourceKey: '1', clubId: 5, season: 2014 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: {},
  });
  const apps = windowStats.find(s => s.windowId === '5-2014' && s.metric === 'appearances');
  assert.equal(apps.value, 2);
  const goals = windowStats.find(s => s.windowId === '5-2014' && s.metric === 'goals');
  assert.equal(goals.value, 1);
});

test('the age band sums goals scored after the player turned 30', () => {
  const { windows, windowStats } = deriveWindows({
    appearances: [
      // born 1990, so 29 in 2019 and 30 in 2020
      { playerSourceKey: '1', clubId: 5, season: 2019, year: 2019, goals: 7 },
      { playerSourceKey: '1', clubId: 5, season: 2020, year: 2020, goals: 5 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: {},
    dobById: { 1: '1990-03-15' },
  });

  const w = windows.find(x => x.kind === 'age_band');
  assert.ok(w, 'an age-band window must exist');
  assert.equal(w.id, 'age-30');
  assert.equal(w.label, 'players aged 30+');
  assert.equal(w.ageFrom, 30);
  assert.equal(w.ageTo, null);

  const stat = windowStats.find(s => s.windowId === 'age-30' && s.metric === 'goals_after_age_30');
  assert.equal(stat.value, 5, 'only the 2020 goals are aged 30+');
});

test('the age band is windowed, not career-true', () => {
  const { windowStats } = deriveWindows({
    appearances: [{ playerSourceKey: '1', clubId: 5, season: 2020, year: 2020, goals: 5 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: {},
    dobById: { 1: '1990-03-15' },
  });
  const stat = windowStats.find(s => s.metric === 'goals_after_age_30');
  assert.equal(stat.exact, false, 'a windowed metric is never career-true');
});

test('the age band only counts the 2012+ window, and only players with a DOB', () => {
  const { windowStats } = deriveWindows({
    appearances: [
      { playerSourceKey: '1', clubId: 5, season: 2010, year: 2010, goals: 9 },
      { playerSourceKey: '1', clubId: 5, season: 2013, year: 2013, goals: 4 },
      { playerSourceKey: '2', clubId: 5, season: 2013, year: 2013, goals: 6 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: {},
    dobById: { 1: '1980-01-01' }, // player 2 has no DOB and is skipped
  });
  const stats = windowStats.filter(s => s.metric === 'goals_after_age_30');
  assert.equal(stats.length, 1, 'no DOB means no age band, never a fabricated 0');
  assert.equal(stats[0].playerSourceKey, '1');
  assert.equal(stats[0].value, 4, 'the 2010 goal is outside the 2012+ window');
});
