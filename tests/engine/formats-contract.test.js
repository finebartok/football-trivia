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

function buildIn(builder, window, seed = 1, pool = players) {
  return builder({
    pool,
    registry,
    window,
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
const CLUB_FACT_IDS = new Set(['club-goals', 'club-other', 'club-league']);

test('club contract: the clues describe the club-season and the options are plausible', () => {
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
    const subjectClubs = new Set((subject.teams ?? []).map((team) => team.clubName));
    for (const name of optionNames) {
      const inLeagueThatSeason = [...CLUB_INDEX.values()].some((entry) => entry.clubName === name
        && entry.season === season
        && entry.leagueId === answerTeam.leagueId);
      assert.ok(
        subjectClubs.has(name) || inLeagueThatSeason,
        `${name} is neither a club of ${subject.name} nor in ${answerTeam.leagueId} in ${round.reveal.season}`,
      );
    }

    const ids = round.clues.map((clue) => clue.id);
    const facts = ids.filter((id) => CLUB_FACT_IDS.has(id));
    assert.ok(facts.length >= 2, `${round.prompt} has only ${facts.length} club-season clues`);
    assert.ok(CLUB_FACT_IDS.has(ids[0]), `${round.prompt} opens with ${ids[0]}`);
    assert.ok(!ids.includes('club-squad'), 'the teammate is not a clue');
    assert.ok(!ids.some((id) => PROFILE_IDS.has(id)), 'the subject profile is not a club clue');

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
      assert.ok(goalsClue.value.includes(subject.name), 'the goal clue names its subject');
      assert.ok(goalsClue.value.includes(String(goals)));
      assert.ok(goalsClue.value.includes(round.reveal.season));
    }
    assert.ok(
      goalsClue || round.clues.some((clue) => clue.id === 'club-league'),
      'a round without goals still has a club fact',
    );

    const careerClue = round.clues.find((clue) => clue.id === 'club-other');
    if (careerClue) {
      const match = careerClue.value.match(/^Also played for (.+) in (\d{4}\/\d{2})\.$/);
      assert.ok(match, `unexpected career clue: ${careerClue.value}`);
      assert.ok(optionNames.includes(match[1]), 'the career clue names an option');
      assert.notEqual(match[1], round.answer);
      const former = (subject.teams ?? []).find((team) => team.clubName === match[1]);
      assert.ok(former, `${match[1]} is not a club of ${subject.name}`);
      assert.ok(
        (former.seasons ?? []).includes(seasonStart(match[2])),
        `${subject.name} was not at ${match[1]} in ${match[2]}`,
      );
    }

    const leagueClue = round.clues.find((clue) => clue.id === 'club-league');
    if (leagueClue) {
      const match = leagueClue.value.match(/^The club was (?:a|an) (.+) side\.$/);
      assert.ok(match, `unexpected league clue: ${leagueClue.value}`);
      assert.equal(match[1], answerTeam.leagueName ?? registry.leagues[answerTeam.leagueId]);
    }
  }
});

test('regression: Mikel Villanueva gets club-season clues and same-league options', () => {
  const mikel = byName.get('Mikel Villanueva');
  const clubId = (name) => registry.clubs.find((club) => club.name === name)?.id;
  const atClub = (club, season) => players.find((player) => (player.teams ?? [])
    .some((team) => team.clubId === clubId(club) && (team.seasons ?? []).includes(season)));
  const malagaMates = players
    .filter((player) => player.id !== mikel.id && (player.teams ?? [])
      .some((team) => team.clubId === clubId('Málaga CF') && (team.seasons ?? []).includes(2018)))
    .slice(0, 3);
  const pool = [
    mikel,
    ...malagaMates,
    atClub('Real Madrid', 2018),
    atClub('FC Barcelona', 2018),
    atClub('Atlético de Madrid', 2018),
  ].filter(Boolean)
    .filter((player, index, all) => all.findIndex((other) => other.id === player.id) === index);
  const index = clubIndexFor(pool);

  let round = null;
  for (let seed = 1; seed <= 500 && !round; seed += 1) {
    const candidate = build(buildClubRound, seed, pool);
    if (candidate?.subjectName === mikel.name && candidate.reveal.season === '2018/19') round = candidate;
  }
  assert.ok(round, 'the focused pool supplies a Mikel Villanueva club round');
  assert.equal(round.answer, 'Málaga CF');
  assert.equal(round.reveal.season, '2018/19');
  assert.deepEqual(round.clues.map((clue) => clue.id), ['club-other', 'club-league']);

  const optionNames = round.options.map((option) => option.value);
  const career = round.clues.find((clue) => clue.id === 'club-other');
  const careerClub = career.value.match(/^Also played for (.+) in \d{4}\/\d{2}\.$/)?.[1];
  assert.ok(optionNames.includes(careerClub), 'the career clue names an option');
  const subjectClubs = new Set((mikel.teams ?? []).map((team) => team.clubName));
  for (const name of optionNames) {
    const inLeagueThatSeason = [...index.values()].some((entry) => entry.clubName === name
      && entry.season === 2018
      && entry.leagueId === 'ES1');
    assert.ok(
      subjectClubs.has(name) || inLeagueThatSeason,
      `${name} is neither a club of Mikel nor in La Liga in 2018/19`,
    );
  }
});

test('comparison contract: one benchmark plus profile facts, not an elimination ladder', () => {
  const PROFILE_LABELS = new Set(['The role', 'The birth year', 'The home', 'The height']);
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

    const benchmarks = round.clues.filter((clue) => clue.label === 'The benchmark');
    assert.equal(benchmarks.length, 1, 'one benchmark names the runner-up');
    const match = benchmarks[0].value.match(/^The answer has more than (.+)\.$/);
    assert.ok(match, `unexpected benchmark: ${benchmarks[0].value}`);
    assert.doesNotMatch(benchmarks[0].value, /\d/);
    assert.equal(match[1], ranked[1].player.name);
    assert.ok(options.includes(match[1]), `${match[1]} is not an option`);

    const profiles = round.clues.filter((clue) => clue.label !== 'The benchmark');
    assert.ok(profiles.length >= 1, 'independent profile facts narrow the answer');
    for (const clue of profiles) {
      assert.ok(PROFILE_LABELS.has(clue.label), `unexpected comparison clue: ${clue.label}`);
      assert.ok(!options.includes(clue.value), 'a profile fact is not an option name');
    }
    assert.equal(round.clues[0].label, 'The benchmark', 'the benchmark is the first clue');
  }
});

