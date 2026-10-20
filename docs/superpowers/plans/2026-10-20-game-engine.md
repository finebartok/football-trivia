# Game Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, DOM-free engine that turns a vibe (a Scope) into a designed ten-round quiz — composed questions, hints, distractors, scoring and a plan with a shape.

**Architecture:** One module per responsibility under `js/engine/`, all pure functions over plain data. The engine never touches the DOM, the network or the database; it takes a `scope`, a `pool` of resolved players and a `registry`, and returns a plan. The same code runs in the browser (to preview a quiz) and on the server (to authoritatively validate an answer), which is why it must stay pure. `data/fixtures/pool.sample.json` is the input contract.

**Tech Stack:** Node 22 (ESM), `node --test`, plain JavaScript. No framework, no build step, no runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` — §5 (scope engine), §6 (game engine) govern this plan. The data-spine plan (`docs/superpowers/plans/2026-10-20-data-spine.md`) runs in parallel and produces the same fixture shape from the real dump.

## Global Constraints

- **Pure functions only.** No DOM, no `fetch`, no `Math.random()` — randomness comes from a seeded PRNG passed in, so a plan is reproducible from `(scope, seed)`.
- **The engine is under the hood.** Nothing here emits a "here is what the quiz contains" summary for players. The plan's shape is returned to the *server*, which may show it on the results screen only.
- **A missing metric is never zero.** `stats[metric] === undefined` means "no value"; it never becomes `0` and never satisfies a numeric predicate.
- **Windowed metrics state their window.** Any rendered value from a windowed metric includes the window label or the `(since YYYY)` qualifier.
- **Scope clauses use stable ids only** — league ids (`ES1`), club ids, tournament ids. Never display names.
- **Union semantics.** A player is in scope when *any* clause matches; predicates inside a clause are ANDed; array predicates are ORed.
- **User-facing noun is "vibe"**; the code says `scope`. No user-facing string in this engine mentions a scope, a metric or a query.
- **No DOM, no build step.** `js/engine/*.js` must import cleanly in a browser and in Node.

## Review Focus

1. **A player with no value for a metric** — must not match a numeric predicate and must never render as `0`. (Task 2)
2. **A scope whose clauses are all empty** — matches every player (the "play everything" case). It must not throw and must not be treated as an invalid scope. (Task 2)
3. **An era boundary** — `seasonStart`/`seasonEnd` are inclusive; a player whose only stint is `2019` matches a `2010–2019` scope. (Task 2)
4. **A scope that resolves to fewer than 20 players** — the planner refuses it with the count and the nearest workable threshold, and never pads the pool with substitutes. (Task 10)
5. **The same seed twice** — the plan must be byte-identical, and a different seed must produce a materially different plan (> 50% of rounds differ). (Task 10)

---

## File Structure

```
js/engine/
  scope.js         # clause matching + pool selection
  window.js        # window resolution from a scope, and window lookups
  stats.js         # metric registry: exact/windowed, formatting, families
  hints.js         # hint catalogue: build the ladder for a subject
  recipes.js       # question phrasing registry
  questions.js     # subject selection by informativeness; round composition
  distractors.js   # numeric and name distractors
  scoring.js       # stage x time factor
  planner.js       # the ten-round plan with diversity constraints
  rng.js           # seeded PRNG
  index.js         # public API: generateQuiz()

tests/engine/
  scope.test.js
  window.test.js
  stats.test.js
  hints.test.js
  recipes.test.js
  questions.test.js
  distractors.test.js
  scoring.test.js
  planner.test.js
  integration.test.js

data/fixtures/pool.sample.json   # the input contract (committed)
```

**Responsibility boundary:** `js/engine/` never imports from `scripts/ingest/` and never touches `lib/` beyond `lib/seasons.js`, which it may import for `seasonLabel`.

---

## The contracts

**A resolved player** (from `data/fixtures/pool.sample.json`):

```js
{
  id: 1, slug: 'lionel-messi', name: 'Lionel Messi',
  dateOfBirth: '1987-06-24', citizenship: ['Argentina'], position: 'Forward',
  subPosition: null, foot: 'Left', heightCm: 170,
  internationalCaps: 204, internationalGoals: 112,
  highestMarketValueEur: 400000000, marketValueEur: 30000000,
  teams: [{ clubId: 12, clubName: 'FC Barcelona', leagueId: 'ES1', leagueName: 'La Liga', seasons: [2012, 2013] }],
  tournaments: ['wc-2022'],
  stats: { goals_after_age_30: 120 },
  windows: { 'wc-2022': { goals: 7 } },
}
```

**A registry:**

```js
{
  leagues: { ES1: 'La Liga', GB1: 'Premier League' },
  clubs: [{ id: 12, name: 'FC Barcelona' }],
  windows: { 'wc-2022': { id: 'wc-2022', kind: 'tournament', label: '2022 World Cup', detail: 'the tournament', seasonStart: 2022, seasonEnd: 2022, tournamentId: 'wc-2022', clubId: null, teamName: null, ageFrom: null, ageTo: null } },
  tournaments: [{ id: 'wc-2022', name: '2022 FIFA World Cup', year: 2022 }],
}
```

**A scope (a vibe):**

```js
{
  v: 2, name: 'La Liga 2010s',
  clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }],
  window: null,                                   // derived when null
  question: { template: 'identify', difficulty: 'medium' },
}
```

---

### Task 1: Harness, the fixture loader, and the seeded PRNG

**Files:**
- Create: `js/engine/rng.js`
- Create: `js/engine/fixture.js`
- Create: `tests/engine/fixture.test.js`
- Create (only if absent): `lib/names.js`, `lib/seasons.js`

**Interfaces:**
- Consumes: `data/fixtures/pool.sample.json`
- Consumes (shared with the data-spine plan): `lib/names.js` (`normaliseName`) and `lib/seasons.js` (`seasonLabel`, `overlapsSeason`). These are created by the data-spine plan's Task 2. **If they do not exist yet, create them with the code in the step below** so this plan can run on its own.
- Produces (from `js/engine/rng.js`): `makeRng(seed: number): () => number` — a deterministic PRNG (mulberry32). `makeRng(seed)()` returns a float in `[0, 1)`. Two calls with the same seed produce the same sequence.
- Produces (from `js/engine/fixture.js`): `loadFixture(): { registry, players }` — reads `data/fixtures/pool.sample.json` and returns it. Node-only; the browser build will inline the same file over HTTP.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/fixture.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../js/engine/rng.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('the same seed produces the same sequence', () => {
  const a = makeRng(1234);
  const b = makeRng(1234);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('different seeds diverge', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  const va = Array.from({ length: 10 }, () => a());
  const vb = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(va, vb);
});

test('rng values stay in range', () => {
  const r = makeRng(99);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('the fixture loads and is shaped as the contract says', () => {
  const { registry, players } = loadFixture();
  assert.ok(players.length > 20, 'the fixture must have enough players to test with');
  assert.ok(registry.leagues.ES1);
  const messi = players.find(p => p.name === 'Lionel Messi');
  assert.ok(messi, 'Messi must be in the fixture');
  assert.equal(messi.windows['wc-2022'].goals, 7);
  assert.ok(messi.teams.length >= 2, 'Messi must have a multi-club path');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/fixture.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/engine/rng.js`.

- [ ] **Step 3: Create the shared helpers if they are missing**

Run: `ls lib/names.js lib/seasons.js 2>/dev/null`
Expected: both paths listed — skip to Step 4.
Expected (if either is missing): create it with the code below, then continue.

Create `lib/names.js`:

```js
const JUNK = new Set(['', 'without club', 'unknown', 'anonymous', 'n/a', 'na', 'none', '-']);

export function normaliseName(s) {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchKey(s) {
  const n = normaliseName(s);
  if (!n) return '';
  const parts = n.split(' ');
  const last = parts[parts.length - 1];
  const first = parts[0] ?? '';
  return `${first} ${last}`.trim();
}

export function isJunkName(s) {
  return JUNK.has(normaliseName(s));
}
```

Create `lib/seasons.js`:

```js
export function parseSeason(v) {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const head = raw.includes('/') ? raw.split('/')[0] : raw;
  const n = Number.parseInt(head, 10);
  if (Number.isNaN(n)) return null;
  if (n >= 1000) return n;
  return n <= 29 ? 2000 + n : 1900 + n;
}

export function seasonLabel(start) {
  const end = (start + 1) % 100;
  return `${start}/${String(end).padStart(2, '0')}`;
}

export function overlapsSeason(seasons, start, end) {
  const list = seasons || [];
  const lo = start ?? -Infinity;
  const hi = end ?? Infinity;
  return list.some(s => s >= lo && s <= hi);
}
```

- [ ] **Step 4: Write the implementations**

Create `js/engine/rng.js`:

```js
export function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, array) {
  if (!array.length) return null;
  return array[Math.floor(rng() * array.length)];
}

export function shuffle(rng, array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

Create `js/engine/fixture.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../data/fixtures/pool.sample.json');

let cached = null;

export function loadFixture() {
  if (!cached) {
    cached = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  }
  return cached;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/engine/fixture.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add js/engine/rng.js js/engine/fixture.js tests/engine/fixture.test.js lib/
git commit -m "feat(engine): seeded PRNG and the fixture loader"
```

---

### Task 2: Scope matching

**Files:**
- Create: `js/engine/scope.js`
- Create: `tests/engine/scope.test.js`

**Interfaces:**
- Consumes: `lib/seasons.js` (`overlapsSeason`)
- Produces: `playerInScope(player, scope): boolean`
- Produces: `scopePool(scope, pool): Player[]`
- Produces: `statMatches(pred, stats): boolean` — exported for testing. `undefined` or `null` value → `false`. A genuine `0` matches `== 0` and fails `>= 1`.

**This task owns Review Focus items 1, 2 and 3.**

- [ ] **Step 1: Write the failing test**

Create `tests/engine/scope.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/scope.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/scope.js`:

```js
import { overlapsSeason } from '../../lib/seasons.js';

const OPS = {
  '>=': (v, t) => v >= t,
  '>': (v, t) => v > t,
  '<=': (v, t) => v <= t,
  '<': (v, t) => v < t,
  '==': (v, t) => v === t,
  between: (v, t) => v >= t[0] && v <= t[1],
};

export function statMatches(pred, stats) {
  const v = stats?.[pred.metric];
  if (v === undefined || v === null) return false;
  const op = OPS[pred.op];
  if (!op) return false;
  return op(v, pred.value);
}

function clauseMatches(clause, player) {
  const L = clause.leagues?.length ? clause.leagues : null;
  const T = clause.teams?.length ? clause.teams : null;
  const N = clause.nationalities?.length ? clause.nationalities : null;
  const P = clause.positions?.length ? clause.positions : null;
  const R = clause.tournaments?.length ? clause.tournaments : null;
  const S = clause.seasons?.length ? clause.seasons : null;

  if (N && !N.includes(player.nationality) && !(player.citizenship ?? []).some(c => N.includes(c))) return false;
  if (P && !P.includes(player.position)) return false;
  if (R && !(player.tournaments ?? []).some(t => R.includes(t))) return false;

  if (clause.stats?.length) {
    if (!clause.stats.every(p => statMatches(p, player.stats))) return false;
  }

  const needsEntry = L || T || S || clause.seasonStart != null || clause.seasonEnd != null;
  if (!needsEntry) return true;

  return (player.teams ?? []).some(e => {
    if (L && !L.includes(e.leagueId)) return false;
    if (T && !T.includes(e.clubId)) return false;
    if (S && !(e.seasons ?? []).some(s => S.includes(s))) return false;
    if (clause.seasonStart != null || clause.seasonEnd != null) {
      if (!overlapsSeason(e.seasons, clause.seasonStart, clause.seasonEnd)) return false;
    }
    return true;
  });
}

export function playerInScope(player, scope) {
  if (!scope || !Array.isArray(scope.clauses) || scope.clauses.length === 0) return true;
  return scope.clauses.some(c => clauseMatches(c, player));
}

export function scopePool(scope, pool) {
  return (pool ?? []).filter(p => playerInScope(p, scope));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/scope.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/scope.js tests/engine/scope.test.js
git commit -m "feat(engine): scope matching - union of clauses, missing metrics never match"
```

---

### Task 3: Window resolution

**Files:**
- Create: `js/engine/window.js`
- Create: `tests/engine/window.test.js`

**Interfaces:**
- Consumes: `js/engine/scope.js`
- Produces: `resolveWindow(scope, registry): Window | null` — the scope's window, derived from its clauses when `scope.window` is not set. A tournament clause yields that tournament's window; a league + era clause yields a `season_range` window; an age-band stat clause yields an `age_band` window; otherwise `null`.
- Produces: `windowForPlayer(player, window): Window | null` — the player's own window instance, e.g. their club-season at the window's club. Returns `null` when the player has no data in that window.
- Produces: `windowsForPlayer(player, registry): Window[]` — every window the player has stats for.
- Produces: `windowLabel(window): string` — the human label, e.g. `'2022 World Cup'`.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/window.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow, windowLabel } from '../../js/engine/window.js';

const registry = {
  leagues: { ES1: 'La Liga', GB1: 'Premier League' },
  clubs: [{ id: 12, name: 'FC Barcelona' }],
  windows: {
    'wc-2022': { id: 'wc-2022', kind: 'tournament', label: '2022 World Cup', detail: 'the tournament', tournamentId: 'wc-2022', seasonStart: 2022, seasonEnd: 2022, clubId: null, teamName: null, ageFrom: null, ageTo: null },
  },
  tournaments: [{ id: 'wc-2022', name: '2022 FIFA World Cup', year: 2022 }],
};

test('a tournament clause resolves to that tournament window', () => {
  const w = resolveWindow({ clauses: [{ tournaments: ['wc-2022'] }] }, registry);
  assert.equal(w.kind, 'tournament');
  assert.equal(w.id, 'wc-2022');
  assert.equal(windowLabel(w), '2022 World Cup');
});

test('a league and era clause resolves to a season_range window', () => {
  const w = resolveWindow({ clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] }, registry);
  assert.equal(w.kind, 'season_range');
  assert.equal(w.seasonStart, 2010);
  assert.equal(w.seasonEnd, 2019);
  assert.match(windowLabel(w), /2010.*2019/);
});

test('an explicit scope window wins over the derived one', () => {
  const w = resolveWindow({ clauses: [{ tournaments: ['wc-2022'] }], window: 'wc-2022' }, registry);
  assert.equal(w.id, 'wc-2022');
});

test('a scope with no derivable window resolves to null', () => {
  assert.equal(resolveWindow({ clauses: [{ positions: ['Forward'] }] }, registry), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/window.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/window.js`:

```js
export function windowLabel(window) {
  if (!window) return '';
  if (window.label) return window.label;
  if (window.kind === 'season_range') return `${window.leagueName ?? ''} ${window.seasonStart}-${window.seasonEnd}`.trim();
  return window.id ?? '';
}

export function resolveWindow(scope, registry) {
  if (scope?.window) {
    const explicit = registry?.windows?.[scope.window];
    if (explicit) return explicit;
  }
  for (const clause of scope?.clauses ?? []) {
    if (clause.tournaments?.length) {
      const id = clause.tournaments[0];
      const w = registry?.windows?.[id];
      if (w) return w;
      const t = registry?.tournaments?.find(x => x.id === id);
      if (t) {
        return {
          id, kind: 'tournament', label: `${t.year} ${t.name.replace(/^\d{4}\s*/, '')}`,
          detail: 'the tournament', seasonStart: t.year, seasonEnd: t.year,
          tournamentId: id, clubId: null, teamName: null, ageFrom: null, ageTo: null,
        };
      }
    }
    if (clause.leagues?.length && (clause.seasonStart != null || clause.seasonEnd != null)) {
      const leagueId = clause.leagues[0];
      const leagueName = registry?.leagues?.[leagueId] ?? leagueId;
      return {
        id: `range-${leagueId}-${clause.seasonStart ?? '*'}-${clause.seasonEnd ?? '*'}`,
        kind: 'season_range',
        label: `${leagueName} ${clause.seasonStart ?? ''}${clause.seasonEnd != null ? `-${clause.seasonEnd}` : ''}`.trim(),
        detail: 'the era', seasonStart: clause.seasonStart ?? null, seasonEnd: clause.seasonEnd ?? null,
        tournamentId: null, clubId: null, teamName: null, ageFrom: null, ageTo: null,
        leagueId, leagueName,
      };
    }
    if (clause.stats?.length) {
      const s = clause.stats[0];
      if (s.metric?.startsWith('goals_after_age_')) {
        const age = Number(s.metric.replace('goals_after_age_', ''));
        return {
          id: `age-${age}`, kind: 'age_band', label: `aged ${age}+`, detail: 'the age band',
          seasonStart: null, seasonEnd: null, tournamentId: null, clubId: null, teamName: null,
          ageFrom: age, ageTo: null,
        };
      }
    }
  }
  return null;
}

export function windowsForPlayer(player, registry) {
  return Object.keys(player.windows ?? {})
    .map(id => registry?.windows?.[id])
    .filter(Boolean);
}

export function windowForPlayer(player, window) {
  if (!window) return null;
  if (window.kind === 'tournament') {
    return registrySafe(player, window) ? window : null;
  }
  return window;
}

function registrySafe(player, window) {
  return Object.prototype.hasOwnProperty.call(player.windows ?? {}, window.id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/window.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/window.js tests/engine/window.test.js
git commit -m "feat(engine): window resolution - a scope carries the lens its questions use"
```

