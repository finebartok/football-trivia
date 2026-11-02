# Press-your-luck and clue families implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the richness work: the current mode stays guess-the-player, every round reveals one clue at a time by choice, and ten rounds draw from five different clue families. Solo and rooms both get the feature; rooms keep per-player clue progress on the server.

**Architecture:** The engine grows family-specific clue ladders and a seeded family schedule, then `composeRound` merges a family ladder with the existing mixed ladder and reports the effective family. Solo tracks the clue index in the round screen. Rooms add a `round_progress` table and a `reveal_clue` RPC; `current_round` and `submit-answer` become on-demand aware behind a defaulted flag so old clients keep the v1.2 timed ladder. The reveal recomputes the scoring breakdown from the stored stage and response time.

**Tech Stack:** Plain ES modules, Node's test runner, Supabase Postgres + Edge Functions, Playwright, no build step.

**Spec:** `docs/superpowers/specs/2026-11-01-press-your-luck-and-clue-families-design.md`

**Base:** `fe5135b` on `main`. The live game is `https://football-trivia-xi.vercel.app/`.

---

## File map

| File | Change |
|---|---|
| `js/engine/hints.js` | Add `recordHints`, `profileHints`, `teammateHints`, `familyClues`, `CLUE_FAMILIES`, `CLUE_FAMILY_LABELS`; add the new labels and roles. |
| `js/engine/questions.js` | Family ladder merge, effective family, teammate option exclusions. |
| `js/engine/planner.js` | Seeded family schedule, `clueFamilies` summary, keep the dormant `statRounds`. |
| `js/engine/distractors.js` | `nameDistractors` gains `excludeIds`. |
| `js/engine/scoring.js` | `scoreBreakdown` helper for the reveal. |
| `js/engine/index.js` | Export the new engine API. |
| `client/src/store.js` | Stop requesting stat rounds. |
| `client/src/screens/round.js` | On-demand reveal, family chip, local solo index, server room index. |
| `client/src/screens/reveal.js` | Scoring breakdown. |
| `client/src/screens/results.js` | Clue-family recap. |
| `client/styles/screens/round.css` | Family chip, reveal button, breakdown. |
| `client/src/room.js` | `revealClue`, on-demand sync, on-demand answer. |
| `client/src/room-state.js` | Monotonic `clue_index` merge. |
| `supabase/functions/_shared/projection.js` | Project `clue_family`. |
| `supabase/functions/_shared/start-room.js` | Remove `statRounds: 3`; insert/project `clue_family`. |
| `supabase/functions/_shared/submit-answer.js` | `on_demand` stage from `round_progress`. |
| `supabase/migrations/20261101000100_press_your_luck.sql` | New table, column, `reveal_clue`, and replacements for `current_round`, `sync_room_state`, `advance_room`, `round_result`, `use_room_effect`. |
| `tests/engine/hints.test.js` | Family hint tests. |
| `tests/engine/questions.test.js` | Family composition and option exclusion tests. |
| `tests/engine/distractors.test.js` | `excludeIds` test. |
| `tests/engine/planner.test.js` | Mix, family schedule, and determinism tests. |
| `tests/engine/scoring.test.js` | Breakdown test. |
| `tests/shared/projection.test.js` | `clue_family` in the client payload. |
| `tests/shared/room-state.test.js` | Monotonic clue index test. |
| `tests/integration/stat-rounds.test.js` | Delete; replaced by `press-your-luck.test.js`. |
| `tests/integration/press-your-luck.test.js` | Room clue progress, stages, old-client shape, rematch, steal. |
| `tests/client/client.spec.js` | Solo mix, on-demand reveal, family chip, breakdown. |
| `tests/client/room.spec.js` | Per-player reveal and server stage. |
| `docs/DEPLOY.md` | Server-first deploy note. |

---

## Task 1: Clue-family hint builders

**Files:**
- Modify: `js/engine/hints.js`
- Test: `tests/engine/hints.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/engine/hints.test.js`:

```js
import { makeRng } from '../../js/engine/rng.js';
import {
  buildHints, recordHints, profileHints, teammateHints, familyClues,
  CLUE_FAMILIES, CLUE_FAMILY_LABELS,
} from '../../js/engine/hints.js';

test('the record book can state more than one record and skips the stage metric', () => {
  const { messi, players, registry, window } = messiAndPool();
  const stage = buildHints(messi, window, registry, { pool: players })
    .find((h) => h.role === 'stage');
  const records = recordHints(messi, players, stage, window);

  assert.ok(records.length >= 2, 'a deep pool must support at least two records');
  assert.equal(new Set(records.map((h) => h.metric)).size, records.length);
  assert.ok(!records.some((h) => h.metric === stage.metric), 'the record must not repeat the stage');
  assert.equal(new Set(records.map((h) => h.id)).size, records.length, 'record ids must be distinct');
});

test('profile facts are separate clues and a missing height is skipped', () => {
  const { messi } = messiAndPool();
  const clues = profileHints(messi);
  const roles = clues.map((h) => h.role);
  assert.ok(roles.includes('role'));
  assert.ok(roles.includes('born'));
  assert.ok(roles.includes('home'));
  assert.ok(roles.includes('height'));

  const short = profileHints({ id: 1, name: 'No Height', position: 'Midfield', dateOfBirth: '1990-01-01', citizenship: ['X'] });
  assert.ok(!short.some((h) => h.role === 'height'));
});

test('every teammate clue names a real club-season teammate and never the subject', () => {
  const { messi, players } = messiAndPool();
  const clues = teammateHints(messi, players, { rng: makeRng(4) });
  assert.ok(clues.length >= 2);
  assert.ok(clues.length <= 3);

  const index = new Map();
  for (const player of players) {
    for (const team of player.teams ?? []) {
      for (const season of team.seasons ?? []) {
        const key = `${team.clubId}|${season}`;
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(player.id);
      }
    }
  }
  for (const clue of clues) {
    assert.ok(clue.teammateId);
    assert.notEqual(clue.teammateId, messi.id);
    const shared = (messi.teams ?? []).some((team) => (team.seasons ?? []).some((season) =>
      index.get(`${team.clubId}|${season}`)?.has(clue.teammateId)));
    assert.ok(shared, `${clue.value} does not share a club-season with the subject`);
  }
});

test('a player with no teammates falls back to no teammate ladder', () => {
  const lonely = { id: 1, name: 'Lonely', teams: [{ clubId: 9, clubName: 'Alone FC', seasons: [2020] }] };
  assert.deepEqual(teammateHints(lonely, [lonely], { rng: makeRng(1) }), []);
  assert.equal(familyClues('teammate_trail', lonely, null, {}, { pool: [lonely], rng: makeRng(1) }), null);
});

test('the family catalogue is complete', () => {
  assert.deepEqual([...CLUE_FAMILIES], ['career_trail', 'teammate_trail', 'record_book', 'profile', 'mixed']);
  for (const family of CLUE_FAMILIES) assert.ok(CLUE_FAMILY_LABELS[family]);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
node --test tests/engine/hints.test.js
```

Expected: `SyntaxError` or `TypeError` because the new exports do not exist.

- [ ] **Step 3: Add the new roles and labels**

In `js/engine/hints.js`, extend the label and rank tables:

```js
const LABELS = {
  stage: 'The stage',
  trail: 'The trail',
  record: 'The record',
  profile: 'The profile',
  home: 'The home',
  role: 'The role',
  born: 'The birth year',
  height: 'The height',
  teammate: 'The teammate',
};

const ROLE_RANK = { stage: 0, trail: 1, record: 2, profile: 3, home: 4, role: 3, born: 3, height: 4, teammate: 1 };
```

Extend `hint()` so a clue can carry a stable id and a teammate id:

```js
function hint(role, value, { iconKey, family = 'career', metric = null, windowId = null, id = null, teammateId = null } = {}) {
  const surface = role === 'profile' || role === 'home' || role === 'role' || role === 'born' || role === 'height';
  return {
    id: id ?? role,
    label: LABELS[role],
    value,
    iconKey: iconKey ?? ICONS.honors,
    family,
    surface,
    role,
    ...(metric ? { metric } : {}),
    ...(windowId ? { window: windowId } : {}),
    ...(teammateId ? { teammateId } : {}),
  };
}
```

Add the import at the top of the file:

```js
import { shuffle } from './rng.js';
```

- [ ] **Step 4: Refactor the record into `recordHints`**

Replace `recordHint` with:

```js
export function recordHints(subject, pool, stage, window) {
  if (!Array.isArray(pool) || pool.length < 2) return [];
  const candidates = [];

  for (const def of RECORD_DEFS) {
    if (stage?.metric === def.id) continue;
    if (def.needsTournament && window?.kind !== 'tournament') continue;
    const value = def.value(subject, window);
    if (value === undefined || value === null || value <= 0) continue;

    // A zero is a known value; only the comparison itself needs positives.
    const known = pool
      .map((player) => def.value(player, window))
      .filter((v) => v !== undefined && v !== null);
    if (known.length / pool.length < MIN_RECORD_COVERAGE) continue;

    const values = known.filter((v) => v > 0);
    if (values.length < 2) continue;

    const rank = 1 + values.filter((v) => v > value).length;
    const ties = values.filter((v) => v === value).length;
    const comparison = poolComparison(rank, ties, values.length, def);
    if (!comparison) continue;

    candidates.push({ def, value, comparison, rank, ties });
  }

  candidates.sort((a, b) => a.rank - b.rank || a.ties - b.ties || a.def.priority - b.def.priority);
  return candidates.map((chosen) => hint('record', `${chosen.def.phrase(chosen.value, window)} — ${chosen.comparison}.`, {
    id: `record-${chosen.def.id}`,
    family: chosen.def.family,
    metric: chosen.def.id,
    iconKey: chosen.def.id === 'highest_market_value_eur' ? ICONS.value : ICONS.honors,
    windowId: chosen.def.needsTournament ? window?.id : null,
  }));
}

function recordHint(subject, pool, stage, window) {
  return recordHints(subject, pool, stage, window)[0] ?? null;
}
```

`buildHints` keeps using `recordHint`, so the mixed ladder is unchanged.

- [ ] **Step 5: Add `profileHints`**