test('regression: the Messi/Ronaldo comparison names one benchmark and the answer’s profile', () => {
  const round = build(buildComparisonRound, 6);
  assert.equal(round.metric, 'international_goals');
  assert.equal(round.answer, 'Cristiano Ronaldo');
  const benchmark = round.clues.find((clue) => clue.label === 'The benchmark');
  assert.equal(benchmark.value, 'The answer has more than Lionel Messi.');
  assert.doesNotMatch(benchmark.value, /\d/);
  assert.ok(round.clues.length >= 2);
  assert.ok(round.clues.slice(1).every((clue) => clue.label !== 'The benchmark'));
});

function eraGoals(player, window) {
  let total = 0;
  for (const team of player.teams ?? []) {
    if (window.leagueId && team.leagueId !== window.leagueId) continue;
    for (const season of team.seasons ?? []) {
      if (season < window.seasonStart || season > window.seasonEnd) continue;
      total += player.windows?.[seasonKey(team, season)]?.goals ?? 0;
    }
  }
  return total;
}

test('window contract: comparison and range measure the window, not the career', () => {
  const tournament = registry.windows['wc-2022'];
  const comparison = buildIn(buildComparisonRound, tournament);
  assert.equal(comparison.metric, 'tournament_goals');
  assert.match(comparison.prompt, /goals at the 2022 World Cup/);
  for (const row of comparison.reveal.values) {
    assert.equal(row.value, byId.get(row.player.id).windows['wc-2022'].goals);
  }

  const era = {
    kind: 'season_range', leagueId: 'ES1', leagueName: 'La Liga',
    seasonStart: 2010, seasonEnd: 2019,
  };
  const eraComparison = buildIn(buildComparisonRound, era);
  assert.equal(eraComparison.metric, 'club_goals');
  assert.match(eraComparison.prompt, /goals for La Liga clubs from 2012\/13 to 2019\/20/);
  for (const row of eraComparison.reveal.values) {
    assert.equal(row.value, eraGoals(byId.get(row.player.id), era));
    assert.ok(row.value < byId.get(row.player.id).stats.club_goals, 'not the career total');
  }

  const eraRange = buildIn(buildRangeRound, era);
  assert.equal(eraRange.metric, 'club_goals');
  assert.match(eraRange.prompt, /goals did .+ score for La Liga clubs from 2012\/13 to 2019\/20/);
  assert.equal(eraRange.reveal.value, eraGoals(byId.get(eraRange.subjectId), era));
  assert.match(eraRange.reveal.valueText, /2012\/13.*2019\/20/);
});