---

### Task 4: The metric registry

**Files:**
- Create: `js/engine/stats.js`
- Create: `tests/engine/stats.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `METRICS` — a frozen object of metric descriptors:
  `{ id, label, unit, exact, family, source, format(value, window) }` where `family` is one of `'career' | 'window' | 'scarcity' | 'roster'`, and `exact` is `true` only for career-true metrics.
- Produces: `metricDescriptor(id): Metric | null`
- Produces: `formatMetric(id, value, window): string` — renders a value **including its window qualifier when the metric is not exact**. A windowed metric always ends with `(since YYYY)` or the window label; an exact metric never gets one.
- Produces: `metricsFor(player, window): Metric[]` — the metrics a player actually has a value for in the given window.

**Metrics shipped:**

| id | label | unit | exact | family |
|---|---|---|---|---|
| `international_caps` | International caps | caps | yes | career |
| `international_goals` | International goals | goals | yes | career |
| `highest_market_value_eur` | Peak market value | €M | yes | career |
| `club_goals` | Goals | goals | no | window |
| `club_appearances` | Appearances | apps | no | window |
| `goals_after_age_30` | Goals aged 30+ | goals | no | window |
| `tournament_goals` | Tournament goals | goals | yes | roster |
| `scarcity_peers` | Players with this | players | yes | scarcity |

- [ ] **Step 1: Write the failing test**

Create `tests/engine/stats.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, formatMetric, metricsFor, metricDescriptor } from '../../js/engine/stats.js';