Keep the existing combined `profileHint` for the mixed ladder. Add:

```js
export function profileHints(subject) {
  const out = [];
  const role = roleNoun(subject);
  const foot = subject.foot
    ? (subject.foot.toLowerCase() === 'both' ? 'two-footed' : `${subject.foot.toLowerCase()}-footed`)
    : null;

  if (role) out.push(hint('role', `A ${foot ? `${foot} ` : ''}${role}.`, { iconKey: ICONS.pos }));

  const born = subject.dateOfBirth ? String(subject.dateOfBirth).slice(0, 4) : null;
  if (born) out.push(hint('born', `Born in ${born}.`, { iconKey: ICONS.age }));

  const home = homeHint(subject);
  if (home) out.push(home);

  const height = Number(subject.heightCm);
  if (Number.isFinite(height) && height > 0) {
    out.push(hint('height', `${height} cm tall.`, { iconKey: ICONS.age }));
  }

  return out;
}
```

- [ ] **Step 6: Add `teammateHints`**

Add after `homeHint`:

```js
function clubSeasonIndex(pool) {
  const index = new Map();
  for (const player of pool ?? []) {
    for (const team of player.teams ?? []) {
      for (const season of team.seasons ?? []) {
        const key = `${team.clubId}|${season}`;
        if (!index.has(key)) {
          index.set(key, {
            clubId: team.clubId,
            clubName: team.clubName,
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

export function teammateHints(subject, pool, { rng = Math.random, limit = 3 } = {}) {
  if (!subject || !Array.isArray(pool)) return [];

  const index = clubSeasonIndex(pool);
  const byId = new Map(pool.map((player) => [player.id, player]));
  const entries = [];
  const seen = new Set([subject.id]);

  for (const team of subject.teams ?? []) {
    for (const season of team.seasons ?? []) {
      const bucket = index.get(`${team.clubId}|${season}`);
      if (!bucket) continue;
      for (const id of bucket.players) {
        if (seen.has(id)) continue;
        const player = byId.get(id);
        if (!player) continue;
        seen.add(id);
        entries.push({ player, clubId: team.clubId, clubName: team.clubName, season });
      }
    }
  }

  if (entries.length < 2) return [];

  const shuffled = shuffle(rng, entries);
  const picked = [];
  const usedClubs = new Set();
  const usedSeasons = new Set();

  // Prefer a different club and a different season for each name.
  for (const entry of shuffled) {
    if (picked.length >= limit) break;
    if (usedClubs.has(entry.clubId) || usedSeasons.has(entry.season)) continue;
    picked.push(entry);
    usedClubs.add(entry.clubId);
    usedSeasons.add(entry.season);
  }
  for (const entry of shuffled) {
    if (picked.length >= limit) break;
    if (!picked.includes(entry)) picked.push(entry);
  }

  return picked.map((entry) => hint(
    'teammate',
    `Played with ${entry.player.name} at ${entry.clubName} in ${seasonLabel(entry.season)}.`,
    {
      id: `teammate-${entry.player.id}`,
      family: 'teammate',
      iconKey: ICONS.team,
      teammateId: entry.player.id,
    },
  ));
}
```

- [ ] **Step 7: Add the family catalogue and ladders**

Add at the bottom, before `buildHints`:

```js
export const CLUE_FAMILIES = Object.freeze([
  'career_trail',
  'teammate_trail',
  'record_book',
  'profile',
  'mixed',
]);

export const CLUE_FAMILY_LABELS = Object.freeze({
  career_trail: 'Career trail',
  teammate_trail: 'Teammate trail',
  record_book: 'Record book',
  profile: 'Profile',
  mixed: 'Mixed bag',
});

/**
 * The family's own ladder, in the order it should be revealed.
 *
 * `null` means the family cannot supply a usable ladder; the caller falls
 * back to the mixed ladder. The mixed ladder itself is `buildHints`.
 */
export function familyClues(family, subject, window, registry, { pool, scope, rng } = {}) {
  const stage = stageHint(subject, { window, scope, registry });

  switch (family) {
    case 'career_trail': {
      const clues = [
        stage,
        trailHint(subject),
        recordHints(subject, pool, stage, window)[0] ?? null,
        homeHint(subject),
      ];
      return clues.filter(Boolean);
    }
    case 'teammate_trail': {
      const mates = teammateHints(subject, pool, { rng, limit: 3 });
      if (mates.length < 2) return null;
      const clues = [
        mates[0],
        mates[1],
        trailHint(subject),
        mates[2] ?? null,
        profileHints(subject)[0] ?? homeHint(subject),
      ];
      return clues.filter(Boolean);
    }
    case 'record_book': {
      const records = recordHints(subject, pool, stage, window).slice(0, 3);
      if (records.length < 2) return null;
      const tail = homeHint(subject) ?? profileHints(subject)[0] ?? null;
      return [...records, tail].filter(Boolean);
    }
    case 'profile': {
      const clues = profileHints(subject);
      return clues.length >= 2 ? clues : null;
    }
    default:
      return null;
  }
}
```

- [ ] **Step 8: Run the tests**

```bash
node --test tests/engine/hints.test.js
```

Expected: all pass. If the fixture's record coverage changes, adjust the assertion, not the coverage floor.

- [ ] **Step 9: Commit**

```bash
git add js/engine/hints.js tests/engine/hints.test.js
git commit -m "feat: add clue-family hint builders"
```

---

## Task 2: Family composition and teammate option exclusions

**Files:**
- Modify: `js/engine/questions.js`
- Modify: `js/engine/distractors.js`
- Modify: `js/engine/index.js`
- Test: `tests/engine/questions.test.js`
- Test: `tests/engine/distractors.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/engine/distractors.test.js`:

```js
test('name distractors never include an excluded teammate', () => {
  const { players } = loadFixture();
  const subject = players.find((p) => p.name === 'Lionel Messi');
  const excluded = players.filter((p) => p.id !== subject.id).slice(0, 3).map((p) => p.id);
  for (let i = 0; i < 20; i++) {
    const picked = nameDistractors({
      pool: players, subject, rng: makeRng(i), count: 3, excludeIds: excluded,
    });
    assert.ok(picked.every((p) => !excluded.includes(p.id)));
  }
});
```

Add to `tests/engine/questions.test.js`:

```js
test('a teammate round names real teammates and never offers one as an option', () => {
  const { players, registry } = loadFixture();
  const messi = players.find((p) => p.name === 'Lionel Messi');
  const round = composeRound({
    subject: messi, metric: 'identity', window: registry.windows['wc-2022'],
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(2),
    stages: 4, clueFamily: 'teammate_trail',
  });

  assert.equal(round.clueFamily, 'teammate_trail');
  assert.ok(round.clues.length >= 3);
  // composeRound strips teammateId from the public clue shape, so the
  // test reads the names back out of the rendered value.
  const teammateNames = round.clues
    .map((c) => /^Played with (.+) at /.exec(c.value)?.[1])
    .filter(Boolean);
  assert.ok(teammateNames.length >= 2, 'a teammate round must name at least two teammates');
  const optionValues = new Set(round.options.map((o) => o.value));
  for (const name of teammateNames) {
    assert.ok(!optionValues.has(name), `${name} must not be an option`);
  }
});

test('the record book uses two distinct metrics and labels itself honestly', () => {
  const { players, registry } = loadFixture();
  const messi = players.find((p) => p.name === 'Lionel Messi');
  const round = composeRound({
    subject: messi, metric: 'identity', window: registry.windows['wc-2022'],
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(3),
    stages: 4, clueFamily: 'record_book',
  });

  assert.equal(round.clueFamily, 'record_book');
  const records = round.clues.filter((c) => c.label === 'The record');
  assert.ok(records.length >= 2);
  assert.ok(new Set(records.map((c) => c.id)).size === records.length);
});

test('a family with too little data falls back to mixed', () => {
  const subject = {
    id: 1, name: 'Synthetic', position: 'Midfield', dateOfBirth: '1990-01-01',
    citizenship: ['X'], heightCm: 180, internationalCaps: 3, internationalGoals: 0,
    highestMarketValueEur: 1000000, teams: [], windows: {}, stats: {},
  };
  const pool = [subject];
  const round = composeRound({
    subject, metric: 'identity', window: null, scope: { clauses: [] },
    registry: { windows: {}, leagues: {}, clubs: [], tournaments: [] },
    pool, rng: makeRng(1), stages: 3, clueFamily: 'teammate_trail',
  });
  assert.equal(round.clueFamily, 'mixed');
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
node --test tests/engine/questions.test.js tests/engine/distractors.test.js
```

Expected: the new tests fail; `clueFamily` is undefined and `excludeIds` is ignored.

- [ ] **Step 3: Add `excludeIds` to `nameDistractors`**

In `js/engine/distractors.js`:

```js
export function nameDistractors({ pool, subject, scope, rng, count = 3, excludeIds = [] }) {
  const excluded = new Set(excludeIds);
  const candidates = (pool ?? []).filter((p) =>
    (!subject || p.id !== subject.id) && !excluded.has(p.id));
  if (!candidates.length) return [];
  // ... rest unchanged
}
```

The `rest` fallback already draws from `candidates`, so the exclusion holds there too.

- [ ] **Step 4: Add the family merge to `composeRound`**

Import `familyClues`:

```js
import { buildHints, hintOrder, identityHook, familyClues } from './hints.js';
```

Add the helpers above `composeRound`:

```js
function dedupeById(hints) {
  const seen = new Set();
  return hints.filter((hint) => {
    if (!hint?.id || seen.has(hint.id)) return false;
    seen.add(hint.id);
    return true;
  });
}

/** The v1.2 mixed ladder: the vibe's number, the trail, a record, then a surface fact. */
function mixedOrder(ladder, n) {
  const hard = ladder.filter((h) => h.role === 'stage' || h.role === 'trail' || h.role === 'record');
  const profile = ladder.find((h) => h.role === 'profile');
  const home = ladder.find((h) => h.role === 'home');
  const ordered = [...hard];
  if (profile) ordered.push(profile);
  if (home) ordered.push(home);
  return home && n > 1
    ? [...ordered.filter((h) => h !== home).slice(0, n - 1), home]
    : ordered.slice(0, n);
}
```

Change the signature:

