# Football IQ Clue Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Football IQ club and comparison clue describe the thing being asked, keep range bounds correct at bucket edges, and lock the rules down with contract tests, without touching guess-the-player, the mode split, or the database.

**Architecture:** All gameplay changes stay in `js/engine/formats.js`. The club builder gets a same-league-and-season option index and an ordered clue ladder; the comparison builder names the three players it eliminates instead of printing their totals; the range builder uses bucket edges for market-value wording. A new cross-format contract test file pins the clue rules, and the existing format tests gain the two regressions and the boundary cases.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, Playwright for the client, Supabase Edge Functions for deployment. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-football-iq-clue-repair-design.md`

## Global Constraints

- Keep all four formats: `club`, `teammate`, `comparison`, `range`.
- Keep the separate `football_iq` mode and its room/rematch behaviour.
- No database migration and no client source change.
- Every clue must be true of the answer and must not name the answer.
- Club and comparison rounds must have at least two discriminating clues; the first clue must be one of them.
- Club options must all have been in the answer's league in the asked season.
- Comparison comparator clues must name options and contain no digits.
- Range market-value bounds: `€10M or more` / `Under €30M`, `€30M or more` / `Under €60M`, `€60M or more`.
- Counting range bounds keep `More than N goals` / `Fewer than N goals`.
- Deploy functions before pushing `main`.
- Use `node --test` and the existing `npm` scripts; do not add packages.

## Review Focus

- A club option from another league or another season: every option must be a club that was in the answer's league in that season. The club contract test catches it.
- A club season with only one usable fact: the round must be skipped, never padded with a profile clue. The club contract test checks `facts >= 2`; the Mikel Villanueva regression checks the intended ladder.
- A career clue naming a club that is not one of the four options: it must be omitted. The club contract test checks the named club is an option other than the answer.
- A market value exactly on €10M, €30M, or €60M: it must satisfy its own bucket's floor and ceiling. The boundary regression checks all three edges.
- A comparison clue that names the answer, names a non-option, or contains a number: the comparison contract test checks all three.

---

### Task 1: Club round

**Files:**
- Modify: `js/engine/formats.js` (club section and the shared `clubSeasonIndex` helper)
- Modify: `tests/engine/formats.test.js` (club test)
- Create: `tests/engine/formats-contract.test.js` (helpers, club contract test, Mikel Villanueva regression)

**Interfaces:**
- Consumes: `careerTeams(player)`, `profileHints(player)`, `seasonKey(team, season)`, `seasonLabel(season)`, `pick(rng, list)`, `shuffle(rng, list)`, `buildOptions({ answer, distractors, rng })`.
- Produces: the same `buildClubRound({ pool, registry, window, rng, difficulty, stages, excludeSubjectIds })` signature and the same reveal shape `{ format: 'club', player, season, club, league, goals }`. Clue ids are `club-goals`, `club-squad`, `club-other`, plus one profile hint id.

- [ ] **Step 1: Write the failing club tests**

Replace the existing `test('a club round asks about a season with exactly one club', ...)` in `tests/engine/formats.test.js` with this version. It keeps the existing uniqueness checks and adds the clue-order and option-league checks.

```js
test('a club round asks about a season with exactly one club', () => {
  const round = build(buildClubRound);
  assert.ok(round, 'the fixture supplies a club round');
  assert.equal(round.template, 'club');
  assert.equal(round.family, 'club');
  assert.equal(round.clueFamily, null);

  const subject = players.find((p) => p.id === round.subjectId);
  assert.ok(subject, 'the subject is in the pool');
  const start = seasonStart(round.reveal.season);
  const entries = (subject.teams ?? []).filter((team) => (team.seasons ?? []).includes(start));
  assert.equal(entries.length, 1, 'the season has one club, so the answer is unambiguous');
  assert.equal(entries[0].clubName, round.answer);
  assert.equal(round.reveal.club, round.answer);
  assert.ok(valuesOf(round, 'value').includes(round.answer), 'the answer is an option');

  for (const clue of round.clues) {
    assert.ok(
      !clue.value.toLowerCase().includes(round.answer.toLowerCase()),
      `the clue "${clue.value}" names the answer club`,
    );
  }

  const ids = round.clues.map((clue) => clue.id);
  assert.ok(
    ['club-goals', 'club-squad', 'club-other'].includes(ids[0]),
    'the first clue describes the club-season',
  );
  assert.ok(
    ids.filter((id) => ['club-goals', 'club-squad', 'club-other'].includes(id)).length >= 2,
    'two clues describe the club-season',
  );
  assert.ok(!ids.includes('club-league'), 'the league shared by every option is not a clue');

  for (const name of valuesOf(round, 'value')) {
    const clubSeasons = players
      .flatMap((player) => player.teams ?? [])
      .filter((team) => team.clubName === name && (team.seasons ?? []).includes(start));
    assert.ok(
      clubSeasons.some((team) => team.leagueId === entries[0].leagueId),
      `${name} was not in ${entries[0].leagueId} in ${round.reveal.season}`,
    );
  }
});
```

Create `tests/engine/formats-contract.test.js` with the shared helpers, the club contract test, and the Mikel Villanueva regression.

```js
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
      const teammate = byName.get(name);
      assert.ok(teammate, `unknown teammate ${name}`);
      assert.ok(
        CLUB_INDEX.get(`${answerTeam.clubId}|${season}`)?.players.has(teammate.id),
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
```

- [ ] **Step 2: Run the club tests and verify they fail**

Run: `node --test tests/engine/formats.test.js tests/engine/formats-contract.test.js`

Expected: FAIL. The current builder opens with `club-league`, never emits `club-squad`, and allows options from outside the asked league/season. The Mikel regression fails because the current builder emits league and profile clues instead of the squad/career ladder.

- [ ] **Step 3: Rewrite the club builder**

In `js/engine/formats.js`, replace the block from `function clubSeasons(player)` through the closing brace of `buildClubRound` with the code below. This removes `clubSeasons`, `soleClubSeason`, `poolClubs`, and `clubDistractors`, and keeps `leagueName`.

```js
function clubSeasonIndex(pool) {
  const index = new Map();
  const byId = new Map(pool.map((player) => [player.id, player]));
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
  return { index, byId };
}

function leagueSeasonIndex(index) {
  const out = new Map();
  for (const entry of index.values()) {
    const key = `${entry.leagueId}|${entry.season}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(entry);
  }
  return out;
}

function clubCandidateEntries(subject, index, byLeagueSeason) {
  const bySeason = new Map();
  for (const team of subject.teams ?? []) {
    for (const season of team.seasons ?? []) {
      if (!bySeason.has(season)) bySeason.set(season, []);
      bySeason.get(season).push(team);
    }
  }

  const career = careerTeams(subject);
  const entries = [];
  for (const [season, teams] of bySeason) {
    if (teams.length !== 1) continue;
    const team = teams[0];
    const bucket = index.get(`${team.clubId}|${season}`);
    const goals = subject.windows?.[seasonKey(team, season)]?.goals;
    const positiveGoals = typeof goals === 'number' && goals > 0;
    const hasTeammate = (bucket?.players.size ?? 0) > 1;
    const sameLeague = (byLeagueSeason.get(`${team.leagueId}|${season}`) ?? [])
      .filter((other) => other.clubId !== team.clubId);
    const optionNames = [...new Set(sameLeague.map((club) => club.clubName))];
    if (optionNames.length < 3) continue;

    const careerTeam = career.find((other) => other.clubId !== team.clubId
      && (other.seasons ?? []).length > 0
      && sameLeague.some((option) => option.clubId === other.clubId));
    const careerEntry = careerTeam
      ? {
        name: sameLeague.find((option) => option.clubId === careerTeam.clubId).clubName,
        season: Math.min(...careerTeam.seasons),
      }
      : null;
    const facts = (positiveGoals ? 1 : 0) + (hasTeammate ? 1 : 0) + (careerEntry ? 1 : 0);
    if (facts < 2) continue;

    entries.push({
      team,
      season,
      goals: positiveGoals ? goals : null,
      optionNames,
      careerEntry,
    });
  }
  return entries;
}

function leagueName(team, registry) {
  return team.leagueName ?? registry?.leagues?.[team.leagueId] ?? null;
}

function otherClubFact(player, excludeClubId) {
  for (const team of careerTeams(player)) {
    if (team.clubId === excludeClubId) continue;
    const season = Math.min(...(team.seasons ?? []));
    if (!Number.isFinite(season)) continue;
    return `Also played for ${team.clubName} in ${seasonLabel(season)}.`;
  }
  return null;
}

export function buildClubRound({ pool, registry, window, rng, difficulty, stages = 4, excludeSubjectIds = new Set() }) {
  const { index, byId } = clubSeasonIndex(pool);
  const byLeagueSeason = leagueSeasonIndex(index);
  const candidates = [];
  for (const subject of pool) {
    if (excludeSubjectIds.has(subject.id)) continue;
    const entries = clubCandidateEntries(subject, index, byLeagueSeason);
    if (entries.length) candidates.push({ subject, entries });
  }
  if (!candidates.length) return null;

  const chosen = pick(rng, candidates);
  const entry = preferredFirst(chosen.entries, window, rng)[0];
  const { team, season, goals, optionNames, careerEntry } = entry;
  const bucket = index.get(`${team.clubId}|${season}`);
  const teammates = [...(bucket?.players ?? [])]
    .filter((id) => id !== chosen.subject.id)
    .map((id) => byId.get(id))
    .filter(Boolean);
  const teammate = teammates.length ? pick(rng, teammates) : null;

  const clues = [
    goals
      ? { id: 'club-goals', label: 'The season', value: `They scored ${goals} ${goals === 1 ? 'goal' : 'goals'} in ${seasonLabel(season)}.`, iconKey: 'honors' }
      : teammate
        ? { id: 'club-squad', label: 'The squad', value: `${teammate.name} was in the squad that season.`, iconKey: 'team' }
        : null,
    goals && teammate
      ? { id: 'club-squad', label: 'The squad', value: `${teammate.name} was in the squad that season.`, iconKey: 'team' }
      : null,
    careerEntry
      ? { id: 'club-other', label: 'The career', value: `Also played for ${careerEntry.name} in ${seasonLabel(careerEntry.season)}.`, iconKey: 'path' }
      : null,
    ...profileHints(chosen.subject).slice(0, 1),
  ];

  const distractors = careerEntry
    ? [careerEntry.name, ...shuffle(rng, optionNames.filter((name) => name !== careerEntry.name))]
    : shuffle(rng, optionNames);
  const options = buildOptions({
    answer: team.clubName,
    distractors,
    rng,
  });

  return roundShape({
    format: 'club',
    subject: chosen.subject,
    prompt: `Which club did ${chosen.subject.name} play for in ${seasonLabel(season)}?`,
    context: window?.label ?? null,
    answer: team.clubName,
    unit: null,
    options,
    clues,
    difficulty,
    stages,
    reveal: {
      format: 'club',
      player: playerRef(chosen.subject),
      season: seasonLabel(season),
      club: team.clubName,
      league: leagueName(team, registry),
      goals: goals ?? null,
    },
  });
}
```

Delete the later duplicate `clubSeasonIndex` definition from the teammate section (it starts with `function clubSeasonIndex(pool)` after the `// Teammate` heading). The teammate builder keeps using the extended helper above, including its new `leagueId` field.

- [ ] **Step 4: Run the club tests and the engine suite**

Run: `node --test tests/engine/formats.test.js tests/engine/formats-contract.test.js`

Expected: PASS for the club tests. The contract file only contains club tests at this point.

Run: `node --test tests/engine/*.test.js`

Expected: PASS. The planner still falls back to another format when no club candidate is usable.

- [ ] **Step 5: Commit**

```bash
git add js/engine/formats.js tests/engine/formats.test.js tests/engine/formats-contract.test.js
git commit -m "fix(engine): rebuild Football IQ club clues"
```

---

### Task 2: Comparison round

**Files:**
- Modify: `js/engine/formats.js` (`buildComparisonRound`)
- Modify: `tests/engine/formats.test.js` (comparison test)
- Modify: `tests/engine/formats-contract.test.js` (comparison contract and Messi/Ronaldo regression)

**Interfaces:**
- Consumes: `distinctTop(metric, pool)`, `playerRef(player)`, `profileHints(player)`, `buildOptions`.
- Produces: the same reveal shape and option shape; comparator clue labels become `The field`, `The shortlist`, `The runner-up`, and each value is `The answer has more than {player name}.`.

- [ ] **Step 1: Write the failing comparison tests**

In `tests/engine/formats.test.js`, replace the three-bound block at the end of the comparison test with this:

```js
  const comparators = round.clues.filter((clue) => /^The (field|shortlist|runner-up)$/.test(clue.label));
  assert.equal(comparators.length, 3, 'three named comparators narrow the field');
  const named = comparators.map((clue) => {
    const match = clue.value.match(/^The answer has more than (.+)\.$/);
    assert.ok(match, clue.value);
    assert.doesNotMatch(clue.value, /\d/);
    return match[1];
  });
  assert.deepEqual(named, ranked.slice(1).reverse().map((row) => row.player.name));
  assert.ok(named.every((name) => optionNames.includes(name)));
```

Append these tests to `tests/engine/formats-contract.test.js`:

```js
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
```

- [ ] **Step 2: Run the comparison tests and verify they fail**

Run: `node --test tests/engine/formats.test.js tests/engine/formats-contract.test.js`

Expected: FAIL. The current clues contain `more than 89 goals` and label the runner-up clue `The leader`; the contract test does not find the named comparator shape.

- [ ] **Step 3: Replace the numeric bounds with named comparators**

In `js/engine/formats.js`, inside `buildComparisonRound`, replace the `const [first, second, third, fourth] = ...` and `const bounds = ...` / `clues` block with:

```js
    const clues = [
      {
        id: `comparison-${metric.id}-0`,
        label: 'The field',
        value: `The answer has more than ${rows[3].player.name}.`,
        iconKey: 'honors',
      },
      {
        id: `comparison-${metric.id}-1`,
        label: 'The shortlist',
        value: `The answer has more than ${rows[2].player.name}.`,
        iconKey: 'honors',
      },
      {
        id: `comparison-${metric.id}-2`,
        label: 'The runner-up',
        value: `The answer has more than ${rows[1].player.name}.`,
        iconKey: 'honors',
      },
    ];
```

Keep the existing `const profile = profileHints(answer.player)[0]; if (profile) clues.push(profile);` lines after this block. Do not change the option construction.

- [ ] **Step 4: Run the comparison tests and the engine suite**

Run: `node --test tests/engine/formats.test.js tests/engine/formats-contract.test.js`

Expected: PASS.

Run: `node --test tests/engine/*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/engine/formats.js tests/engine/formats.test.js tests/engine/formats-contract.test.js
git commit -m "fix(engine): name Football IQ comparison clues"
```

---

### Task 3: Range bounds and teammate contract coverage

**Files:**
- Modify: `js/engine/formats.js` (`boundText` and the `buildRangeRound` lower-bound call)
- Modify: `tests/engine/formats.test.js` (market boundary regression)
- Modify: `tests/engine/formats-contract.test.js` (range and teammate contract tests)

**Interfaces:**
- Consumes: `formatMetric(metric, value)`, `withUnit(value, unit)`, `bucketFor(buckets, value)`.
- Produces: the same range clue ids (`range-over`, `range-under`), with market-value text `€30M or more` / `Under €60M`; counting text stays `More than 24 goals` / `Fewer than 50 goals`.

- [ ] **Step 1: Write the failing range boundary test**

Add this helper and test to `tests/engine/formats.test.js`, after the existing `valuesOf` helper:

```js
function rangeAt(value, extra = []) {
  return buildRangeRound({
    pool: [
      { id: `boundary-${value}`, name: `Boundary ${value}`, highestMarketValueEur: value },
      ...extra,
    ],
    registry,
    window: null,
    scope: { clauses: [] },
    rng: makeRng(1),
    difficulty: 'medium',
    stages: 4,
  });
}

test('market-value range clues include values exactly on a bucket edge', () => {
  const cases = [
    [10_000_000, '€10-29M', ['€10M or more.', 'Under €30M.']],
    [29_999_999, '€10-29M', ['€10M or more.', 'Under €30M.']],
    [30_000_000, '€30-59M', ['€30M or more.', 'Under €60M.']],
    [60_000_000, '€60M+', ['€60M or more.']],
  ];
  for (const [value, answer, bounds] of cases) {
    const extra = answer === '€60M+'
      ? [{ id: 'boundary-higher', name: 'Boundary higher', highestMarketValueEur: 70_000_000 }]
      : [];
    const round = rangeAt(value, extra);
    assert.ok(round, `${value} supplies a range round`);
    assert.equal(round.answer, answer);
    const values = round.clues.map((clue) => clue.value);
    for (const bound of bounds) assert.ok(values.includes(bound), `${value} should show "${bound}"`);
    assert.ok(!values.includes('More than €30.0M.'), 'the market floor is not rounded down');
  }
});
```

Append these tests to `tests/engine/formats-contract.test.js`:

```js
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
      assert.ok(!clue.value.includes(String(round.reveal.value)), `the clue "${clue.value}" states the exact value`);
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
```

- [ ] **Step 2: Run the range and teammate tests and verify they fail**

Run: `node --test tests/engine/formats.test.js tests/engine/formats-contract.test.js`

Expected: FAIL. The current market floor for `€30-59M` is `More than €30.0M.` because `boundText` formats `bucket.start - 1`. The teammate contract test should pass immediately; it is a regression guard, not a behaviour change.

- [ ] **Step 3: Use bucket edges for market-value bounds**

In `js/engine/formats.js`, replace `boundText` with:

```js
function boundText(metric, value, unit, direction) {
  if (metric === 'highest_market_value_eur') {
    return direction === 'over'
      ? `${formatMetric(metric, value)} or more.`
      : `Under ${formatMetric(metric, value)}.`;
  }
  const noun = withUnit(value, unit);
  return direction === 'over'
    ? `More than ${noun}.`
    : `Fewer than ${noun}.`;
}
```

In `buildRangeRound`, replace the `const lower = ...` line with:

```js
    const floor = metricId === 'highest_market_value_eur' ? bucket.start : bucket.start - 1;
    const lower = bucket.start > 0
      ? { id: 'range-over', label: 'The floor', value: boundText(metricId, floor, descriptor.unit, 'over'), iconKey: 'honors' }
      : null;
```

The upper bound stays `boundText(metricId, bucket.end + 1, descriptor.unit, 'under')`, so `€10-29M` ends `Under €30M` and `€30-59M` ends `Under €60M`.

- [ ] **Step 4: Run the range, teammate, and engine tests**

Run: `node --test tests/engine/formats.test.js tests/engine/formats-contract.test.js`

Expected: PASS.

Run: `node --test tests/engine/*.test.js`

Expected: PASS. The teammate contract test passes against the unchanged teammate builder.

- [ ] **Step 5: Commit**

```bash
git add js/engine/formats.js tests/engine/formats.test.js tests/engine/formats-contract.test.js
git commit -m "fix(engine): correct Football IQ range edges and lock clue contracts"
```

---

### Task 4: Full verification and deployment

**Files:**
- No source changes. This task runs the suites, prepares the function vendor copy, deploys, and checks the live game.

**Interfaces:**
- Consumes: the four completed tasks in this plan and the existing `package.json` scripts.
- Produces: a deployed v1.4.1 function bundle and a `main` branch that matches it.

- [ ] **Step 1: Run the engine and full test suites**

Run: `node --test tests/engine/*.test.js`

Expected: PASS. The club, comparison, range, and teammate contract tests all run.

Run: `npm test`

Expected: PASS. Integration tests skip only when the local Supabase stack is not running; if they skip, start the stack and run the relevant integration suite.

- [ ] **Step 2: Prepare and serve the functions, then run the integration suite**

If the local Supabase stack is not running, run: `npm run supabase:start`

Run: `npm run supabase:serve` in a background shell.

Expected: `prepared 3 paths in supabase/functions/_shared/vendor/` followed by the local function server listening on port `54399`.

Run: `npm test` in another shell.

Expected: PASS, including `tests/integration/football-iq.test.js` and the room/rematch coverage.

Stop the background function server after the integration run.

- [ ] **Step 3: Run the client IQ spec**

Run: `npx playwright test tests/client/iq.spec.js`

Expected: PASS. Playwright starts its own dev server on port `8123`.

- [ ] **Step 4: Deploy functions before pushing the client**

Run: `npm run supabase:deploy`

Expected: the Supabase CLI deploys `start-room`, `submit-answer`, and `pool-count` with the updated vendor bundle.

- [ ] **Step 5: Push `main`**

```bash
git push origin main
```

Expected: Vercel publishes the client and the engine together. The local branch must be clean and ahead only by the implementation commits.

- [ ] **Step 6: Run the live checks**

Open `https://football-trivia-xi.vercel.app/` and verify:

- One ten-round solo Football IQ game reaches at least one club round and one comparison round.
- A club round opens with a season-goals or squad clue, never a profile clue, and every option is a club from that league and season.
- A comparison round shows three named comparators and no numeric bound.
- A range round with a market value exactly on `€30M` shows `€30M or more` and `Under €60M`.
- One guess-the-player room still starts, plays, and rematches as before.
- No database migration was applied during this repair.

- [ ] **Step 7: Record the deployment**

```bash
git status --short
git log --oneline -4
```

Expected: clean worktree, with the club, comparison, range, and deployment commits visible.