test('window contract: club and teammate rounds stay inside the vibe', () => {
  const era = {
    kind: 'season_range', leagueId: 'ES1', leagueName: 'La Liga',
    seasonStart: 2010, seasonEnd: 2019,
  };
  let clubs = 0;
  let mates = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const club = buildIn(buildClubRound, era, seed);
    if (club) {
      clubs += 1;
      const season = seasonStart(club.reveal.season);
      assert.ok(season >= era.seasonStart && season <= era.seasonEnd, `${club.reveal.season} is outside the era`);
      const team = (byId.get(club.subjectId).teams ?? [])
        .find((entry) => entry.clubName === club.answer && (entry.seasons ?? []).includes(season));
      assert.equal(team?.leagueId, era.leagueId, `${club.answer} in ${club.reveal.season} is not a La Liga side`);
    }
    const mate = buildIn(buildTeammateRound, era, seed);
    if (mate) {
      mates += 1;
      const season = seasonStart(mate.reveal.season);
      assert.ok(season >= era.seasonStart && season <= era.seasonEnd, `${mate.reveal.season} is outside the era`);
      const team = (byId.get(mate.answerPlayerId).teams ?? [])
        .find((entry) => entry.clubName === mate.reveal.club && (entry.seasons ?? []).includes(season));
      assert.equal(team?.leagueId, era.leagueId, `${mate.reveal.club} in ${mate.reveal.season} is not a La Liga side`);
    }
  }
  assert.ok(clubs > 0 && mates > 0, 'the era supplies both round types');

  const tournament = registry.windows['wc-2022'];
  let tournamentClubs = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const club = buildIn(buildClubRound, tournament, seed);
    if (!club) continue;
    tournamentClubs += 1;
    const season = seasonStart(club.reveal.season);
    assert.ok(season >= 2021 && season <= 2022, `${club.reveal.season} is not around the 2022 World Cup`);
  }
  assert.ok(tournamentClubs > 0, 'the tournament supplies club rounds');
});

test('career rounds state the 2012 cut instead of calling data career totals', () => {
  let careerRounds = 0;
  const careerMetrics = new Set(['club_goals', 'club_appearances', 'goals_after_age_30']);
  for (let seed = 1; seed <= 40; seed += 1) {
    const comparison = build(buildComparisonRound, seed);
    if (comparison && careerMetrics.has(comparison.metric)) {
      careerRounds += 1;
      assert.match(comparison.prompt, /since 2012/i, `${comparison.metric}: ${comparison.prompt}`);
    }
    const range = build(buildRangeRound, seed);
    if (range && careerMetrics.has(range.metric)) {
      careerRounds += 1;
      assert.match(range.prompt, /since 2012/i, `${range.metric}: ${range.prompt}`);
    }
  }
  assert.ok(careerRounds > 0, 'the career metrics are exercised');
});

test('comparison and range for a tournament only use tournament goals', () => {
  const tournament = registry.windows['wc-2022'];
  for (let seed = 1; seed <= 10; seed += 1) {
    const comparison = buildIn(buildComparisonRound, tournament, seed);
    assert.equal(comparison.metric, 'tournament_goals');
    const range = buildIn(buildRangeRound, tournament, seed);
    assert.equal(range.metric, 'tournament_goals');
  }
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

    // Only the answer was actually at that club in that season; the other
    // three names are plausible outsiders, not alternative correct answers.
    const teammatesAtClub = new Set(players
      .filter((player) => (player.teams ?? []).some((team) => team.clubName === round.reveal.club
        && (team.seasons ?? []).includes(season)))
      .map((player) => player.name));
    const teammateOptions = optionNames.filter((name) => teammatesAtClub.has(name));
    assert.deepEqual(teammateOptions, [round.answer], 'exactly one option is a teammate');

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