```js
export function composeRound({ subject, metric, window, scope, registry, pool, rng, difficulty = 'medium', roundMs = 20000, stages = 4, clueFamily = 'mixed' }) {
```

Replace the block from `const allHints = ...` through the `clues` assignment with:

```js
  const allHints = hintOrder(buildHints(subject, window, registry, { pool, scope }));
  const safeHints = allHints.filter(h => !hintRevealsAnswer(h, value));
  // Degrade safely: if every hint would reveal the answer, keep the round
  // usable and non-crashing instead of emitting zero clues.
  const baseLadder = safeHints.length ? safeHints : allHints;

  const own = clueFamily && clueFamily !== 'mixed'
    ? (familyClues(clueFamily, subject, window, registry, { pool, scope, rng }) ?? [])
    : [];
  const ownSafe = own.filter(h => !hintRevealsAnswer(h, value));
  const ownIds = new Set(ownSafe.map(h => h.id));
  const merged = dedupeById([...ownSafe, ...baseLadder]);

  const n = Math.max(1, stages);
  let clues = ownSafe.length >= 2 ? merged.slice(0, n) : mixedOrder(baseLadder, n);

  // The label is always honest: a family that could not put two of its own
  // clues on the ladder is a mixed round.
  if (clueFamily !== 'mixed' && clues.filter(h => ownIds.has(h.id)).length < 2) {
    clues = mixedOrder(baseLadder, n);
  }
  const effectiveFamily = clueFamily !== 'mixed'
    && clues.filter(h => ownIds.has(h.id)).length >= 2
    ? clueFamily
    : 'mixed';
```

Remove the old `const n = ...` and the old `hard`/`profile`/`home`/`ordered`/`clues` block. Keep `usedMetrics`.

Change the distractor call:

```js
  const teammateIds = [...new Set(clues.map(c => c.teammateId).filter(Boolean))];
  const isNumeric = recipe.template === 'stat_value';
  const distractors = isNumeric
    ? numericDistractors({ value, pool, subject, metric, window, rng, count: 3 }).map(String)
    : nameDistractors({ pool, subject, scope, rng, count: 3, excludeIds: teammateIds });
```

Add `clueFamily: effectiveFamily` to the returned object, next to `family`.

- [ ] **Step 5: Export the new engine API**

In `js/engine/index.js`:

```js
export {
  buildHints, hintOrder, identityHook, recordHints, profileHints, teammateHints,
  familyClues, CLUE_FAMILIES, CLUE_FAMILY_LABELS,
} from './hints.js';
```

Remove the old `buildHints, hintOrder, identityHook` export line.

- [ ] **Step 6: Run the tests**

```bash
node --test tests/engine/questions.test.js tests/engine/distractors.test.js tests/engine/hints.test.js
```

Expected: all pass. The existing stat-round tests must still pass: `composeRound` with `clueFamily` omitted uses the mixed ladder and the numeric branch is unchanged.

- [ ] **Step 7: Commit**

```bash
git add js/engine/questions.js js/engine/distractors.js js/engine/index.js tests/engine/questions.test.js tests/engine/distractors.test.js
git commit -m "feat: compose rounds from clue families"
```

---

## Task 3: Family schedule and removing stat rounds from the shipped mix

**Files:**
- Modify: `js/engine/planner.js`
- Modify: `client/src/store.js`
- Modify: `supabase/functions/_shared/start-room.js`
- Test: `tests/engine/planner.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/engine/planner.test.js`:

```js
import { CLUE_FAMILIES } from '../../js/engine/hints.js';
import { clueFamilySchedule } from '../../js/engine/planner.js';
import { makeRng } from '../../js/engine/rng.js';

const barcaScope = { v: 2, name: 'Barcelona', clauses: [{ teams: [8] }] };

test('a solo quiz is ten identify rounds and zero stat rounds', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 1, rounds: 10, phases: ['v1.1'] });
  assert.equal(plan.rounds.filter((r) => r.template === 'identify').length, 10);
  assert.equal(plan.rounds.filter((r) => r.template === 'stat_value').length, 0);
});

test('the family schedule gives ten rounds two of each family', () => {
  const schedule = clueFamilySchedule(10, makeRng(1));
  assert.equal(schedule.length, 10);
  const counts = {};
  for (const family of schedule) counts[family] = (counts[family] ?? 0) + 1;
  for (const family of CLUE_FAMILIES) assert.equal(counts[family], 2, `${family} rounds`);
});

test('a ten-round plan labels every round with a known family', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope: barcaScope, pool: players, registry, seed: 1, rounds: 10 });
  assert.equal(plan.rounds.length, 10);
  for (const round of plan.rounds) {
    assert.ok(CLUE_FAMILIES.includes(round.clueFamily), `${round.clueFamily} is a known family`);
  }
  // Some families fall back to mixed on a thin player; the plan still has
  // to offer variety, not ten identical ladders.
  const kinds = new Set(plan.rounds.map((r) => r.clueFamily));
  assert.ok(kinds.size >= 3, `only ${kinds.size} kinds of clue`);
  assert.equal(plan.summary.clueFamilies, kinds.size);
});

test('the same seed puts the same clue families in the same order', () => {
  const { players, registry } = loadFixture();
  const make = (seed) => planQuiz({ scope: barcaScope, pool: players, registry, seed, rounds: 10 });
  assert.deepEqual(
    make(7).rounds.map((r) => r.clueFamily),
    make(7).rounds.map((r) => r.clueFamily),
  );
});

test('a shorter schedule cycles every family once before repeating', () => {
  const schedule = clueFamilySchedule(7, makeRng(1));
  assert.equal(schedule.length, 7);
  assert.equal(new Set(schedule).size, 5);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
node --test tests/engine/planner.test.js
```

Expected: `clueFamily` is undefined and `summary.clueFamilies` is undefined.

- [ ] **Step 3: Add the seeded family schedule**

In `js/engine/planner.js`:

```js
import { CLUE_FAMILIES } from './hints.js';
```

Add above `planQuiz`:

```js
/**
 * The clue family for each identify slot.
 *
 * Ten rounds get two of each family, fully shuffled. Any other count
 * cycles a seeded family order, so a shorter game still sees variety.
 */
export function clueFamilySchedule(rounds, rng) {
  const order = shuffle(rng, [...CLUE_FAMILIES]);
  if (rounds === 10) return shuffle(rng, [...order, ...order]);
  const out = [];
  while (out.length < rounds) {
    for (const family of order) {
      if (out.length >= rounds) break;
      out.push(family);
    }
  }
  return out;
}
```

Inside `planQuiz`, after the stat slots are chosen:

```js
  const identifyCount = rounds - statCount;
  const familySchedule = clueFamilySchedule(identifyCount, rng);
  let familyCursor = 0;
```

Inside the loop, after `const wanted = ...`:

```js
    const clueFamily = wanted === 'identify'
      ? familySchedule[familyCursor++] ?? 'mixed'
      : 'mixed';
```

Pass it to `composeRound`:

```js
      stages,
      clueFamily,
```

Add the summary count:

```js
  const clueFamilies = new Set(plan.map(r => r.clueFamily).filter(Boolean));
```

and in `summary`:

```js
      clueFamilies: clueFamilies.size,
```

Keep `metricFamilies`.

- [ ] **Step 4: Stop requesting stat rounds**

In `client/src/store.js`, delete the line:

```js
      statRounds: 3,
```

In `supabase/functions/_shared/start-room.js`, delete the line:

```js
        statRounds: 3,
```

Leave `phases: ['v1.1']` in both calls.

- [ ] **Step 5: Run the tests**

```bash
node --test tests/engine/planner.test.js tests/engine/integration.test.js
```

Expected: all pass, including the existing `statRounds: 3` tests. A fallback to `mixed` is expected and allowed by the spec: the record book only supports about half the Barcelona pool, so the plan test asserts variety, not an exact two-per-family count. The exact two-per-family property is tested on `clueFamilySchedule` itself.

- [ ] **Step 6: Commit**

```bash
git add js/engine/planner.js client/src/store.js supabase/functions/_shared/start-room.js tests/engine/planner.test.js
git commit -m "feat: schedule clue families and drop stat rounds from the mix"
```

---

## Task 4: Scoring breakdown helper

**Files:**
- Modify: `js/engine/scoring.js`
- Test: `tests/engine/scoring.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/scoring.test.js`:

```js
import { scoreRound, scoreBreakdown, STAGE_MULTIPLIERS } from '../../js/engine/scoring.js';

test('the breakdown recomputes the awarded points from the stage and response time', () => {
  const scored = scoreRound({ correct: true, stage: 3, elapsedMs: 4000 });
  const shown = scoreBreakdown({ stage: 3, elapsedMs: 4000 });
  assert.equal(shown.multiplier, 2);
  assert.equal(shown.timeFactor, scored.timeFactor);
  assert.equal(Math.round(1000 * shown.multiplier * shown.timeFactor), scored.points);
});

test('stored values win over recomputation', () => {
  const shown = scoreBreakdown({ stage: 2, elapsedMs: 9000, multiplier: 3, timeFactor: 1.25 });
  assert.deepEqual(shown, { multiplier: 3, timeFactor: 1.25 });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
node --test tests/engine/scoring.test.js
```

Expected: `scoreBreakdown` is not exported.

- [ ] **Step 3: Add the helper**

In `js/engine/scoring.js`:

```js
/**
 * What the reveal says the answer was worth. Solo passes the multiplier and
 * time factor it stored with the answer; a room passes the stage and the
 * response time and gets the same numbers recomputed.
 */
export function scoreBreakdown({ stage, elapsedMs = 0, multiplier, timeFactor }) {
  const scored = scoreRound({ correct: false, stage, elapsedMs });
  return {
    multiplier: multiplier ?? scored.multiplier,
    timeFactor: timeFactor ?? scored.timeFactor,
  };
}
```

- [ ] **Step 4: Export it**

In `js/engine/index.js`:

```js
export { scoreRound, scoreBreakdown, STAGE_MULTIPLIERS } from './scoring.js';
```

- [ ] **Step 5: Run the tests**

```bash
node --test tests/engine/scoring.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add js/engine/scoring.js js/engine/index.js tests/engine/scoring.test.js
git commit -m "feat: add the reveal scoring breakdown"
```

