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

test('comparison contract: named comparators eliminate the other three options', () => {
  for (const round of eachRound(buildComparisonRound, 40)) {
    const ranked = round.reveal.values;
    assert.equal(ranked.length, 4);
    assert.equal(new Set(ranked.map((row) => row.value)).size, 4);
    assert.deepEqual(
      ranked.map((row) => row.value),
      [...ranked.map((row) => row.value)].sort((a, b) => b - a),
    );
    assert.equal(round.answer, ranked[0].player.name);

    const options = round.options.map((option) => option.value);
    assert.equal(options.length, 4);
    assert.equal(new Set(options).size, 4);
    const comparators = round.clues.filter((clue) => clue.id.startsWith('comparison-'));
    assert.equal(comparators.length, 3);
    assert.deepEqual(comparators.map((clue) => clue.label), ['The field', 'The shortlist', 'The runner-up']);
    assert.ok(round.clues[0].id.startsWith('comparison-'), 'the first clue is a comparator');

    const named = comparators.map((clue) => {
      const match = clue.value.match(/^The answer has more than (.+)\.$/);
      assert.ok(match, `unexpected comparator: ${clue.value}`);
      assert.doesNotMatch(clue.value, /\d/);
      assert.ok(options.includes(match[1]), `${match[1]} is not an option`);
      return match[1];
    });
    assert.deepEqual(named, [ranked[3].player.name, ranked[2].player.name, ranked[1].player.name]);
    assert.deepEqual(options.filter((name) => !named.includes(name)), [round.answer]);
  }
});

test('regression: the Messi/Ronaldo comparison names its comparators', () => {
  const round = build(buildComparisonRound, 6);
  assert.equal(round.metric, 'international_goals');
  assert.equal(round.answer, 'Cristiano Ronaldo');
  const comparators = round.clues.filter((clue) => clue.id.startsWith('comparison-'));
  assert.deepEqual(comparators.map((clue) => clue.value), [
    'The answer has more than Robert Lewandowski.',
    'The answer has more than Romelu Lukaku.',
    'The answer has more than Lionel Messi.',
  ]);
  for (const clue of comparators) assert.doesNotMatch(clue.value, /\d/);
});

function rangeBound(clue) {
  let match = clue.value.match(/^€([\d.]+)M or more\.$/);
  if (match) {
    const floor = Number(match[1]) * 1_000_000;
    return (value) => value >= floor;
  }
  match = clue.value.match(/^Under €([\d.]+)M\.$/);
  if (match) {
    const ceiling = Number(match[1]) * 1_000_000;
    return (value) => value < ceiling;
  }
  match = clue.value.match(/^More than ([\d,]+) (?:goals|caps|apps)\.$/);
  if (match) {
    const floor = Number(match[1].replaceAll(',', ''));
    return (value) => value > floor;
  }
  match = clue.value.match(/^Fewer than ([\d,]+) (?:goals|caps|apps)\.$/);
  if (match) {
    const ceiling = Number(match[1].replaceAll(',', ''));
    return (value) => value < ceiling;
  }
  return null;
}

test('range contract: every bucket clue is true of the hidden value', () => {
  for (const round of eachRound(buildRangeRound, 40)) {
    assert.ok(round.reveal.value > 0);
    const options = round.options.map((option) => option.value);
    assert.equal(options.length, 4);
    assert.equal(new Set(options).size, 4);
    assert.ok(options.includes(round.answer));

    for (const clue of round.clues.filter((c) => c.id === 'range-over' || c.id === 'range-under')) {
      const holds = rangeBound(clue);
      assert.ok(holds, `unrecognised bound: ${clue.value}`);
      assert.ok(holds(round.reveal.value), `${clue.value} is false for ${round.reveal.value}`);
    }
    for (const clue of round.clues) {
      const exact = String(round.reveal.value);
      const tokens = clue.value.match(/\d[\d,]*/g) ?? [];
      assert.ok(
        !tokens.some((token) => token.replaceAll(',', '') === exact),
        `the clue "${clue.value}" states the exact value`,
      );
    }
  }
});

test('teammate contract: the clues describe the hidden teammate, not the subject', () => {
  for (const round of eachRound(buildTeammateRound, 40)) {
    const subject = byId.get(round.subjectId);
    const teammate = byId.get(round.answerPlayerId);
    assert.ok(subject && teammate);
    assert.notEqual(subject.id, teammate.id);

    const season = seasonStart(round.reveal.season);
    const shared = (subject.teams ?? []).some((team) => (team.seasons ?? []).includes(season)
      && (teammate.teams ?? []).some((other) => other.clubId === team.clubId
        && (other.seasons ?? []).includes(season)));
    assert.ok(shared, 'the teammate shares the club-season in the prompt');

    const optionNames = round.options.map((option) => option.value);
    assert.ok(optionNames.includes(round.answer));
    assert.ok(!optionNames.includes(round.subjectName));

    const profileValues = new Set(profileHints(teammate).map((hint) => hint.value));
    const careerClubs = new Set((teammate.teams ?? []).map((team) => team.clubName));
    for (const clue of round.clues) {
      assert.ok(!clue.value.includes(round.subjectName), `the clue "${clue.value}" describes the subject`);
      assert.ok(!clue.value.toLowerCase().includes(round.answer.toLowerCase()), 'the clue names the answer');
      if (clue.id === 'mate-other') {
        const match = clue.value.match(/^Also played for (.+) in (\d{4}\/\d{2})\.$/);
        assert.ok(match, `unexpected career clue: ${clue.value}`);
        assert.ok(careerClubs.has(match[1]), `${match[1]} is not a teammate club`);
      } else {
        assert.ok(profileValues.has(clue.value), `the clue "${clue.value}" is not a teammate profile fact`);
      }
    }
  }
});