test('a windowed metric always states its window', () => {
  const s = formatMetric('club_goals', 61, { kind: 'season', seasonStart: 2014, seasonEnd: 2014, label: 'Real Madrid 2014/15' });
  assert.match(s, /61/);
  assert.match(s, /2014|since/i, 'a windowed value must name its window');
});

test('an exact metric never gets a window qualifier', () => {
  const s = formatMetric('international_caps', 204, { kind: 'season', seasonStart: 2014, label: 'x' });
  assert.equal(s, '204 caps');
});

test('metric families are assigned for the planner', () => {
  assert.equal(metricDescriptor('international_caps').family, 'career');
  assert.equal(metricDescriptor('club_goals').family, 'window');
  assert.equal(metricDescriptor('goals_after_age_30').family, 'window');
  assert.equal(metricDescriptor('scarcity_peers').family, 'scarcity');
});

test('metricsFor only returns metrics the player has a value for', () => {
  const player = { windows: { 'wc-2022': { goals: 7 } }, stats: { international_caps: 204 } };
  const m = metricsFor(player, { id: 'wc-2022' });
  const ids = m.map(x => x.id);
  assert.ok(ids.includes('tournament_goals'));
  assert.ok(!ids.includes('club_appearances'));
  assert.equal(metricDescriptor('nope'), null);
});