---

## Task 5: Solo round screen and the family chip

**Files:**
- Modify: `client/src/screens/round.js`
- Modify: `client/styles/screens/round.css`
- Test: `tests/client/client.spec.js`

- [ ] **Step 1: Update the old timed-ladder tests and add the new UI tests**

Three existing tests describe the old timed ladder. Update them first.

In `a quiz round shows the window banner, the ladder, clues and four options`, the first clue is free and visible at once:

```js
  // the first clue is free; the rest cost multiplier
  await expect(page.locator('.clue-card.is-revealed')).toHaveCount(1);
```

In `the clue ladder reads like a scouting report, not column headings`, allow the new family labels:

```js
    expect([
      'The stage', 'The trail', 'The record', 'The profile', 'The home',
      'The role', 'The birth year', 'The height', 'The teammate',
    ]).toContain(label);
```

Replace `clues reveal on the schedule and the answer leads to the reveal` with:

```js
test('a revealed clue and the answer lead to the reveal', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);

  await page.locator('#btn-reveal-clue').click();
  await expect(page.locator('.clue-card.is-revealed')).toHaveCount(2);

  await page.locator('.option').first().click();
  await expect(page).toHaveURL(/#reveal/);
  await expect(page.locator('.reveal-card__name')).not.toBeEmpty();
  await expect(page.locator('.verdict')).toBeVisible();
  expect(errors).toEqual([]);
});
```

Then replace the test `a solo quiz mixes three stat rounds into ten` with:

```js
test('a solo quiz is ten identify rounds with a clue family on every round', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);
  const rounds = await page.evaluate(async () => {
    const { store } = await import('/src/store.js');
    return store.state.quiz.rounds.map((round) => ({
      template: round.template,
      family: round.clueFamily,
    }));
  });
  expect(rounds).toHaveLength(10);
  expect(rounds.every((round) => round.template === 'identify')).toBe(true);
  expect(new Set(rounds.map((round) => round.family)).size).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('one clue is visible at round start and revealing lowers the multiplier', async ({ page }) => {
  await startQuiz(page);

  await expect(page.locator('.clue-card.is-revealed')).toHaveCount(1);
  const first = await page.locator('.clue-card__value').first().innerText();
  expect(first).not.toBe('— — —');

  await expect(page.locator('#btn-reveal-clue')).toContainText('×3');
  await page.locator('#btn-reveal-clue').click();

  await expect(page.locator('.clue-card.is-revealed')).toHaveCount(2);
  await expect(page.locator('#btn-reveal-clue')).toContainText('×2');
});

test('the round shows its clue family', async ({ page }) => {
  await startQuiz(page);
  await expect(page.locator('.round-meta__chip')).toHaveText(
    /Career trail|Teammate trail|Record book|Profile|Mixed bag/,
  );
});

test('answering immediately locks the x5 stage and shows the breakdown', async ({ page }) => {
  await startQuiz(page);
  await page.locator('.option').first().click();
  await expect(page).toHaveURL(/#reveal/);

  const answer = await page.evaluate(async () => {
    const { store } = await import('/src/store.js');
    return store.state.answers[0];
  });
  expect(answer.stage).toBe(1);
  expect(answer.multiplier).toBe(5);
  await expect(page.locator('.verdict__breakdown')).toContainText('×5');
});
```

- [ ] **Step 2: Run the new tests and watch them fail**

```bash
npx playwright test tests/client/client.spec.js --grep "one clue is visible|clue family|answering immediately|ten identify"
```

Expected: the reveal button and the chip do not exist; the mix test still finds stat rounds.

- [ ] **Step 3: Replace the timed ladder in `round.js`**

At the top:

```js
import { answerRound, STAGE_MULTIPLIERS, resolveWindow, CLUE_FAMILY_LABELS } from '/js/engine/index.js';
```

Module state:

```js
// Solo owns its clue index. A room's index comes from the server.
let clueIndex = 0;
let revealInFlight = false;
```

Delete `revealedStages`.

Change the round selection:

```js
  const round = inRoom ? roomState.round : store.currentRound();
```

After the answered check, add:

```js
  // A room's ladder can be replaced by a poll or a reveal; always read the
  // live one, never the array captured by this render.
  const liveClues = () => (inRoom ? (roomState.round?.clues ?? round.clues) : round.clues);
  const visibleCount = () => {
    const total = liveClues().length;
    const index = inRoom ? (roomState.round?.clue_index ?? 0) : clueIndex;
    return Math.min(total, Math.max(1, index + 1));
  };
```

In the round-key reset block, also reset the new state:

```js
  if (roundKey !== lastRoundKey) {
    lastRoundKey = roundKey;
    revealedBefore = 0;
    clueIndex = 0;
    revealInFlight = false;
    lastTick = null;
  }
```

Build the reveal button after `ladderEl`:

```js
  const revealBtn = el('button', {
    className: 'btn btn--secondary btn--reveal',
    attrs: { type: 'button', id: 'btn-reveal-clue' },
  });
  revealBtn.addEventListener('click', async () => {
    if (now() >= deadline) return;
    const total = liveClues().length;
    if (visibleCount() >= total) return;

    if (inRoom) {
      if (revealInFlight) return;
      revealInFlight = true;
      paint();
      await room.revealClue();
      revealInFlight = false;
      // The new clue's chime comes from paint(), once, when it sees the
      // index move. Ringing it here too would double it.
      paint();
      return;
    }

    clueIndex = Math.min(total - 1, clueIndex + 1);
    paint();
  });
```

In the option click handler, replace the solo stage calculation:

```js
        const elapsed = Math.max(0, now() - startedAt);
        if (inRoom) {
          const scored = await room.answer(opt.value ?? opt.label, round.round_number);
          if (!scored) return;
          location.hash = '#reveal';
          return;
        }
        const stage = Math.min(round.clues.length, clueIndex + 1);
        const scored = answerRound(round, { answer: opt.value ?? opt.label, stage, elapsedMs: elapsed });
        store.recordAnswer({
          roundIndex: store.state.roundIndex,
          stage,
          multiplier: scored.multiplier,
          timeFactor: scored.timeFactor,
          correct: scored.correct,
          points: scored.points,
          chosen: opt.label,
          answer: round.answer,
        });
        location.hash = '#reveal';
```

In `paint()`, delete `const elapsed = Math.max(0, now() - startedAt);` and replace `const revealed = revealedStages(round, elapsed);` with:

```js
    const revealed = visibleCount();
```

Use `liveClues()` for the clue values:

```js
    clueEls.forEach((c, i) => {
      const shown = i < revealed;
      c.valueEl.textContent = shown ? liveClues()[i].value : '— — —';
      c.cardEl.classList.toggle('is-revealed', shown);
      c.cardEl.classList.toggle('is-locked', !shown);
    });
```

Add the reveal button state after the step loop:

```js
    if (revealed >= liveClues().length) {
      revealBtn.textContent = 'All clues revealed.';
      revealBtn.disabled = true;
    } else {
      revealBtn.textContent = `Reveal next clue (×${STAGE_MULTIPLIERS[revealed + 1]})`;
      revealBtn.disabled = expired || revealInFlight;
    }
```

In the mount, add the chip and the button:

```js
    el('div', { className: 'round-meta' }, [
      el('span', {
        className: 'muted-note',
        text: inRoom
          ? `Round ${roomState.round.round_number} of ${roomState.totalRounds}`
          : `Round ${round.stage} of ${quiz.rounds.length}`,
      }),
      (() => {
        const family = inRoom ? roomState.round.clue_family : round.clueFamily;
        return CLUE_FAMILY_LABELS[family]
          ? el('span', { className: 'round-meta__chip', text: CLUE_FAMILY_LABELS[family] })
          : null;
      })(),
    ].filter(Boolean)),

    ladderEl,
    revealBtn,
    clueHost,
```

- [ ] **Step 4: Style the chip and the button**

In `client/styles/screens/round.css`, replace `.round-meta { padding: 0 14px 6px; }` with:

```css
.round-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 14px 6px;
}
.round-meta__chip {
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--muted);
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 2px 7px;
  white-space: nowrap;
}
.btn--reveal {
  display: block;
  width: calc(100% - 24px);
  box-sizing: border-box;
  margin: 0 12px 8px;
}
```

- [ ] **Step 5: Run the solo tests**

```bash
npx playwright test tests/client/client.spec.js
```

Expected: all solo tests pass. The old timer test `the option button survives the round timer` still passes because options are not rebuilt.

- [ ] **Step 6: Commit**

```bash
git add client/src/screens/round.js client/styles/screens/round.css tests/client/client.spec.js
git commit -m "feat: reveal solo clues on demand"
```

---

## Task 6: Reveal breakdown and clue-family recap

**Files:**
- Modify: `client/src/screens/reveal.js`
- Modify: `client/src/screens/results.js`
- Modify: `client/styles/screens/round.css`
- Test: `tests/client/client.spec.js` (the breakdown assertion from Task 5)

- [ ] **Step 1: Add the breakdown helper to the reveal**

At the top of `client/src/screens/reveal.js`:

```js
import { careerClubs, scoreBreakdown } from '/js/engine/index.js';
```

Add above `render`:

```js
function breakdownText({ stage, multiplier, timeFactor, elapsedMs }) {
  if (!stage) return null;
  const shown = scoreBreakdown({ stage, elapsedMs: elapsedMs ?? 0, multiplier, timeFactor });
  const bits = [`×${shown.multiplier} clue stage`];
  if (Number.isFinite(shown.timeFactor)) bits.push(`${shown.timeFactor.toFixed(2)}× speed`);
  return bits.join(' · ');
}
```

In the solo render, after `const answer = ...`, compute:

```js
  const breakdown = answer
    ? breakdownText({
      stage: answer.stage,
      multiplier: answer.multiplier,
      timeFactor: answer.timeFactor,
    })
    : null;
```

In the solo verdict card, after the points span:

```js
      breakdown ? el('p', { className: 'verdict__breakdown', text: breakdown }) : null,
```

In `renderRoom`, after `const answer = result?.my_answer ?? roomState.myAnswer;`:

