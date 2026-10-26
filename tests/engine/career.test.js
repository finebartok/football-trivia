import test from 'node:test';
import assert from 'node:assert/strict';
import { careerClubs, careerTeams } from '../../js/engine/career.js';
import { buildHints } from '../../js/engine/hints.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('a career path is chronological even when the data is not', () => {
  const player = {
    teams: [
      { clubName: 'Liverpool FC', seasons: [2017, 2018, 2019] },
      { clubName: 'FC Basel 1893', seasons: [2013] },
      { clubName: 'Chelsea FC', seasons: [2014, 2015] },
      { clubName: 'ACF Fiorentina', seasons: [2015] },
    ],
  };
  assert.deepEqual(careerClubs(player), [
    'FC Basel 1893', 'Chelsea FC', 'ACF Fiorentina', 'Liverpool FC',
  ]);
});

test('a tie on the first season is settled by the last season', () => {
  const player = {
    teams: [
      { clubName: 'AS Roma', seasons: [2015, 2016, 2017] },
      { clubName: 'ACF Fiorentina', seasons: [2015] },
    ],
  };
  assert.deepEqual(careerClubs(player), ['ACF Fiorentina', 'AS Roma']);
});

test('teams without seasons keep their place after dated teams', () => {
  const player = {
    teams: [
      { clubName: 'Unknown FC' },
      { clubName: 'FC Barcelona', seasons: [2012] },
    ],
  };
  assert.deepEqual(careerClubs(player), ['FC Barcelona', 'Unknown FC']);
  assert.deepEqual(careerTeams(player).map((t) => t.clubName), careerClubs(player));
});

test('a real player path starts at his first club and ends at his latest', () => {
  const { players } = loadFixture();
  const salah = players.find((p) => p.name === 'Mohamed Salah');
  assert.deepEqual(careerClubs(salah), [
    'FC Basel 1893', 'Chelsea FC', 'ACF Fiorentina',
    'Associazione Sportiva Roma', 'Liverpool FC',
  ]);

  const messi = players.find((p) => p.name === 'Lionel Messi');
  assert.equal(careerClubs(messi)[0], 'FC Barcelona');
  assert.equal(careerClubs(messi).at(-1), 'Club Internacional de Fútbol Miami');
});

test('the career-clubs hint uses the same chronological path', () => {
  const { players, registry } = loadFixture();
  const salah = players.find((p) => p.name === 'Mohamed Salah');
  const hint = buildHints(salah, registry.windows['wc-2022'], registry)
    .find((h) => h.role === 'trail');
  assert.ok(hint);
  assert.equal(hint.value, careerClubs(salah).join(' → '));
});