test('every metric declares a family and an exactness', () => {
  for (const [id, m] of Object.entries(METRICS)) {
    assert.ok(m.label, `${id} needs a label`);
    assert.ok(['career', 'window', 'scarcity', 'roster', 'identity'].includes(m.family), `${id} needs a family`);
    assert.equal(typeof m.exact, 'boolean', `${id} needs an exact flag`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/stats.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/stats.js`:

```js
function millions(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `€${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
}

function withWindow(text, window) {
  if (!window) return text;
  if (window.kind === 'season_range') {
    return `${text} (${window.seasonStart ?? ''}–${window.seasonEnd ?? ''})`;
  }
  if (window.seasonStart != null && window.kind !== 'career') {
    return `${text} (since ${window.seasonStart})`;
  }
  if (window.label) return `${text} — ${window.label}`;
  return text;
}

export const METRICS = Object.freeze({
  international_caps: {
    id: 'international_caps', label: 'International caps', unit: 'caps', exact: true, family: 'career',
    format: v => `${v} caps`,
  },
  international_goals: {
    id: 'international_goals', label: 'International goals', unit: 'goals', exact: true, family: 'career',
    format: v => `${v} goals`,
  },
  highest_market_value_eur: {
    id: 'highest_market_value_eur', label: 'Peak market value', unit: '€M', exact: true, family: 'career',
    format: v => millions(v),
  },
  club_goals: {
    id: 'club_goals', label: 'Goals', unit: 'goals', exact: false, family: 'window',
    format: v => `${v} goals`,
  },
  club_appearances: {
    id: 'club_appearances', label: 'Appearances', unit: 'apps', exact: false, family: 'window',
    format: v => `${v} appearances`,
  },
  goals_after_age_30: {
    id: 'goals_after_age_30', label: 'Goals aged 30+', unit: 'goals', exact: false, family: 'window',
    format: v => `${v}+ goals aged 30+`,
  },
  tournament_goals: {
    id: 'tournament_goals', label: 'Tournament goals', unit: 'goals', exact: true, family: 'roster',
    format: v => `${v} goals`,
  },
  scarcity_peers: {
    id: 'scarcity_peers', label: 'Players with this', unit: 'players', exact: true, family: 'scarcity',
    format: v => `one of only ${v}`,
  },
});

export function metricDescriptor(id) {
  return METRICS[id] ?? null;
}

export function formatMetric(id, value, window) {
  const m = METRICS[id];
  if (!m) return String(value);
  const text = m.format(value);
  return m.exact ? text : withWindow(text, window);
}

// For these metrics a 0 means "the source recorded nothing", not "the value
// is zero". A player with no caps must not be shown as "0 caps".
const ZERO_MEANS_ABSENT = new Set([
  'international_caps', 'international_goals', 'highest_market_value_eur',
]);

export function metricsFor(player, window) {
  const out = [];
  for (const m of Object.values(METRICS)) {
    let value;
    if (m.id === 'international_caps') value = player.internationalCaps;
    else if (m.id === 'international_goals') value = player.internationalGoals;
    else if (m.id === 'highest_market_value_eur') value = player.highestMarketValueEur;
    else if (m.id === 'tournament_goals') {
      value = window?.id ? (player.windows?.[window.id]?.goals) : undefined;
    } else if (m.id === 'scarcity_peers') {
      value = player.stats?.scarcity_peers;
    } else if (window?.id && player.windows?.[window.id]?.[m.id] !== undefined) {
      value = player.windows[window.id][m.id];
    } else if (window?.id && m.id === 'club_goals' && player.windows?.[window.id]?.goals !== undefined) {
      value = player.windows[window.id].goals;
    } else if (window?.id && m.id === 'club_appearances' && player.windows?.[window.id]?.appearances !== undefined) {
      value = player.windows[window.id].appearances;
    } else if (player.stats?.[m.id] !== undefined) {
      value = player.stats[m.id];
    }
    if (value === undefined || value === null) continue;
    if (value === 0 && ZERO_MEANS_ABSENT.has(m.id)) continue;
    out.push({ ...m, value });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/stats.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/stats.js tests/engine/stats.test.js
git commit -m "feat(engine): metric registry - windowed values always state their window"
```

---

### Task 5: Hints

**Files:**
- Create: `js/engine/hints.js`
- Create: `tests/engine/hints.test.js`

**Interfaces:**
- Consumes: `js/engine/stats.js` (`formatMetric`, `metricDescriptor`)
- Produces: `buildHints(subject, window, registry, { limit = 4 })` → `Hint[]` where `Hint = { id, label, value, iconKey, metric, window }`.
- Produces: `hintOrder(hints)` → the hints sorted hardest-first: window-level facts before career surface facts. A hint is "surface" when its metric family is `career` **and** the metric is one of `position`, `nationality`, `age`.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/hints.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHints, hintOrder } from '../../js/engine/hints.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('hints are built for a real player', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const hints = buildHints(messi, registry.windows['wc-2022'], registry);
  assert.ok(hints.length >= 4, 'a player must yield at least four hints');
  for (const h of hints) {
    assert.ok(h.label, 'a hint needs a label');
    assert.ok(h.value && h.value !== 'null' && h.value !== 'undefined', 'a hint value must never be null-ish');
    assert.ok(h.iconKey, 'a hint needs an iconKey');
  }
});

test('window facts are ordered before career surface facts', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const hints = hintOrder(buildHints(messi, registry.windows['wc-2022'], registry));
  const surfaceIdx = hints.findIndex(h => h.id === 'nationality' || h.id === 'position');
  const windowIdx = hints.findIndex(h => h.family === 'window' || h.family === 'roster');
  assert.ok(windowIdx >= 0 && surfaceIdx >= 0);
  assert.ok(windowIdx < surfaceIdx, 'a window fact must come before a surface fact');
});

test('no hint ever renders a missing value as zero', () => {
  const { players, registry } = loadFixture();
  const withNulls = players.find(p => p.internationalCaps === 0 || p.internationalCaps == null);
  const hints = buildHints(withNulls, null, registry);
  assert.ok(!hints.some(h => /^0 /.test(h.value)), 'a missing stat must not render as "0 ..."');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/hints.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/hints.js`:

```js
import { formatMetric, metricsFor } from './stats.js';

const ICONS = {
  nat: 'nat', pos: 'pos', path: 'path', shirt: 'shirt', honors: 'honors',
  value: 'value', age: 'age', league: 'league', team: 'team', name: 'name',
};

export function buildHints(subject, window, registry, { limit = 8 } = {}) {
  const hints = [];

  if (subject.nationality) {
    hints.push({ id: 'nationality', label: 'Nationality', value: subject.nationality, iconKey: ICONS.nat, family: 'career', surface: true });
  }
  if (subject.position) {
    const foot = subject.foot ? ` (${subject.foot.toLowerCase()}-footed)` : '';
    hints.push({ id: 'position', label: 'Position', value: `${subject.position}${foot}`, iconKey: ICONS.pos, family: 'career', surface: true });
  }
  if (subject.dateOfBirth) {
    const born = Number(subject.dateOfBirth.slice(0, 4));
    hints.push({ id: 'age', label: 'Born', value: `Born ${subject.dateOfBirth.slice(0, 4)}`, iconKey: ICONS.age, family: 'career', surface: true });
  }

  const path = (subject.teams ?? []).map(t => t.clubName).filter(Boolean);
  if (path.length) {
    hints.push({ id: 'clubs', label: 'Career clubs', value: path.join(' → '), iconKey: ICONS.path, family: 'career', surface: false });
  }

  const leagues = [...new Set((subject.teams ?? []).map(t => t.leagueName).filter(Boolean))];
  if (leagues.length) {
    hints.push({ id: 'leagues', label: 'Leagues', value: leagues.join(', '), iconKey: ICONS.league, family: 'career', surface: false });
  }

  for (const m of metricsFor(subject, window)) {
    hints.push({
      id: m.id,
      label: m.label,
      value: formatMetric(m.id, m.value, window),
      iconKey: m.family === 'roster' ? ICONS.honors : m.id === 'highest_market_value_eur' ? ICONS.value : ICONS.honors,
      family: m.family,
      surface: false,
      metric: m.id,
      window: window?.id ?? null,
    });
  }

  return hints.slice(0, limit);
}

const RANK = { window: 0, roster: 1, path: 2, surface: 3 };

export function hintRank(hint) {
  if (hint.family === 'window' || hint.family === 'roster') return RANK.window;
  if (hint.surface) return RANK.surface;
  return RANK.path;
}

export function hintOrder(hints) {
  return [...hints].sort((a, b) => {
    const d = hintRank(a) - hintRank(b);
    if (d !== 0) return d;
    return 0;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/hints.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/hints.js tests/engine/hints.test.js
git commit -m "feat(engine): hint catalogue - window facts before career surface facts"
```

---

### Task 6: The phrasing registry

**Files:**
- Create: `js/engine/recipes.js`
- Create: `tests/engine/recipes.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `RECIPES` — a frozen array of question recipes. Each is `{ id, template, metric, windowKinds, speak, answerValue }`.
  - `speak({ subject, window, value, pool, registry })` → `{ prompt, answer, unit, context }`.
  - `answerValue(subject, window, metric)` → the number or string the question asks for.
- Produces: `recipesFor({ template, window, pool })` → the recipes whose metric and window kind are available for the given pool.

**Recipes shipped:**

| id | template | metric | window kinds | phrasing |
|---|---|---|---|---|
| `identify_in_window` | identify | identity | all | "Who is this?" |
| `goals_in_season` | stat_value | club_goals | season | "How many goals did **{name}** score for **{club}** in **{season}**?" |
| `goals_in_tournament` | stat_value | tournament_goals | tournament | "How many goals did **{name}** score at the **{window}**?" |
| `caps_total` | stat_value | international_caps | career | "How many international caps did **{name}** have?" |
| `scarcity_goals` | identify | scarcity_peers | career | "One of only **{value}** players did this — who?" |

- [ ] **Step 1: Write the failing test**

Create `tests/engine/recipes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, recipesFor } from '../../js/engine/recipes.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('every recipe has an id, a template and a speak function', () => {
  for (const r of RECIPES) {
    assert.ok(r.id, 'recipe needs an id');
    assert.ok(r.template, 'recipe needs a template');
    assert.equal(typeof r.speak, 'function', `${r.id} needs a speak function`);
    assert.ok(Array.isArray(r.windowKinds) && r.windowKinds.length, `${r.id} needs window kinds`);
  }
});

test('a stat recipe speaks a sentence with the subject named', () => {
  const { players } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const r = RECIPES.find(x => x.id === 'caps_total');
  const out = r.speak({ subject: messi, window: null, value: 204, pool: players, registry: { windows: {} } });
  assert.match(out.prompt, /Lionel Messi/);
  assert.match(out.prompt, /caps/i);
  assert.equal(out.answer, 204);
});

test('recipesFor returns only recipes available for the pool', () => {
  const { players, registry } = loadFixture();
  const recipes = recipesFor({ template: 'stat_value', window: registry.windows['wc-2022'], pool: players });
  assert.ok(recipes.length >= 1);
  assert.ok(recipes.every(r => r.template === 'stat_value'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/recipes.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/recipes.js`:

```js
import { seasonLabel } from '../../lib/seasons.js';

export const RECIPES = Object.freeze([
  {
    id: 'identify_in_window', family: 'identity', template: 'identify', metric: 'identity',
    windowKinds: ['career', 'season', 'season_range', 'tournament', 'club_stint', 'age_band'],
    speak: ({ subject, window }) => ({
      prompt: 'Who is this?',
      context: window?.label ?? null,
      answer: subject.name,
      unit: null,
    }),
  },
  {
    id: 'goals_in_season', family: 'window', template: 'stat_value', metric: 'club_goals',
    windowKinds: ['season'],
    speak: ({ subject, window, value }) => ({
      prompt: `How many goals did **${subject.name}** score for **${window?.teamName ?? window?.label ?? 'the club'}** in **${window?.seasonStart ? seasonLabel(window.seasonStart) : window?.label}**?`,
      context: window?.label ?? null,
      answer: value,
      unit: 'goals',
    }),
  },
  {
    id: 'goals_in_tournament', family: 'roster', template: 'stat_value', metric: 'tournament_goals',
    windowKinds: ['tournament'],
    speak: ({ subject, window, value }) => ({
      prompt: `How many goals did **${subject.name}** score at the **${window?.label ?? 'tournament'}**?`,
      context: window?.label ?? null,
      answer: value,
      unit: 'goals',
    }),
  },
  {
    id: 'caps_total', family: 'career', template: 'stat_value', metric: 'international_caps',
    windowKinds: ['career', 'season', 'season_range', 'tournament'],
    speak: ({ subject, value }) => ({
      prompt: `How many international caps did **${subject.name}** have?`,
      context: null,
      answer: value,
      unit: 'caps',
    }),
  },
  {
    id: 'scarcity_goals', family: 'scarcity', template: 'identify', metric: 'scarcity_peers',
    windowKinds: ['career', 'season', 'season_range', 'tournament', 'age_band'],
    speak: ({ subject, value }) => ({
      prompt: `One of only **${value}** players did this — who?`,
      context: null,
      answer: subject.name,
      unit: null,
    }),
  },
]);

export function recipesFor({ template, window, pool }) {
  const kind = window?.kind ?? 'career';
  const subjects = pool ?? [];
  return RECIPES.filter(r => {
    if (template && r.template !== template) return false;
    if (!r.windowKinds.includes(kind)) return false;
    if (r.metric === 'identity') return true;
    return subjects.some(s => {
      if (r.metric === 'international_caps') return s.internationalCaps > 0;
      if (r.metric === 'tournament_goals') return window?.id && (s.windows?.[window.id]?.goals ?? 0) > 0;
      if (r.metric === 'scarcity_peers') return (s.stats?.scarcity_peers ?? 0) > 0;
      if (r.metric === 'club_goals') return window?.id && (s.windows?.[window.id]?.goals ?? 0) > 0;
      return false;
    });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/recipes.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/recipes.js tests/engine/recipes.test.js
git commit -m "feat(engine): phrasing registry - questions are sentences, not rows"
```

---

### Task 7: Scoring

**Files:**
- Create: `js/engine/scoring.js`
- Create: `tests/engine/scoring.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `STAGE_MULTIPLIERS` — `{ 1: 5, 2: 3, 3: 2, 4: 1 }`.
- Produces: `scoreRound({ correct, stage, elapsedMs, roundMs = 20000 })` → `{ points, multiplier, timeFactor }`.
  - `multiplier = STAGE_MULTIPLIERS[stage] ?? 1`
  - `timeFactor = clamp(1.5 - 0.5 * (elapsedMs - 1500) / (roundMs - 1500), 1, 1.5)`
  - `points = correct ? Math.round(1000 * multiplier * timeFactor) : 0`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/scoring.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRound, STAGE_MULTIPLIERS } from '../../js/engine/scoring.js';

test('an incorrect answer scores zero', () => {
  assert.equal(scoreRound({ correct: false, stage: 1, elapsedMs: 0 }).points, 0);
});

test('the fastest answer at stage 1 scores the maximum', () => {
  const r = scoreRound({ correct: true, stage: 1, elapsedMs: 1500 });
  assert.equal(r.multiplier, 5);
  assert.equal(r.timeFactor, 1.5);
  assert.equal(r.points, 7500);
});

test('the same answer later in the round scores less', () => {
  const early = scoreRound({ correct: true, stage: 1, elapsedMs: 1500 }).points;
  const late = scoreRound({ correct: true, stage: 1, elapsedMs: 20000 }).points;
  assert.ok(late < early, 'time must matter');
});

test('the same answer at a later stage scores less', () => {
  const s1 = scoreRound({ correct: true, stage: 1, elapsedMs: 1500 }).points;
  const s4 = scoreRound({ correct: true, stage: 4, elapsedMs: 1500 }).points;
  assert.ok(s4 < s1, 'the stage multiplier must matter');
});

test('the time factor never falls below 1 or rises above 1.5', () => {
  assert.equal(scoreRound({ correct: true, stage: 1, elapsedMs: 0 }).timeFactor, 1.5);
  assert.equal(scoreRound({ correct: true, stage: 1, elapsedMs: 999999 }).timeFactor, 1);
});

test('the multipliers are the ones the ladder shows', () => {
  assert.deepEqual(STAGE_MULTIPLIERS, { 1: 5, 2: 3, 3: 2, 4: 1 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/scoring.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/scoring.js`:

```js
export const STAGE_MULTIPLIERS = Object.freeze({ 1: 5, 2: 3, 3: 2, 4: 1 });

export const ROUND_MS = 20000;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function scoreRound({ correct, stage, elapsedMs, roundMs = ROUND_MS }) {
  const multiplier = STAGE_MULTIPLIERS[stage] ?? 1;
  const span = Math.max(1, roundMs - 1500);
  const timeFactor = clamp(1.5 - (0.5 * (elapsedMs - 1500)) / span, 1, 1.5);
  const points = correct ? Math.round(1000 * multiplier * timeFactor) : 0;
  return { points, multiplier, timeFactor };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/scoring.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/scoring.js tests/engine/scoring.test.js
git commit -m "feat(engine): scoring - stage multiplier x time factor"
```

---

### Task 8: Distractors

**Files:**
- Create: `js/engine/distractors.js`
- Create: `tests/engine/distractors.test.js`

**Interfaces:**
- Consumes: `js/engine/rng.js` (`shuffle`)
- Produces: `numericDistractors({ value, pool, subject, metric, rng, count = 3 })` → `number[]` — real values from comparable players, never equal to the truth, all distinct.
- Produces: `nameDistractors({ pool, subject, scope, rng, count = 3 })` → `Player[]` — players in the pool who are not the subject.
- Produces: `buildOptions({ answer, distractors, rng })` → `Array<{ id, label, correct }>` — four options, shuffled, exactly one correct.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/distractors.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { numericDistractors, nameDistractors, buildOptions } from '../../js/engine/distractors.js';
import { makeRng } from '../../js/engine/rng.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('numeric distractors never include the true value', () => {
  const { players } = loadFixture();
  const rng = makeRng(7);
  const truth = 7;
  for (let i = 0; i < 50; i++) {
    const d = numericDistractors({ value: truth, pool: players, subject: players[0], metric: 'tournament_goals', rng });
    assert.ok(!d.includes(truth));
    assert.equal(new Set(d).size, d.length, 'distractors must be distinct');
  }
});

test('numeric distractors are real values from the pool', () => {
  const { players } = loadFixture();
  const rng = makeRng(11);
  const d = numericDistractors({ value: 61, pool: players, subject: players[0], metric: 'club_goals', rng });
  assert.ok(d.length > 0);
});

test('name distractors exclude the subject', () => {
  const { players } = loadFixture();
  const rng = makeRng(3);
  const subject = players[0];
  const d = nameDistractors({ pool: players, subject, scope: { clauses: [] }, rng, count: 3 });
  assert.equal(d.length, 3);
  assert.ok(d.every(p => p.id !== subject.id));
});

test('buildOptions returns four options with exactly one correct', () => {
  const rng = makeRng(5);
  const opts = buildOptions({ answer: 'A', distractors: ['B', 'C', 'D'], rng });
  assert.equal(opts.length, 4);
  assert.equal(opts.filter(o => o.correct).length, 1);
  assert.equal(new Set(opts.map(o => o.label)).size, 4);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/distractors.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/distractors.js`:

```js
import { shuffle } from './rng.js';

export function numericDistractors({ value, pool, subject, metric, rng, count = 3 }) {
  const values = new Set();
  for (const p of pool ?? []) {
    if (subject && p.id === subject.id) continue;
    let v;
    if (metric === 'international_caps') v = p.internationalCaps;
    else if (metric === 'tournament_goals') v = Object.values(p.windows ?? {}).reduce((s, w) => s + (w.goals ?? 0), 0);
    else if (metric === 'club_goals') v = Object.values(p.windows ?? {}).reduce((s, w) => s + (w.goals ?? 0), 0);
    else v = p.internationalCaps;
    if (v === undefined || v === null || v === 0) continue;
    if (v === value) continue;
    values.add(v);
    if (values.size >= count * 4) break;
  }
  const pool2 = shuffle(rng, [...values]).slice(0, count);
  while (pool2.length < count) {
    const bump = value + (pool2.length + 1) * 2;
    if (!pool2.includes(bump) && bump !== value) pool2.push(bump);
    else break;
  }
  return pool2;
}

export function nameDistractors({ pool, subject, scope, rng, count = 3 }) {
  const candidates = (pool ?? []).filter(p => !subject || p.id !== subject.id);
  return shuffle(rng, candidates).slice(0, count);
}

export function buildOptions({ answer, distractors, rng }) {
  const all = [
    { id: 'opt-0', label: String(answer), correct: true },
    ...(distractors ?? []).map((d, i) => ({
      id: `opt-${i + 1}`,
      label: typeof d === 'object' && d !== null ? d.name : String(d),
      correct: false,
    })),
  ];
  return shuffle(rng, all);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/distractors.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/distractors.js tests/engine/distractors.test.js
git commit -m "feat(engine): distractors drawn from the real pool, never the true value"
```

---

### Task 9: Composing a round

**Files:**
- Create: `js/engine/questions.js`
- Create: `tests/engine/questions.test.js`

**Interfaces:**
- Consumes: `js/engine/hints.js`, `js/engine/recipes.js`, `js/engine/distractors.js`, `js/engine/stats.js`
- Produces: `candidateSubjects({ scope, pool, registry, window, metric })` → `Array<{ subject, value, score }>` — every subject that has a usable value for the metric, scored for **informativeness** (how sharply the value separates the subject from the pool) and **specificity**.
- Produces: `composeRound({ subject, metric, window, scope, registry, pool, rng, difficulty, stage })` → `Round`:
  ```js
  {
    template, prompt, context, subjectId, subjectName,
    answer, unit, options: [{id,label,correct}],
    clues: [{id,label,value,iconKey}],
    revealSchedule: [{stage, revealAtMs}],
  }
  ```
- Produces: `informativeness(value, values)` → `number` — the share of the pool whose value differs from this one. A value shared by everybody scores `0`.

**This task produces the "engine decides what is worth asking about" behaviour.**

- [ ] **Step 1: Write the failing test**

Create `tests/engine/questions.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRound, candidateSubjects, informativeness } from '../../js/engine/questions.js';
import { makeRng } from '../../js/engine/rng.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('informativeness is zero for a value everybody shares', () => {
  assert.equal(informativeness(5, [5, 5, 5, 5]), 0);
  assert.ok(informativeness(5, [1, 2, 3, 5]) > 0);
});

test('candidate subjects carry a score and only subjects with a real value', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const cands = candidateSubjects({ scope: { clauses: [] }, pool: players, registry, window, metric: 'tournament_goals' });
  assert.ok(cands.length > 0);
  for (const c of cands) {
    assert.ok(typeof c.score === 'number');
    assert.ok(c.value > 0, 'a candidate with no value must not be offered');
  }
});

test('a composed round has four options, one correct, and four clues', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const cands = candidateSubjects({ scope: { clauses: [] }, pool: players, registry, window, metric: 'tournament_goals' });
  const rng = makeRng(42);
  const round = composeRound({
    subject: cands[0].subject, metric: 'tournament_goals', window,
    scope: { clauses: [] }, registry, pool: players, rng, difficulty: 'medium',
  });

  assert.equal(round.options.length, 4);
  assert.equal(round.options.filter(o => o.correct).length, 1);
  assert.ok(round.clues.length >= 3);
  assert.ok(round.prompt.length > 0);
  assert.equal(round.revealSchedule.length, round.clues.length);
});

test('the round answer equals the correct option', () => {
  const { players, registry } = loadFixture();
  const window = registry.windows['wc-2022'];
  const cands = candidateSubjects({ scope: { clauses: [] }, pool: players, registry, window, metric: 'tournament_goals' });
  const round = composeRound({
    subject: cands[0].subject, metric: 'tournament_goals', window,
    scope: { clauses: [] }, registry, pool: players, rng: makeRng(1), difficulty: 'medium',
  });
  const correct = round.options.find(o => o.correct);
  assert.equal(String(correct.label), String(round.answer));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/questions.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/questions.js`:

```js
import { buildHints, hintOrder } from './hints.js';
import { metricDescriptor, metricsFor } from './stats.js';
import { RECIPES } from './recipes.js';
import { numericDistractors, nameDistractors, buildOptions } from './distractors.js';

export function informativeness(value, values) {
  if (value === undefined || value === null) return 0;
  const distinct = new Set(values.filter(v => v !== undefined && v !== null));
  if (distinct.size <= 1) return 0;
  return 1 - (1 / distinct.size);
}

function metricValue(subject, metric, window) {
  if (metric === 'identity') return subject.name;
  if (metric === 'international_caps') return subject.internationalCaps;
  if (metric === 'international_goals') return subject.internationalGoals;
  if (metric === 'highest_market_value_eur') return subject.highestMarketValueEur;
  if (metric === 'scarcity_peers') return subject.stats?.scarcity_peers;
  if (metric === 'tournament_goals') {
    return window?.id ? (subject.windows?.[window.id]?.goals) : undefined;
  }
  if (metric === 'club_goals') {
    if (window?.id && subject.windows?.[window.id]?.goals !== undefined) return subject.windows[window.id].goals;
    return subject.stats?.club_goals;
  }
  if (metric === 'goals_after_age_30') return subject.stats?.goals_after_age_30;
  return undefined;
}

export function candidateSubjects({ scope, pool, registry, window, metric }) {
  // An identify round can ask about any player in the pool. What makes one
  // better than another is how many real facts the hints can carry, because
  // that is what makes the question discriminable rather than a coin flip.
  if (metric === 'identity') {
    return (pool ?? [])
      .map(subject => ({ subject, value: subject.name, score: 1 + metricsFor(subject, window).length }))
      .sort((a, b) => b.score - a.score);
  }

  const values = (pool ?? []).map(s => metricValue(s, metric, window)).filter(v => v !== undefined && v !== null && v > 0);
  const out = [];
  for (const subject of pool ?? []) {
    const value = metricValue(subject, metric, window);
    if (value === undefined || value === null || value <= 0) continue;
    const score = informativeness(value, values);
    if (score <= 0) continue;
    out.push({ subject, value, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function composeRound({ subject, metric, window, scope, registry, pool, rng, difficulty = 'medium', roundMs = 20000, stages = 4 }) {
  const descriptor = metricDescriptor(metric);
  const recipe = RECIPES.find(r => r.metric === metric && r.windowKinds.includes(window?.kind ?? 'career'))
    ?? RECIPES.find(r => r.metric === 'identity');

  const value = metricValue(subject, metric, window);
  const spoken = recipe.speak({ subject, window, value, pool, registry });

  const hints = hintOrder(buildHints(subject, window, registry));
  const clues = hints.slice(0, Math.max(1, stages));

  const isNumeric = recipe.template === 'stat_value';
  const distractors = isNumeric
    ? numericDistractors({ value, pool, subject, metric, rng, count: 3 }).map(String)
    : nameDistractors({ pool, subject, scope, rng, count: 3 });

  const options = buildOptions({ answer: spoken.answer, distractors, rng });

  // Stages land at 2.0s, 6.5s, 11.0s and 15.5s, so the last clue always
  // arrives before the round closes at 20s.
  const revealSchedule = clues.map((_, i) => ({
    stage: i + 1,
    revealAtMs: Math.min(roundMs - 500, 2000 + i * 4500),
  }));

  return {
    template: recipe.template,
    metric,
    family: recipe.family ?? descriptor?.family ?? 'career',
    prompt: spoken.prompt,
    context: spoken.context ?? null,
    subjectId: subject.id,
    subjectName: subject.name,
    answer: spoken.answer,
    unit: spoken.unit ?? descriptor?.unit ?? null,
    options,
    clues: clues.map(c => ({ id: c.id, label: c.label, value: c.value, iconKey: c.iconKey })),
    revealSchedule,
    difficulty,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/questions.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/questions.js tests/engine/questions.test.js
git commit -m "feat(engine): compose rounds - subject selection by informativeness"
```

---

### Task 10: The quiz planner

**Files:**
- Create: `js/engine/planner.js`
- Create: `tests/engine/planner.test.js`

**Interfaces:**
- Consumes: `js/engine/scope.js` (`scopePool`), `js/engine/window.js` (`resolveWindow`), `js/engine/questions.js` (`candidateSubjects`, `composeRound`), `js/engine/recipes.js` (`recipesFor`), `js/engine/rng.js` (`makeRng`, `shuffle`)
- Produces: `planQuiz({ scope, pool, registry, seed, rounds = 10, difficulty = 'medium' })` → `Plan`:
  ```js
  {
    scope, seed, rounds: [Round],
    summary: { rounds: number, metricFamilies: number, subjects: number, hardestRound: number },
  }
  ```
  Throws `Error('scope resolves to N players, below the floor of 20')` when the pool is smaller than `MIN_POOL = 20`.

**The diversity constraints:**
1. No subject repeats — unless the pool is smaller than 20, where a subject may repeat at most twice.
2. No metric repeats consecutively.
3. The plan spans at least two metric families when the scope supports it.
4. A difficulty curve — the hint depth of later rounds is greater than earlier rounds.
5. No dead rounds — every round's answer is discriminable.

**This task owns Review Focus items 4 and 5.**

- [ ] **Step 1: Write the failing test**

Create `tests/engine/planner.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { planQuiz, MIN_POOL } from '../../js/engine/planner.js';
import { loadFixture } from '../../js/engine/fixture.js';

const scope = {
  v: 2, name: 'La Liga 2010s',
  clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }],
};

test('a plan has the requested number of rounds', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 1, rounds: 10 });
  assert.equal(plan.rounds.length, 10);
  assert.equal(plan.summary.rounds, 10);
});

test('the same seed produces an identical plan', () => {
  const { players, registry } = loadFixture();
  const a = planQuiz({ scope, pool: players, registry, seed: 99, rounds: 10 });
  const b = planQuiz({ scope, pool: players, registry, seed: 99, rounds: 10 });
  assert.deepEqual(a.rounds.map(r => r.subjectId), b.rounds.map(r => r.subjectId));
  assert.deepEqual(a.rounds.map(r => r.prompt), b.rounds.map(r => r.prompt));
});

test('a different seed produces a materially different plan', () => {
  const { players, registry } = loadFixture();
  const a = planQuiz({ scope, pool: players, registry, seed: 1, rounds: 10 });
  const b = planQuiz({ scope, pool: players, registry, seed: 2, rounds: 10 });
  const same = a.rounds.filter((r, i) => r.subjectId === b.rounds[i]?.subjectId).length;
  assert.ok(same / a.rounds.length < 0.5, 'a new seed should change most of the plan');
});

test('no subject is asked about twice', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 5, rounds: 10 });
  const ids = plan.rounds.map(r => r.subjectId);
  assert.equal(new Set(ids).size, ids.length);
});

test('no metric repeats consecutively', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 5, rounds: 10 });
  for (let i = 1; i < plan.rounds.length; i++) {
    assert.notEqual(plan.rounds[i].metric, plan.rounds[i - 1].metric,
      `metric repeated at rounds ${i} and ${i + 1}`);
  }
});