```js
  const mySteal = (result?.effects ?? []).find(
    (e) => e.kind === 'steal' && e.actor_id === roomState.me,
  );
  const nothingToCopy = Boolean(mySteal && (mySteal.target_stole || !mySteal.target_answered));
  const breakdown = answer?.stage && !nothingToCopy
    ? breakdownText({
      stage: answer.stage,
      elapsedMs: answer.response_time_ms ?? 0,
    })
    : null;
```

Remove the later duplicate `const mySteal = effects.find(...)` line and use the one already computed. In the room verdict card, after the points span:

```js
      breakdown ? el('p', { className: 'verdict__breakdown', text: breakdown }) : null,
```

- [ ] **Step 2: Show the clue-family recap in results**

In `client/src/screens/results.js`, replace the `metricFamilies` block:

```js
  // The current mode is all "who is this?", so the interesting variety is
  // the kind of clue ladder, not the question type.
  if (summary.clueFamilies > 1) {
    recapBits.push(`${summary.clueFamilies} kinds of clue`);
  }
```

In `tests/client/client.spec.js`, the results test still expects the old
question-type line. Change:

```js
  await expect(page.locator('.card').filter({ hasText: 'Your quiz' }))
    .toContainText('kinds of clue');
```

- [ ] **Step 3: Style the breakdown**

In `client/styles/screens/round.css`, add:

```css
.verdict__breakdown {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 0;
}
```

- [ ] **Step 4: Run the solo tests**

```bash
npx playwright test tests/client/client.spec.js --grep "breakdown|ten identify"
```

Expected: the breakdown line appears and reads `×5 clue stage · …× speed`.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/reveal.js client/src/screens/results.js client/styles/screens/round.css
git commit -m "feat: show the scoring breakdown and clue-family recap"
```

---

## Task 7: Room migration and server functions

**Files:**
- Create: `supabase/migrations/20261101000100_press_your_luck.sql`
- Modify: `supabase/functions/_shared/projection.js`
- Modify: `supabase/functions/_shared/start-room.js`
- Modify: `supabase/functions/_shared/submit-answer.js`
- Test: `tests/shared/projection.test.js`

This task is the server contract. The client in Task 8 depends on it.

- [ ] **Step 1: Update the projection test first**

In `tests/shared/projection.test.js`, add `clueFamily: 'career_trail'` to the `composed` fixture and assert:

```js
test('the client row carries the clue family', () => {
  const { client } = projectRound(composed, 1);
  assert.equal(client.clue_family, 'career_trail');
});
```

Update the exact-key assertion to include `clue_family`:

```js
  assert.deepEqual(Object.keys(client).sort(), [
    'clue_family', 'clues', 'context', 'options', 'prompt', 'reveal_schedule', 'round_number', 'template',
  ]);
```

- [ ] **Step 2: Run the projection test and watch it fail**

```bash
node --test tests/shared/projection.test.js
```

Expected: `clue_family` is missing.

- [ ] **Step 3: Project the family**

In `supabase/functions/_shared/projection.js`, add to `client`:

```js
      clue_family: round.clueFamily ?? null,
```

- [ ] **Step 4: Create the migration**

Create `supabase/migrations/20261101000100_press_your_luck.sql` with exactly this content:

```sql
-- Press-your-luck clue progress, per player, per round.
--
-- The room's round is shared; the ladder is not. A player who pays for a
-- clue lowers only their own multiplier.

alter table public.rounds add column if not exists clue_family text;

create table if not exists public.round_progress (
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clue_index int not null default 0 check (clue_index >= 0),
  updated_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

alter table public.round_progress enable row level security;

drop policy if exists round_progress_select on public.round_progress;
create policy round_progress_select on public.round_progress for select
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.rounds r
      where r.id = round_id and public.is_room_member(r.room_id)
    )
  );

-- No client insert or update policy: every write goes through reveal_clue.

create or replace function public.reveal_clue(
  p_room_id uuid,
  p_round_number int,
  p_clue_index int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_current int;
  v_total int;
  v_clues jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  if v_room.id is null or v_room.status <> 'round_active' then
    raise exception 'that game is not running' using errcode = '22023';
  end if;

  if v_room.current_round <> p_round_number then
    raise exception 'that round is not open' using errcode = '22023';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;
  if v_round.id is null then
    raise exception 'that round is not open' using errcode = '22023';
  end if;

  if v_round.closed_at is not null or now() > v_round.deadline_at then
    raise exception 'too late - that round is over' using errcode = '22023';
  end if;

  v_total := jsonb_array_length(coalesce(v_round.clues, '[]'::jsonb));

  select p.clue_index into v_current
  from public.round_progress p
  where p.round_id = v_round.id and p.user_id = auth.uid();

  v_current := least(greatest(coalesce(v_current, 0), 0), greatest(v_total - 1, 0));

  -- A stale tap or a double tap returns the current state. It never
  -- advances, and it never moves another player's ladder.
  if p_clue_index = v_current and v_current < v_total - 1 then
    insert into public.round_progress (round_id, user_id, clue_index, updated_at)
    values (v_round.id, auth.uid(), v_current + 1, now())
    on conflict (round_id, user_id)
    do update set
      clue_index = greatest(public.round_progress.clue_index, excluded.clue_index),
      updated_at = now()
    returning clue_index into v_current;
  end if;

  select coalesce(jsonb_agg(
    case
      when (ordinality - 1) <= v_current then c
      else jsonb_build_object(
        'id', c->>'id',
        'label', c->>'label',
        'value', null,
        'iconKey', c->'iconKey'
      )
    end
    order by ordinality
  ), '[]'::jsonb)
  into v_clues
  from jsonb_array_elements(coalesce(v_round.clues, '[]'::jsonb)) with ordinality as t(c, ordinality);

  return jsonb_build_object(
    'round_number', p_round_number,
    'clue_index', v_current,
    'clue_total', v_total,
    'clues', v_clues
  );
end;
$$;

-- The old one-argument functions are dropped, then recreated with a
-- defaulted second argument. Both the old one-argument call and the new
-- two-argument call resolve to the new function.
drop function if exists public.sync_room_state(uuid);
drop function if exists public.current_round(uuid);

create or replace function public.current_round(
  p_room_id uuid,
  p_on_demand boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_total int;
  v_index int;
  v_clues jsonb;
  v_payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  perform public.advance_room(p_room_id);

  -- The poll is the heartbeat, so liveness costs no extra traffic. It
  -- comes after the advance so that every transaction takes the room's
  -- lock before it takes a membership's.
  update public.room_memberships
  set last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();

  select * into v_room from public.rooms where id = p_room_id;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;

  if v_round.id is null then
    return jsonb_build_object(
      'status', v_room.status,
      'current_round', v_room.current_round,
      'total_rounds', v_room.total_rounds,
      'scope_id', v_room.scope_id,
      'scope_name', v_room.scope_name,
      'round', null
    );
  end if;

  v_total := jsonb_array_length(coalesce(v_round.clues, '[]'::jsonb));

  if p_on_demand then
    select p.clue_index into v_index
    from public.round_progress p
    where p.round_id = v_round.id and p.user_id = auth.uid();
    v_index := least(greatest(coalesce(v_index, 0), 0), greatest(v_total - 1, 0));

    select coalesce(jsonb_agg(
      case
        when (ordinality - 1) <= v_index then c
        else jsonb_build_object(
          'id', c->>'id',
          'label', c->>'label',
          'value', null,
          'iconKey', c->'iconKey'
        )
      end
      order by ordinality
    ), '[]'::jsonb)
    into v_clues
    from jsonb_array_elements(coalesce(v_round.clues, '[]'::jsonb)) with ordinality as t(c, ordinality);
  else
    v_index := 0;
    v_clues := v_round.clues;
  end if;

  v_payload := jsonb_build_object(
    'id', v_round.id,
    'round_number', v_round.round_number,
    'template', v_round.template,
    'prompt', v_round.prompt,
    'context', v_round.context,
    'clues', v_clues,
    'options', v_round.options,
    'reveal_schedule', v_round.reveal_schedule,
    'started_at', v_round.started_at,
    'deadline_at', v_round.deadline_at,
    'clue_index', v_index,
    'clue_total', v_total,
    'clue_family', v_round.clue_family
  );

  if p_on_demand then
    v_payload := v_payload - 'reveal_schedule';
  end if;

  return jsonb_build_object(
    'status', v_room.status,
    'current_round', v_room.current_round,
    'total_rounds', v_room.total_rounds,
    'scope_id', v_room.scope_id,
    'scope_name', v_room.scope_name,
    'round', v_payload
  );
end;
$$;

create or replace function public.sync_room_state(
  p_room_id uuid,
  p_on_demand boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_answered_round int;
  v_mine jsonb;
  v_effects jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_state := public.current_round(p_room_id, p_on_demand);

  select max(r.round_number) into v_answered_round
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where a.room_id = p_room_id and a.user_id = auth.uid();

  select jsonb_build_object(
      'correct', a.is_correct,
      'points', a.points_earned,
      'stage', a.stage_locked,
      'response_time_ms', a.response_time_ms,
      'guessed_answer', a.guessed_answer
    ) into v_mine
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where a.room_id = p_room_id and a.user_id = auth.uid()
    and r.round_number = v_answered_round;

  select coalesce(jsonb_agg(jsonb_build_object(
      'round_number', r.round_number,
      'kind', e.kind,
      'role', case when e.actor_id = auth.uid() then 'actor' else 'target' end,
      'other_id', case when e.actor_id = auth.uid() then e.target_id else e.actor_id end,
      'resolved', e.resolved_at is not null,
      'bonus_points', e.bonus_points
    ) order by r.round_number, e.created_at, e.id), '[]'::jsonb)
  into v_effects
  from public.room_effects e
  join public.rounds r on r.id = e.round_id
  where e.room_id = p_room_id
    and (
      e.actor_id = auth.uid()
      or (e.kind = 'steal' and e.target_id = auth.uid())
    );

  return v_state || jsonb_build_object(
    'my_answered_round', v_answered_round,
    'my_answer', v_mine,
    'my_effects', v_effects,
    'scope_icon', (select r.scope_icon from public.rooms r where r.id = p_room_id),
    'server_now', now(),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', m.display_name,
        'is_host', m.is_host,
        'joined_seq', m.joined_seq,
        'online', m.last_seen_at > now() - interval '30 seconds'
      ) order by m.joined_seq)
      from public.room_memberships m
      where m.room_id = p_room_id
    ), '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', m.display_name,
        'total_score', m.total_score,
        'correct_count', m.correct_count,
        'total_response_ms', m.total_response_ms,
        'joined_seq', m.joined_seq
      ) order by m.total_score desc, m.correct_count desc,
               m.total_response_ms asc, m.joined_seq asc)
      from public.room_memberships m
      where m.room_id = p_room_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.advance_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_next jsonb;
  v_started timestamptz;
  v_next_round public.rounds;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id for no key update;
  if v_room.id is null or v_room.status <> 'round_active' then
    return;
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;
  if v_round.id is null then
    return;
  end if;

  if now() <= v_round.deadline_at and exists (
    select 1 from public.room_memberships m
    where m.room_id = p_room_id
      and not exists (
        select 1 from public.answers a
        where a.round_id = v_round.id and a.user_id = m.user_id
      )
  ) then
    return;
  end if;

  update public.rounds set closed_at = now() where id = v_round.id;

  update public.answers a
  set guessed_answer = t.guessed_answer,
      is_correct = t.is_correct,
      stage_locked = t.stage_locked,
      response_time_ms = t.response_time_ms,
      points_earned = case when t.is_correct then t.points_earned / 2 else 0 end
  from public.room_effects e
  join public.answers t
    on t.round_id = e.round_id and t.user_id = e.target_id
  where e.round_id = v_round.id
    and e.kind = 'steal'
    and a.round_id = e.round_id
    and a.user_id = e.actor_id
    and not exists (
      select 1 from public.room_effects x
      where x.round_id = e.round_id
        and x.actor_id = e.target_id
        and x.kind = 'steal'
    );

  update public.room_effects e
  set resolved_at = now()
  where e.round_id = v_round.id
    and e.kind = 'steal'
    and e.resolved_at is null;

  update public.room_effects e
  set bonus_points = case
        when exists (
          select 1 from public.answers a
          where a.round_id = e.round_id and a.user_id = e.actor_id
        )
        and exists (
          select 1 from public.answers t
          where t.round_id = e.round_id
            and t.user_id = e.target_id
            and t.is_correct
        )
      then 500
      else 0
      end,
      resolved_at = now()
  where e.round_id = v_round.id
    and e.kind = 'side_bet'
    and e.resolved_at is null;

  update public.room_memberships m
  set total_score = m.total_score + coalesce(t.points, 0),
      correct_count = m.correct_count + coalesce(t.corrects, 0),
      total_response_ms = m.total_response_ms + coalesce(t.elapsed, 0)
  from (
    select user_id,
           sum(points_earned) as points,
           sum(case when is_correct then 1 else 0 end) as corrects,
           sum(response_time_ms) as elapsed
    from public.answers
    where round_id = v_round.id
    group by user_id
  ) t
  where m.room_id = p_room_id and m.user_id = t.user_id;

  update public.room_memberships m
  set total_score = m.total_score + b.bonus
  from (
    select actor_id, sum(bonus_points) as bonus
    from public.room_effects
    where round_id = v_round.id
      and kind = 'side_bet'
      and resolved_at is not null
    group by actor_id
  ) b
  where m.room_id = p_room_id and m.user_id = b.actor_id and b.bonus > 0;

  if not exists (
    select 1 from public.room_memberships
    where room_id = p_room_id and is_host and last_seen_at > now() - interval '30 seconds'
  ) then
    update public.room_memberships
    set is_host = false
    where room_id = p_room_id and is_host;

    update public.room_memberships m
    set is_host = true
    where m.id = (
      select id from public.room_memberships
      where room_id = p_room_id
        and last_seen_at > now() - interval '30 seconds'
      order by joined_seq
      limit 1
    );
  end if;

  if v_room.current_round >= v_room.total_rounds then
    update public.rooms set status = 'final', finished_at = now() where id = p_room_id;
    return;
  end if;

  select e into v_next
  from public.quiz_plans q, jsonb_array_elements(q.plan) e
  where q.room_id = p_room_id
    and (e->'client'->>'round_number')::int = v_room.current_round + 1;

  if v_next is null then
    update public.rooms set status = 'abandoned' where id = p_room_id;
    return;
  end if;

  v_started := now();

  insert into public.rounds (
    room_id, round_number, template, prompt, context,
    clues, options, reveal_schedule, clue_family, started_at, deadline_at
  )
  values (
    p_room_id,
    (v_next->'client'->>'round_number')::int,
    v_next->'client'->>'template',
    v_next->'client'->>'prompt',
    v_next->'client'->>'context',
    v_next->'client'->'clues',
    v_next->'client'->'options',
    v_next->'client'->'reveal_schedule',
    v_next->'client'->>'clue_family',
    v_started,
    v_started + interval '20 seconds'
  )
  returning * into v_next_round;

  insert into public.round_secrets (round_id, answer_value, target_player_id, unit)
  values (
    v_next_round.id,
    v_next->'secret'->>'answer_value',
    nullif(v_next->'secret'->>'target_player_id', '')::bigint,
    nullif(v_next->'secret'->>'unit', '')
  );

  update public.rooms
  set current_round = current_round + 1, status = 'round_active'
  where id = p_room_id;
