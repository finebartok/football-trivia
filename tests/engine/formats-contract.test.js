import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from '../../js/engine/fixture.js';
import { makeRng } from '../../js/engine/rng.js';
import {
  buildClubRound,
  buildComparisonRound,
  buildRangeRound,
  buildTeammateRound,
} from '../../js/engine/formats.js';
import { profileHints } from '../../js/engine/hints.js';

const { players, registry } = loadFixture();
const byId = new Map(players.map((player) => [player.id, player]));
const byName = new Map(players.map((player) => [player.name, player]));

function build(builder, seed = 1, pool = players) {
  return builder({
    pool,
    registry,
    window: null,
    scope: { clauses: [] },
    rng: makeRng(seed),
    difficulty: 'medium',
    stages: 4,
  });
}

function seasonStart(label) {
  return Number.parseInt(String(label).split('/')[0], 10);
}

function seasonKey(team, season) {
  const start = String(season).slice(-2).padStart(2, '0');
  const end = String(season + 1).slice(-2).padStart(2, '0');
  return `${team.clubName} ${start}/${end}`;
}

function eachRound(builder, seeds = 40) {
  const out = [];
  for (let seed = 1; seed <= seeds; seed += 1) {
    const round = build(builder, seed);
    if (round) out.push(round);
  }
  assert.ok(out.length > 0, `${builder.name} produced no rounds`);
  return out;
}

function clubIndexFor(pool) {
  const index = new Map();
  for (const player of pool) {
    for (const team of player.teams ?? []) {
      for (const season of team.seasons ?? []) {
        const key = `${team.clubId}|${season}`;
        if (!index.has(key)) {
          index.set(key, {
            clubId: team.clubId,
            clubName: team.clubName,
            leagueId: team.leagueId,
            season,
            players: new Set(),
          });
        }
        index.get(key).players.add(player.id);
      }
    }
  }
  return index;
}

const CLUB_INDEX = clubIndexFor(players);
const PROFILE_IDS = new Set(['role', 'born', 'home', 'height']);
const CLUB_FACT_IDS = new Set(['club-goals', 'club-squad', 'club-other']);

test('club contract: the clues describe the club-season and every option was in that league that season', () => {
  for (const round of eachRound(buildClubRound, 40)) {
    const subject = byId.get(round.subjectId);
    assert.ok(subject, 'the subject is in the pool');
    const season = seasonStart(round.reveal.season);
    const entries = (subject.teams ?? []).filter((team) => (team.seasons ?? []).includes(season));
    assert.equal(entries.length, 1, `${subject.name} has one club in ${round.reveal.season}`);
    const answerTeam = entries[0];
    assert.equal(round.answer, answerTeam.clubName);

    const optionNames = round.options.map((option) => option.value);
    assert.equal(new Set(optionNames).size, 4, 'the four options are distinct');
    assert.ok(optionNames.includes(round.answer));
    for (const name of optionNames) {
      assert.ok(
        [...CLUB_INDEX.values()].some((entry) => entry.clubName === name
          && entry.season === season
          && entry.leagueId === answerTeam.leagueId),
        `${name} was not in ${answerTeam.leagueId} in ${round.reveal.season}`,
      );
    }

    const ids = round.clues.map((clue) => clue.id);
    const facts = ids.filter((id) => CLUB_FACT_IDS.has(id));
    assert.ok(facts.length >= 2, `${round.prompt} has only ${facts.length} club-season clues`);
    assert.ok(CLUB_FACT_IDS.has(ids[0]), `${round.prompt} opens with ${ids[0]}`);
    assert.ok(!ids.includes('club-league'), 'the shared league is not a clue');
    const firstProfile = ids.findIndex((id) => PROFILE_IDS.has(id));
    if (firstProfile >= 0) {
      assert.equal(firstProfile, ids.length - 1, 'the profile fact is the last clue');
    }

    for (const clue of round.clues) {
      assert.ok(
        !clue.value.toLowerCase().includes(round.answer.toLowerCase()),
        `the clue "${clue.value}" names the answer club`,
      );
    }

    const goalsClue = round.clues.find((clue) => clue.id === 'club-goals');
    const goals = subject.windows?.[seasonKey(answerTeam, season)]?.goals;
    if (goalsClue) {
      assert.ok(goals > 0, 'the goals clue comes from a positive goals entry');
      assert.ok(goalsClue.value.includes(String(goals)));
      assert.ok(goalsClue.value.includes(round.reveal.season));
    }
    assert.ok(
      goalsClue || round.clues.some((clue) => clue.id === 'club-squad'),
      'every club round has a goals or squad clue',
    );

    const squadClue = round.clues.find((clue) => clue.id === 'club-squad');
    if (squadClue) {
      const name = squadClue.value.replace(/ was in the squad that season\.$/, '');
      const bucket = CLUB_INDEX.get(`${answerTeam.clubId}|${season}`);
      const teammate = players.find((player) => player.name === name
        && bucket?.players.has(player.id));
      assert.ok(
        teammate,
        `${name} was not in ${answerTeam.clubName} in ${round.reveal.season}`,
      );
    }

    const careerClue = round.clues.find((clue) => clue.id === 'club-other');
    if (careerClue) {
      const match = careerClue.value.match(/^Also played for (.+) in (\d{4}\/\d{2})\.$/);
      assert.ok(match, `unexpected career clue: ${careerClue.value}`);
      assert.ok(optionNames.includes(match[1]), 'the career clue names an option');
      assert.notEqual(match[1], round.answer);
      assert.notEqual(match[2], round.reveal.season);
    }
  }
});

test('regression: Mikel Villanueva gets club-season clues and same-league options', () => {
  const mikel = byName.get('Mikel Villanueva');
  const atClub = (clubId, season) => players.find((player) => (player.teams ?? [])
    .some((team) => team.clubId === clubId && (team.seasons ?? []).includes(season)));
  const malagaMates = players
    .filter((player) => player.id !== mikel.id && (player.teams ?? [])
      .some((team) => team.clubId === 310 && (team.seasons ?? []).includes(2018)))
    .slice(0, 3);
  const pool = [
    mikel,
    ...malagaMates,
    atClub(1034, 2018), // Cádiz CF
    atClub(21, 2018), // Real Madrid
    atClub(8, 2018), // FC Barcelona
    atClub(80, 2018), // Atlético de Madrid
  ].filter(Boolean)
    .filter((player, index, all) => all.findIndex((other) => other.id === player.id) === index);
  const index = clubIndexFor(pool);

  let round = null;
  for (let seed = 1; seed <= 200 && !round; seed += 1) {
    const candidate = build(buildClubRound, seed, pool);
    if (candidate?.subjectName === mikel.name) round = candidate;
  }
  assert.ok(round, 'the focused pool supplies a Mikel Villanueva club round');
  assert.equal(round.answer, 'Málaga CF');
  assert.equal(round.reveal.season, '2018/19');
  assert.deepEqual(round.clues.slice(0, 2).map((clue) => clue.id), ['club-squad', 'club-other']);
  assert.ok(round.clues.slice(2).every((clue) => PROFILE_IDS.has(clue.id)), 'profile facts come last');

  const optionNames = round.options.map((option) => option.value);
  assert.ok(optionNames.includes('Cádiz CF'), 'the career clue names an option');
  for (const name of optionNames) {
    assert.ok(
      [...index.values()].some((entry) => entry.clubName === name
        && entry.season === 2018
        && entry.leagueId === 'ES1'),
      `${name} was not in La Liga in 2018/19`,
    );
  }
});