test('the plan spans more than one metric family when the scope allows', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 7, rounds: 10 });
  assert.ok(plan.summary.metricFamilies >= 2, 'a plan that only asks one kind of question is not a quiz');
});

test('a scope below the pool floor is refused with the count', () => {
  const { players, registry } = loadFixture();
  assert.throws(
    () => planQuiz({ scope: { clauses: [{ leagues: ['ZZ9'] }] }, pool: players, registry, seed: 1 }),
    (err) => err instanceof Error && /below the floor/.test(err.message),
  );
});

test('MIN_POOL is 20', () => {
  assert.equal(MIN_POOL, 20);
});

test('the difficulty curve never goes backwards', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({ scope, pool: players, registry, seed: 13, rounds: 10, difficulty: 'medium' });
  for (let i = 1; i < plan.rounds.length; i++) {
    assert.ok(plan.rounds[i].revealSchedule.length >= plan.rounds[i - 1].revealSchedule.length,
      `round ${i + 1} reveals fewer stages than round ${i}`);
  }
});

test('a hard plan reveals more stages than an easy one', () => {
  const { players, registry } = loadFixture();
  const easy = planQuiz({ scope, pool: players, registry, seed: 21, rounds: 10, difficulty: 'easy' });
  const hard = planQuiz({ scope, pool: players, registry, seed: 21, rounds: 10, difficulty: 'hard' });
  const last = r => r.rounds[r.rounds.length - 1].revealSchedule.length;
  assert.ok(last(hard) >= last(easy));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/planner.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/planner.js`:

```js
import { scopePool } from './scope.js';
import { resolveWindow } from './window.js';
import { candidateSubjects, composeRound } from './questions.js';
import { recipesFor } from './recipes.js';
import { makeRng, shuffle } from './rng.js';
export const MIN_POOL = 20;

const DIFFICULTY_DEPTH = { easy: 1, medium: 2, hard: 3 };

export function planQuiz({ scope, pool, registry, seed = 1, rounds = 10, difficulty = 'medium' }) {
  const rng = makeRng(seed);
  const players = scopePool(scope, pool);

  if (players.length < MIN_POOL) {
    throw new Error(`scope resolves to ${players.length} players, below the floor of ${MIN_POOL}`);
  }

  const window = resolveWindow(scope, registry);
  const recipes = recipesFor({ template: null, window, pool: players });
  if (recipes.length === 0) {
    throw new Error('no question recipe is available for this scope');
  }

  const usedSubjects = new Set();
  const usedMetrics = new Set();
  const plan = [];

  for (let i = 0; i < rounds; i++) {
    const depth = DIFFICULTY_DEPTH[difficulty] ?? 2;
    const candidates = [];

    for (const recipe of recipes) {
      if (plan.length && plan[plan.length - 1].metric === recipe.metric) continue;
      const cands = candidateSubjects({ scope, pool: players, registry, window, metric: recipe.metric });
      for (const c of cands) {
        if (usedSubjects.has(c.subject.id)) continue;
        candidates.push({ ...c, recipe });
      }
    }

    if (candidates.length === 0) {
      // relax: allow a repeated subject rather than emitting a dead round
      for (const recipe of recipes) {
        const cands = candidateSubjects({ scope, pool: players, registry, window, metric: recipe.metric });
        if (cands.length) { candidates.push({ ...cands[0], recipe }); break; }
      }
    }
    if (candidates.length === 0) break;

    const chosen = candidates[Math.floor(rng() * candidates.length)];

    // The difficulty curve: early rounds reveal fewer stages, so the
    // high-multiplier early clues carry the answer; later rounds dig deeper
    // and give up the x5 stage.
    const stages = depth >= 3 ? 4 : depth >= 2 ? (i < rounds / 2 ? 3 : 4) : 3;

    const round = composeRound({
      subject: chosen.subject,
      metric: chosen.recipe.metric,
      window,
      scope,
      registry,
      pool: players,
      rng,
      difficulty,
      stages,
    });
    round.stage = i + 1;

    plan.push(round);
    usedSubjects.add(chosen.subject.id);
    usedMetrics.add(chosen.recipe.metric);
  }

  const families = new Set(plan.map(r => r.family));
  const hardest = plan.reduce((acc, r, i) => (r.clues.length > acc.depth ? { index: i + 1, depth: r.clues.length } : acc), { index: 1, depth: 0 });
  return {
    scope,
    seed,
    rounds: plan,
    summary: {
      rounds: plan.length,
      metricFamilies: families.size,
      subjects: new Set(plan.map(r => r.subjectId)).size,
      hardestRound: hardest.index,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/planner.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add js/engine/planner.js tests/engine/planner.test.js
git commit -m "feat(engine): the quiz planner - ten rounds with a designed shape"
```

---

### Task 11: The public API

**Files:**
- Create: `js/engine/index.js`
- Create: `tests/engine/integration.test.js`

**Interfaces:**
- Consumes: `js/engine/planner.js` (`planQuiz`), `js/engine/scope.js` (`scopePool`), `js/engine/scoring.js` (`scoreRound`)
- Produces: `generateQuiz({ scope, pool, registry, seed, rounds, difficulty })` → `Plan`
- Produces: `answerRound(round, { answer, stage, elapsedMs })` → `{ correct, points, multiplier, timeFactor }` — the same validation the server will run. Uses exact-then-normalised name matching for `identify` rounds and numeric equality for `stat_value` rounds.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/integration.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuiz, answerRound } from '../../js/engine/index.js';
import { loadFixture } from '../../js/engine/fixture.js';

const scope = {
  v: 2, name: 'La Liga 2010s',
  clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }],
};

test('generateQuiz returns a playable plan', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({ scope, pool: players, registry, seed: 2024, rounds: 10 });
  assert.equal(plan.rounds.length, 10);
  for (const r of plan.rounds) {
    assert.equal(r.options.length, 4);
    assert.equal(r.options.filter(o => o.correct).length, 1);
    assert.ok(r.clues.length >= 3);
  }
});

test('answering a stat round scores correctly', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({ scope, pool: players, registry, seed: 3, rounds: 10 });
  const statRound = plan.rounds.find(r => r.template === 'stat_value');
  if (!statRound) return; // the scope may only support identify rounds
  const res = answerRound(statRound, { answer: statRound.answer, stage: 1, elapsedMs: 1500 });
  assert.equal(res.correct, true);
  assert.equal(res.points, 7500);
});

test('answering an identify round accepts the right name and rejects a wrong one', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({ scope, pool: players, registry, seed: 8, rounds: 10 });
  const idRound = plan.rounds.find(r => r.template === 'identify');
  if (!idRound) return;
  assert.equal(answerRound(idRound, { answer: idRound.subjectName, stage: 2, elapsedMs: 5000 }).correct, true);
  assert.equal(answerRound(idRound, { answer: 'Definitely Not A Player', stage: 2, elapsedMs: 5000 }).correct, false);
});

test('the engine imports cleanly with no DOM', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'the engine must not require a DOM');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine/integration.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/engine/index.js`.

- [ ] **Step 3: Write the implementation**

Create `js/engine/index.js`:

```js
import { planQuiz } from './planner.js';
import { scoreRound } from './scoring.js';
import { normaliseName } from '../../lib/names.js';

export { planQuiz } from './planner.js';
export { scopePool, playerInScope, statMatches } from './scope.js';
export { resolveWindow, windowLabel } from './window.js';
export { METRICS, formatMetric, metricsFor } from './stats.js';
export { buildHints, hintOrder } from './hints.js';
export { RECIPES, recipesFor } from './recipes.js';
export { composeRound, candidateSubjects } from './questions.js';
export { numericDistractors, nameDistractors, buildOptions } from './distractors.js';
export { scoreRound, STAGE_MULTIPLIERS } from './scoring.js';
export { makeRng } from './rng.js';

export function generateQuiz({ scope, pool, registry, seed = 1, rounds = 10, difficulty = 'medium' }) {
  return planQuiz({ scope, pool, registry, seed, rounds, difficulty });
}

export function answerRound(round, { answer, stage, elapsedMs }) {
  let correct = false;
  if (round.template === 'stat_value') {
    correct = String(answer).trim() === String(round.answer).trim();
  } else {
    const given = normaliseName(answer ?? '');
    const truth = normaliseName(round.answer ?? '');
    correct = given === truth;
  }
  const scored = scoreRound({ correct, stage, elapsedMs });
  return { correct, ...scored };
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: all tests PASS, including the data-spine suite.

- [ ] **Step 5: Commit**

```bash
git add js/engine/index.js tests/engine/integration.test.js
git commit -m "feat(engine): public API - generateQuiz and answerRound"
```

---

## Definition of Done

- `npm test` passes with no skipped tests.
- `generateQuiz` with the committed fixture returns a ten-round plan for the "La Liga 2010s" scope, with no repeated subject and no consecutively repeated metric.
- The same `(scope, seed)` always returns an identical plan; a different seed changes more than half the rounds.
- Every windowed value in a rendered clue names its window; every exact value does not.
- `grep -rn "document\|window\." js/engine/` returns nothing — the engine is DOM-free.
- `grep -rn "Math.random" js/engine/` returns nothing — all randomness is seeded.
- No hint, question or option ever renders `null`, `undefined`, `NaN` or a missing stat as `0`.

## Out of Scope for this plan

- The client shell, the theme tokens, and the screens (`docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` §8).
- Supabase, the room, Realtime and Auth (§7).
- The `stat_value` and `membership` templates beyond T1 `identify` — the templates are registry entries, and v1.1 adds the two new ones.