end;
$$;

create or replace function public.round_result(p_room_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds;
  v_secret public.round_secrets;
  v_leaderboard jsonb;
  v_mine jsonb;
  v_effects jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  perform public.advance_room(p_room_id);

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;
  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    return jsonb_build_object('pending', true, 'round_number', p_round_number);
  end if;

  select * into v_secret from public.round_secrets where round_id = v_round.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', m.display_name,
      'is_host', m.is_host,
      'total_score', m.total_score,
      'correct_count', m.correct_count,
      'total_response_ms', m.total_response_ms,
      'joined_seq', m.joined_seq
    ) order by m.total_score desc, m.correct_count desc,
             m.total_response_ms asc, m.joined_seq asc), '[]'::jsonb)
  into v_leaderboard
  from public.room_memberships m
  where m.room_id = p_room_id;

  select jsonb_build_object(
      'correct', a.is_correct,
      'points', a.points_earned,
      'stage', a.stage_locked,
      'response_time_ms', a.response_time_ms,
      'guessed_answer', a.guessed_answer
    ) into v_mine
  from public.answers a
  where a.round_id = v_round.id and a.user_id = auth.uid();

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', e.kind,
      'actor_id', e.actor_id,
      'target_id', e.target_id,
      'actor_points', coalesce(a.points_earned, 0),
      'target_correct', coalesce(t.is_correct, false),
      'target_answered', t.user_id is not null,
      'target_stole', exists (
        select 1 from public.room_effects x
        where x.round_id = e.round_id
          and x.actor_id = e.target_id
          and x.kind = 'steal'
      ),
      'bonus_points', e.bonus_points,
      'resolved', e.resolved_at is not null
    ) order by e.created_at, e.id), '[]'::jsonb)
  into v_effects
  from public.room_effects e
  left join public.answers a
    on a.round_id = e.round_id and a.user_id = e.actor_id
  left join public.answers t
    on t.round_id = e.round_id and t.user_id = e.target_id
  where e.round_id = v_round.id;

  return jsonb_build_object(
    'round_number', p_round_number,
    'answer', v_secret.answer_value,
    'unit', v_secret.unit,
    'target_player_id', v_secret.target_player_id,
    'clue_family', v_round.clue_family,
    'clue_total', jsonb_array_length(coalesce(v_round.clues, '[]'::jsonb)),
    'leaderboard', v_leaderboard,
    'my_answer', v_mine,
    'effects', v_effects
  );
end;
$$;

create or replace function public.use_room_effect(
  p_room_id uuid,
  p_round_number int,
  p_kind text,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_existing public.room_effects;
  v_effect public.room_effects;
  v_stage int;
  v_elapsed int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('steal', 'side_bet') then
    raise exception 'unknown effect' using errcode = '22023';
  end if;

  -- A lost response must not cost the player the effect. Check the spent
  -- effect before the clock so a retry after the close still returns it.
  select e.* into v_existing
  from public.room_effects e
  where e.room_id = p_room_id
    and e.actor_id = auth.uid()
    and e.kind = p_kind;

  if v_existing.id is not null then
    if exists (
      select 1 from public.rounds r
      where r.id = v_existing.round_id and r.round_number = p_round_number
    ) then
      return jsonb_build_object(
        'kind', v_existing.kind,
        'target_user_id', v_existing.target_id,
        'round_number', p_round_number,
        'already', true
      );
    end if;
    raise exception 'you already used that effect this game' using errcode = '22023';
  end if;

  -- The same lock advance_room takes. An effect either lands before the
  -- close and is resolved, or is refused because the round closed.
  select * into v_room from public.rooms where id = p_room_id for no key update;
  if v_room.id is null or v_room.status <> 'round_active' then
    raise exception 'that game is not running' using errcode = '22023';
  end if;

  if v_room.current_round <> p_round_number then
    raise exception 'that round is not open' using errcode = '22023';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;
  if v_round.id is null then
    raise exception 'that round is not open' using errcode = '22023';
  end if;

  if v_round.closed_at is not null or now() > v_round.deadline_at then
    raise exception 'too late - that round is over' using errcode = '22023';
  end if;

  if p_target_user_id = auth.uid() then
    raise exception 'you cannot use an effect on yourself' using errcode = '22023';
  end if;

  if p_target_user_id is null or not exists (
    select 1 from public.room_memberships m
    where m.room_id = p_room_id and m.user_id = p_target_user_id
  ) then
    raise exception 'that player is not in the room' using errcode = '22023';
  end if;

  if p_kind = 'steal' and exists (
    select 1 from public.answers a
    where a.round_id = v_round.id and a.user_id = auth.uid()
  ) then
    raise exception 'you already answered this round' using errcode = '22023';
  end if;

  begin
    insert into public.room_effects (room_id, round_id, actor_id, target_id, kind)
    values (p_room_id, v_round.id, auth.uid(), p_target_user_id, p_kind)
    returning * into v_effect;
  exception when unique_violation then
    -- A concurrent tap won the race. Return its row, not an error.
    select e.* into v_existing
    from public.room_effects e
    where e.room_id = p_room_id and e.actor_id = auth.uid() and e.kind = p_kind;
    if v_existing.round_id = v_round.id then
      return jsonb_build_object(
        'kind', v_existing.kind,
        'target_user_id', v_existing.target_id,
        'round_number', p_round_number,
        'already', true
      );
    end if;
    raise exception 'you already used that effect this game' using errcode = '22023';
  end;

  if p_kind = 'steal' then
    v_elapsed := greatest(
      0,
      floor(extract(epoch from (now() - v_round.started_at)) * 1000)::int
    );

    -- The thief's placeholder carries the thief's own stage, so a steal
    -- that copies nothing is still scored against what they had seen.
    select p.clue_index + 1 into v_stage
    from public.round_progress p
    where p.round_id = v_round.id and p.user_id = auth.uid();

    if v_stage is null then
      select greatest(1, count(*)::int) into v_stage
      from jsonb_array_elements(v_round.reveal_schedule) s
      where v_elapsed >= coalesce((s->>'revealAtMs')::int, 0);
    end if;

    v_stage := least(v_stage, greatest(jsonb_array_length(coalesce(v_round.clues, '[]'::jsonb)), 1));

    begin
      insert into public.answers (
        room_id, round_id, user_id, guessed_answer, is_correct,
        stage_locked, response_time_ms, points_earned, received_at
      ) values (
        p_room_id, v_round.id, auth.uid(), '', false,
        v_stage, v_elapsed, 0, now()
      );
    exception when unique_violation then
      -- The whole function rolls back, so there is no effect without a
      -- placeholder.
      raise exception 'you already answered this round' using errcode = '22023';
    end;
  end if;

  return jsonb_build_object(
    'kind', p_kind,
    'target_user_id', p_target_user_id,
    'round_number', p_round_number,
    'already', false
  );
end;
$$;

notify pgrst, 'reload schema';
```

- [ ] **Step 5: Add the on-demand stage to `submit-answer`**

In `supabase/functions/_shared/submit-answer.js`, after the body is read:

```js
    const onDemand = body.on_demand === true;
```

Replace the stage calculation with:

```js
    // The stage the server says the player answered at.
    //
    // On demand, the player's own clue index is the stage: one visible clue
    // is stage one. The old timed ladder is kept for a client that does not
    // send the flag.
    const elapsed = Math.max(0, receivedAt.getTime() - new Date(round.started_at).getTime());
    let stage;
    if (onDemand) {
      const { data: progress } = await admin
        .from('round_progress')
        .select('clue_index')
        .eq('round_id', round.id)
        .eq('user_id', userId)
        .maybeSingle();
      const total = Array.isArray(round.clues) ? round.clues.length : 1;
      stage = Math.min(total, Math.max(1, (progress?.clue_index ?? 0) + 1));
    } else {
      const schedule = round.reveal_schedule ?? [];
      stage = Math.max(1, schedule.filter((s) => elapsed >= (s.revealAtMs ?? 0)).length);
    }
```

- [ ] **Step 6: Project and insert `clue_family` in `start-room`**

In `roundPayload`, add:

```js
    clue_family: round.clue_family,
```

In the first-round insert, add:

```js
          clue_family: first.client.clue_family,
```

The `alreadyThere` retry path already selects `*`, so it carries the column.

- [ ] **Step 7: Run the shared tests**

```bash
node --test tests/shared/projection.test.js
```

Expected: pass.

- [ ] **Step 8: Apply the migration locally**

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:upload
```

Expected: the migration applies without error. `supabase:upload` needs the local stack; it is the same command the project already uses.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261101000100_press_your_luck.sql \
  supabase/functions/_shared/projection.js \
  supabase/functions/_shared/start-room.js \
  supabase/functions/_shared/submit-answer.js \
  tests/shared/projection.test.js
git commit -m "feat: add per-player room clue progress"
```

---

## Task 8: Room client state

**Files:**
- Modify: `client/src/room.js`
- Modify: `client/src/room-state.js`
- Test: `tests/shared/room-state.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/shared/room-state.test.js`:

```js
test('a poll that races a reveal cannot move the clue ladder backwards', () => {
  const state = {
    round: {
      id: 'r1', round_number: 1, clue_index: 2,
      clues: [{ value: 'one' }, { value: 'two' }, { value: 'three' }],
    },
  };
  applyRound(state, {
    current_round: 1,
    round: {
      id: 'r1', round_number: 1, clue_index: 1,
      clues: [{ value: 'one' }, { value: null }, { value: null }],
    },
  });
  assert.equal(state.round.clue_index, 2);
  assert.equal(state.round.clues[1].value, 'two');
});

test('a higher clue index from the server wins', () => {
  const state = {
    round: { id: 'r1', round_number: 1, clue_index: 0, clues: [{ value: 'one' }, { value: null }] },
  };
  applyRound(state, {
    current_round: 1,
    round: { id: 'r1', round_number: 1, clue_index: 1, clues: [{ value: 'one' }, { value: 'two' }] },
  });
  assert.equal(state.round.clue_index, 1);
  assert.equal(state.round.clues[1].value, 'two');
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
node --test tests/shared/room-state.test.js
```

Expected: the lower poll overwrites the higher index.

- [ ] **Step 3: Merge the clue index monotonically**

In `client/src/room-state.js`, replace `state.round = next;` with:

```js
  // Progress within a round only increases. A poll can race a reveal; the
  // poll must not move the ladder backwards or lock a clue the player has
  // already paid for.
  let merged = next;
  if (next && sameRound
    && typeof next.clue_index === 'number'
    && typeof state.round.clue_index === 'number'
    && state.round.clue_index > next.clue_index) {
    merged = {
      ...next,
      clue_index: state.round.clue_index,
      clues: state.round.clues,
    };
  }

  state.round = merged;
```

- [ ] **Step 4: Add `revealClue` and the on-demand flags**

In `client/src/room.js`, change the sync RPC call:

```js
  const { data, error } = await supabase.rpc('sync_room_state', {
    p_room_id: state.roomId,
    p_on_demand: true,
  });
```

Change the answer body:

```js
    const { status, data } = await invokeFunction('submit-answer', {
      room_id: state.roomId,
      round_number: state.round.round_number,
      guessed_answer: guessed,
      on_demand: true,
    });
```

Add `revealClue` next to `answer`:

```js
  /** Reveal the next clue for this player. The server owns the index. */
  async revealClue() {
    const supabase = await ensure();
    if (!supabase || !state.round) return null;
    const { data, error } = await supabase.rpc('reveal_clue', {
      p_room_id: state.roomId,
      p_round_number: state.round.round_number,
      p_clue_index: state.round.clue_index ?? 0,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    if (state.round && data?.round_number === state.round.round_number) {
      state.round = {
        ...state.round,
        clue_index: data.clue_index,
        clue_total: data.clue_total,
        clues: data.clues,
      };
    }
    state.error = null;
    notify();
    return data;
  },
```

- [ ] **Step 5: Run the room-state tests**

```bash
node --test tests/shared/room-state.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/room.js client/src/room-state.js tests/shared/room-state.test.js
git commit -m "feat: reveal room clues per player"
```

---

## Task 9: Room round screen and reveal integration

**Files:**
- Modify: `client/src/screens/round.js` (the room path added in Task 5)
- Modify: `client/src/screens/reveal.js` (the room breakdown added in Task 6)
- Test: `tests/client/room.spec.js`

The room path is already written in Tasks 5 and 6; this task proves it against the server.

- [ ] **Step 1: Update the rematch test and add the two-browser test**

The rematch test in `tests/client/room.spec.js` assumes a one-round room is a
stat round. A one-round room is now one identify round. Replace:

```js
  // A one-round room clamps the mix to one round, and that round is stat.
  await expect(host.locator('.round-prompt')).toContainText(/How many /);
```

with:

```js
  // A one-round room is a single identify round now.
  await expect(host.locator('.round-prompt')).toContainText('Who is this?');
```

and replace the numeric reveal assertion:

```js
  await expect(host.locator('.reveal-card__name')).toContainText(/\d+ (goal|goals|cap|caps)/);
```

with:

```js
  await expect(host.locator('.reveal-card__name')).not.toBeEmpty();
```

Then add the new test to `tests/client/room.spec.js`:

```js
test('each player reveals their own clues and is scored on their own stage', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  const errors = watchErrors(host);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  await expect(host.locator('.clue-card.is-revealed')).toHaveCount(1);
  await host.locator('#btn-reveal-clue').click();
  await expect(host.locator('.clue-card.is-revealed')).toHaveCount(2);
  await expect(guest.locator('.clue-card.is-revealed')).toHaveCount(1);

  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();

  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);
  await expect(host.locator('.verdict__breakdown')).toContainText('×3');
  await expect(guest.locator('.verdict__breakdown')).toContainText('×5');
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the room tests**

The local stack and functions must be running, and the functions must be re-prepared after the engine changes:

```bash
npm run supabase:serve
```

In another terminal:

```bash
npx playwright test tests/client/room.spec.js --grep "reveals their own clues"
```

Expected: pass. If the host sees one revealed clue after the reveal, check that `reveal_clue` is in the migration and that `room.revealClue` is called.

- [ ] **Step 3: Run the whole room suite**

```bash
npx playwright test tests/client/room.spec.js
```

Expected: everything passes except the two known base failures (`a player who refreshes mid-round keeps their score` and `the home screen can create a room`). Do not fix those in this plan.

- [ ] **Step 4: Commit**

```bash
git add tests/client/room.spec.js
git commit -m "test: cover per-player room clue progress"
```

---

## Task 10: Integration coverage, deploy note, and final gate

**Files:**
- Delete: `tests/integration/stat-rounds.test.js`
- Create: `tests/integration/press-your-luck.test.js`
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Delete the old room-level stat test**

```bash
git rm tests/integration/stat-rounds.test.js
```

The dormant stat capability stays covered by the engine tests in `tests/engine/questions.test.js` and `tests/engine/planner.test.js`.

- [ ] **Step 2: Write the room integration tests**

Create `tests/integration/press-your-luck.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A started one-round room. */
async function oneRoundRoom() {
  const host = await playerClient();
  const guest = await playerClient();
  const { data: room, error } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  assert.equal(error, null, error?.message);
  const joined = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Sam',
  });
  assert.equal(joined.error, null, joined.error?.message);

  const server = serverClient();
  const { error: updateError } = await server.from('rooms')
    .update({ total_rounds: 1 }).eq('id', room.id);
  assert.equal(updateError, null, updateError?.message);

  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  return { room, host, guest, server, round: started.body };
}

test('a ten-round room plan is all identify rounds', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const server = serverClient();
  const { data: plan } = await server.from('quiz_plans')
    .select('*').eq('room_id', room.id).single();
  const templates = plan.plan.map((round) => round.client.template);
  assert.equal(templates.filter((t) => t === 'identify').length, 10);
  assert.equal(templates.filter((t) => t === 'stat_value').length, 0);
  assert.ok(plan.plan.every((round) => round.client.clue_family));
});

test('the on-demand round shows one clue and names the family', { skip }, async () => {
  const { room, guest, round } = await oneRoundRoom();
  const { data, error } = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(error, null, error?.message);
  assert.equal(data.round.clue_index, 0);
  assert.equal(data.round.clue_total, round.clues.length);
  assert.ok(data.round.clue_family);
  assert.equal(data.round.reveal_schedule, undefined);
  assert.equal(data.round.clues.filter((c) => c.value !== null).length, 1);
});

test('reveal_clue advances only the caller', { skip }, async () => {
  const { room, host, guest } = await oneRoundRoom();
  const reveal = await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });
  assert.equal(reveal.error, null, reveal.error?.message);
  assert.equal(reveal.data.clue_index, 1);
  assert.equal(reveal.data.clues.filter((c) => c.value !== null).length, 2);

  const hostView = await host.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(hostView.data.round.clue_index, 0);

  const stale = await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });
  assert.equal(stale.data.clue_index, 1, 'a stale tap must not advance');
});

test('reveal_clue refuses a closed round', { skip }, async () => {
  const { room, guest, server } = await oneRoundRoom();
  await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('room_id', room.id);
  const late = await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });
  assert.ok(late.error, 'a reveal after the deadline must be refused');
});

test('submit-answer on demand scores the clue index', { skip }, async () => {
  const { room, host, guest, round } = await oneRoundRoom();

  const immediate = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, guest.accessToken);
  assert.equal(immediate.status, 200, JSON.stringify(immediate.body));
  assert.equal(immediate.body.stage, 1);

  for (let i = 0; i < 2; i++) {
    const reveal = await host.client.rpc('reveal_clue', {
      p_room_id: room.id, p_round_number: 1, p_clue_index: i,
    });
    assert.equal(reveal.error, null, reveal.error?.message);
  }
  const late = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, host.accessToken);
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.equal(late.body.stage, 3);
});

test('the old client shape still gets the timed ladder', { skip }, async () => {
  const { room, host, guest, server } = await oneRoundRoom();
  const { data, error } = await guest.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(error, null, error?.message);
  assert.ok(Array.isArray(data.round.reveal_schedule));
  assert.equal(data.round.clues.filter((c) => c.value !== null).length, data.round.clues.length);

  await server.from('rounds')
    .update({ started_at: new Date(Date.now() - 10000).toISOString() })
    .eq('room_id', room.id);
  const timed = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: data.round.options[0].value,
  }, host.accessToken);
  assert.equal(timed.status, 200, JSON.stringify(timed.body));
  assert.ok(timed.body.stage >= 2, 'the timed client must get the elapsed stage');
});

test('round_result carries the family, the total, and the response time', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, guest.accessToken);
  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, host.accessToken);

  const result = await guest.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.error, null, result.error?.message);
  assert.ok(result.data.clue_family);
  assert.equal(result.data.clue_total, round.clues.length);
  assert.equal(result.data.my_answer.stage, 1);
  assert.equal(typeof result.data.my_answer.response_time_ms, 'number');
});

test('a rematch deletes progress rows and the next game starts at zero', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });

  const { data: oldRound } = await server.from('rounds')
    .select('id').eq('room_id', room.id).eq('round_number', 1).single();

  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, guest.accessToken);
  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, host.accessToken);

  // The poll is what closes the round. Without it the room is still
  // round_active, and reset_room refuses a game that is not final.
  const closed = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(closed.error, null, closed.error?.message);
  assert.equal(closed.data.status, 'final');

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);

  const { data: progress } = await server.from('round_progress')
    .select('*').eq('round_id', oldRound.id);
  assert.equal(progress.length, 0, 'a rematch must cascade the progress rows');

  const restarted = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(restarted.status, 200, JSON.stringify(restarted.body));
  const view = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(view.data.round.clue_index, 0);
});

test('a steal on an on-demand round copies the target stage and half points', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();

  const steal = await host.client.rpc('use_room_effect', {
    p_room_id: room.id, p_round_number: 1, p_kind: 'steal', p_target_user_id: guest.userId,
  });
  assert.equal(steal.error, null, steal.error?.message);

  for (let i = 0; i < 2; i++) {
    const reveal = await guest.client.rpc('reveal_clue', {
      p_room_id: room.id, p_round_number: 1, p_clue_index: i,
    });
    assert.equal(reveal.error, null, reveal.error?.message);
  }
  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value, on_demand: true,
  }, guest.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.stage, 3);

  const result = await host.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.data.my_answer.stage, 3);
  assert.equal(result.data.my_answer.points, Math.floor(answer.body.points / 2));
});
```

- [ ] **Step 3: Run the integration suite**

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:upload
npm run supabase:serve
```

In another terminal:

```bash
node --test tests/integration/press-your-luck.test.js
```

Expected: all pass, or skip when the stack is down. If `round_result` returns `pending`, the round did not close: both players must have an answer row, or the deadline must be in the past.

- [ ] **Step 4: Add the deploy note**

In `docs/DEPLOY.md`, under the manual deploy section, add:

```markdown
### v1.3: deploy the server first

The v1.3 client calls the two-argument `current_round` and
`sync_room_state` RPCs and sends `on_demand` to `submit-answer`. Deploy
the migration and the functions before the client:

1. `npx supabase db push`
2. `npm run supabase:deploy`
3. Publish the client and push `main`.

An old client keeps working against the new server: the one-argument RPCs
resolve through the defaulted flag and `submit-answer` defaults to the
timed ladder.
```

- [ ] **Step 5: Run the full test gate**

```bash
npm test
```

Expected: all unit and integration tests pass (integration skips if the stack is down).

```bash
npx playwright test --grep-invert "a player who refreshes mid-round keeps their score|the home screen can create a room"
```

Expected: all tests pass. The two excluded tests are the known base failures and are out of scope.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/press-your-luck.test.js docs/DEPLOY.md
git commit -m "test: cover press-your-luck rooms and document the deploy order"
```

---

## Task 11: Live rollout and verification

**Files:** none.

- [ ] **Step 1: Confirm the hosted client config is intact**

`client/src/config.js` must still hold the hosted Supabase URL and anon key. `npm run supabase:sync` overwrites it with local values, so restore the hosted values before publishing if the local sync ran.

```bash
git diff -- client/src/config.js
```

Expected: no diff, or a deliberate hosted-config commit. Never commit `127.0.0.1` into `client/src/config.js`.

- [ ] **Step 2: Deploy the server first**

```bash
npx supabase db push
npm run supabase:deploy
```

- [ ] **Step 3: Publish and push**

```bash
npm run publish
git push origin main
```

Vercel deploys `dist/` from `main`.

- [ ] **Step 4: Two-browser live check**

On `https://football-trivia-xi.vercel.app/`:

1. Create a room in one browser and join in another.
2. Start the game. Confirm one clue is visible and the family chip is shown.
3. Player A reveals a clue; player B still sees it locked.
4. A answers; B answers. Both reveals show the scoring breakdown with A's lower multiplier and B's higher one.
5. Use a steal in a later round and confirm the reveal story still works.
6. Finish the game and start a rematch. Confirm the next game starts with one clue and no progress carried over.

- [ ] **Step 5: Solo live check**

Play a solo game. Confirm ten identify rounds, no "how many" prompts, the reveal button, the family chip, and the breakdown.

---

## Self-review

### Spec coverage

| Spec section | Task |
|---|---|
| 3.1 remove stat rounds | Task 3 |
| 3.2 press-your-luck engine | Tasks 2, 4 |
| 3.2 solo | Task 5 |
| 3.2 rooms | Tasks 7, 8, 9 |
| 3.2 shared UI | Task 5 |
| 3.2 scoring breakdown | Tasks 4, 6 |
| 3.3 families and ladders | Task 1 |
| 3.3 planner assignment | Task 3 |
| 3.3 options | Task 2 |
| 3.3 labels and UI | Tasks 1, 5 |
| 3.4 schema and `reveal_clue` | Task 7 |
| 3.4 `current_round` / `sync_room_state` | Task 7 |
| 3.4 `submit-answer` | Task 7 |
| 3.4 `use_room_effect` | Task 7 |
| 3.4 `advance_room` / `round_result` | Task 7 |
| 3.4 projection | Task 7 |
| 3.4 client room | Task 8 |
| 3.5 data/API table | Tasks 3, 7, 8 |
| 3.6 unit tests | Tasks 1–4 |
| 3.6 integration tests | Task 10 |
| 3.6 Playwright | Tasks 5, 9 |
| 3.7 rollout | Task 11 |
| 3.9 acceptance criteria | Tasks 5, 9, 10, 11 |

### Placeholder scan

- No `TODO`, `TBD`, or "similar to" steps.
- Every task names exact files, commands, and expected results.
- The only intentional omission is the Phase 2 Football IQ work, which is out of scope by the spec.

### Type and name consistency

- Engine round key: `clueFamily`; database column and room payload: `clue_family`.
- Engine family ids: `career_trail`, `teammate_trail`, `record_book`, `profile`, `mixed`.
- Room RPCs: `reveal_clue(uuid,int,int)`, `current_round(uuid,boolean default false)`, `sync_room_state(uuid,boolean default false)`.
- Answer flag: `on_demand` in the edge function body; `p_on_demand` in SQL.
- Scoring: `scoreBreakdown({ stage, elapsedMs, multiplier, timeFactor })`.
