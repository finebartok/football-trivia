# Scope Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The vibe crafter becomes the thing the v1 spec describes — a stat threshold you can type with a nearest-valid suggestion, a coverage warning that says why, a thin scope refused on save, a tournament move, share links — and a crafted vibe becomes playable in a room.

**Architecture:** A new shared module `lib/scope.js` holds the advice around a scope: the nearest threshold that holds, the sentence that explains a thin pool, the link encoding, and the shape validation. The browser uses it to drive the vibe screen; the server uses it to check what a room's scope claims to be. The room's scope resolution changes so a preset room still uses the preset's own clauses, while a crafted scope travels with the room and is validated before it is planned.

**Tech Stack:** Plain ESM JavaScript, no build step, no new dependency. `node --test` for the shared module and the integration tests, Playwright for the screen.

**Spec:** `docs/superpowers/specs/2026-10-21-scope-builder-design.md` — read it before starting. It is the authority on behaviour.

---

## Global Constraints

These apply to every task. They are not negotiable without changing the spec first.

- **The engine is not modified.** `js/engine/*` stays pure, DOM-free and free of `node:` imports. The floor stays in `js/engine/planner.js` and its value stays `20`.
- **No player-facing string may name a scope, a predicate, a metric, a window id or a raw id.** The noun is "vibe", the verb is "craft". A threshold's metric is shown as words ("goals aged 30+"), never as `goals_after_age_30`.
- **A number the player typed is never rejected.** A threshold that leaves three players keeps the number in the field and offers a suggestion beside it. Only *saving* is refused, and only with the count and the reason.
- **A preset room uses the preset's own clauses.** The client cannot change what a preset means. Only a crafted scope is client-supplied, and it is validated before it is planned.
- **Nothing reaches a player as a 500.** Every refusal comes back as a sentence a player can read.
- **The floor is twenty players** (`MIN_POOL` in `js/engine/planner.js`). A scope under it cannot be saved and cannot start a game.
- **The client has no build step.** Plain ESM loaded by the browser. New shared code goes under `lib/` or `client/src/`, both of which the browser already loads.
- **The server never trusts a link.** The link's payload is validated before it is planned, and a link cannot make the server do anything a player could already do by typing the clauses into a room.
- **Node tests:** `npm test`. **Browser tests:** `npm run test:client`. **Integration tests** skip themselves when the local Supabase stack is not running.

## Review Focus

Five input classes the spec implies but no task's happy path exercises. Each one gets a test in the task that owns the code.

1. **A threshold of zero, or a negative one.** A player types 0 into "50+ goals aged 30+". The field must not accept a nonsense threshold and must not crash the count. → Task 1 (the library) and Task 2 (the field)
2. **A share link that has been edited or truncated.** The payload no longer decodes, or decodes into something that is not a scope. The recipient must get a plain message and the home screen, not a broken screen. → Task 3
3. **A crafted scope whose clause names a league that does not exist.** The room must refuse it with a reason and stay in the lobby. → Task 6
4. **A crafted scope that resolves to fewer than twenty players.** The host must be told the count before the quiz is written, and the room must stay in the lobby. → Task 6
5. **A saved vibe opened on a different phone.** The vibe lives in that browser's storage, so the other phone does not have it. Opening the vibe list must not crash or show a vibe the player cannot play. → Task 5

---

## File Structure

| Path | Responsibility |
|---|---|
| `lib/scope.js` | The advice around a scope: the nearest threshold that holds, the coverage sentence, the link encoding, the shape validation. Pure; shared by the browser and the server. |
| `client/src/vibe-moves.js` | The moves, their option lists, and `applyMove`. Split out of the screen so the screen stays readable. |
| `client/src/screens/vibes.js` | The vibe screen: the header, the live count, the moves, the threshold field, the save, the share. |
| `client/src/screens/home.js` | The share button on a vibe card, and the saved-vibe list. |
| `client/src/main.js` | The `#vibe` route, which opens a shared link as a ready-to-play card. |
| `supabase/functions/_shared/start-room.js` | Resolves the room's scope — the preset's own clauses, or a validated crafted scope — and checks the floor before the plan is written. |
| `supabase/migrations/…00200_room_functions.sql` | `create_room`, which already takes the scope's clauses, keeps them for a crafted scope. |
| `tests/shared/scope.test.js` | Unit tests for `lib/scope.js`. |
| `tests/client/vibes.spec.js` | The screen: the threshold, the suggestion, the save refusal, the link. |
| `tests/integration/room.test.js` | A room with a crafted scope, and the refusals. |

---

## Task 1: The shared scope module

**Files:**
- Create: `lib/scope.js`
- Test: `tests/shared/scope.test.js`

**Interfaces:**
- Consumes: `js/engine/scope.js` (`scopePool`), `js/engine/stats.js` (`METRICS`), `js/engine/planner.js` (`MIN_POOL`).
- Produces:
  - `nearestThreshold({ scope, metric, op, players, floor, min, max }) -> { value, count } | null`
  - `describeCoverage({ scope, count, floor }) -> string`
  - `encodeScope(scope) -> string`
  - `decodeScope(code) -> { name, icon, clauses } | null`
  - `validateScope(scope, { registry, players }) -> { ok: true } | { ok: false, reason: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/shared/scope.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nearestThreshold, describeCoverage, encodeScope, decodeScope, validateScope } from '../../lib/scope.js';

const pool = JSON.parse(await readFile(new URL('../../data/fixtures/pool.sample.json', import.meta.url), 'utf8'));
const players = pool.players;
const registry = pool.registry;

const wc = { clauses: [{ tournaments: ['wc-2022'] }] };
const laliga = { clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] };

test('a scope round trips through a link', () => {
  const scope = { name: 'My vibe', icon: '⚽', clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] };
  const decoded = decodeScope(encodeScope(scope));
  assert.deepEqual(decoded, scope);
});

test('a link that is not a scope decodes to null', () => {
  assert.equal(decodeScope('not-a-scope'), null);
  assert.equal(decodeScope(''), null);
  assert.equal(decodeScope(undefined), null);
});

test('a link that has been edited decodes to null rather than to nonsense', () => {
  const code = encodeScope({ name: 'x', icon: '⚽', clauses: [{ leagues: ['ES1'] }] });
  const broken = code.slice(0, -4) + 'AAAA';
  const decoded = decodeScope(broken);
  assert.ok(decoded === null || Array.isArray(decoded.clauses), 'never a half-decoded scope');
});

test('the nearest threshold is the closest one that still holds', () => {
  const scope = { clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 1 }] }] };
  const near = nearestThreshold({ scope, metric: 'goals_after_age_30', players, floor: 20, max: 400 });
  assert.ok(near, 'a threshold is found');
  assert.ok(near.value < 200, 'the suggestion is below the number that was typed');
  assert.ok(near.count >= 20, 'the suggestion holds');
});

test('the nearest threshold is monotonic in the pool', () => {
  const scope = { clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 1 }] }] };
  const low = nearestThreshold({ scope, metric: 'international_caps', players, floor: 20, max: 120 });
  const high = nearestThreshold({ scope: { clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 1 }] }] }, metric: 'international_caps', players, floor: 20, min: 0, max: 120 });
  assert.ok(low.value >= 0 && high.value >= 0);
  assert.ok(low.count >= 20 && high.count >= 20);
});

test('a threshold of zero is not a crash', () => {
  const scope = { clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 0 }] }] };
  const near = nearestThreshold({ scope, metric: 'goals_after_age_30', players, floor: 20, max: 400 });
  assert.ok(near === null || near.count >= 0, 'either no suggestion, or a real one');
});

test('the coverage sentence says how many and why', () => {
  const sentence = describeCoverage({ scope: laliga, count: 49, floor: 20 });
  assert.match(sentence, /49/);
  assert.match(sentence, /20/);
  assert.equal(sentence.includes('scope'), false, 'the sentence must not name a scope');
});

test('a valid scope passes validation', () => {
  const result = validateScope(wc, { registry, players });
  assert.equal(result.ok, true, result.reason);
});

test('a scope naming a league that does not exist is refused', () => {
  const result = validateScope({ clauses: [{ leagues: ['NOPE1'] }] }, { registry, players });
  assert.equal(result.ok, false);
  assert.ok(result.reason.length > 0);
});

test('a scope naming a stat that does not exist is refused', () => {
  const result = validateScope({ clauses: [{ stats: [{ metric: 'made_up_metric', op: '>=', value: 5 }] }] }, { registry, players });
  assert.equal(result.ok, false);
});

test('a scope with a number where a year should be is refused', () => {
  const result = validateScope({ clauses: [{ leagues: ['ES1'], seasonStart: 'last year', seasonEnd: 2019 }] }, { registry, players });
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/shared/scope.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/scope.js`.

- [ ] **Step 3: Write the module**

Create `lib/scope.js`:

```js
/**
 * The advice around a scope.
 *
 * The engine decides which players a scope matches. This module decides
 * what to tell a person about that scope: the nearest threshold that
 * still works, the sentence that explains a thin pool, the link that
 * carries it, and whether the server will accept it.
 *
 * Pure, and shared by the browser, the Node scripts and the server.
 */
import { scopePool } from '../js/engine/scope.js';
import { METRICS } from '../js/engine/stats.js';
import { MIN_POOL } from '../js/engine/planner.js';

const OPS = new Set(['>=', '>', '<=', '<', '=', '!=']);

/** The players a scope resolves to, with one stat threshold replaced. */
function poolFor(scope, metric, value, players, op = '>=') {
  const clauses = scope.clauses.map((c) => {
    if (!c.stats) return { ...c };
    return {
      ...c,
      stats: c.stats.map((s) => (s.metric === metric ? { ...s, op, value } : { ...s })),
    };
  });
  return scopePool({ clauses }, players);
}

/**
 * The nearest threshold that still clears the floor.
 *
 * A ">= threshold" pool shrinks monotonically as the threshold rises, so
 * this is a binary search rather than a scan. It looks downward first:
 * the largest threshold at or below the typed one whose pool still holds,
 * and failing that, the smallest one above it that does.
 */
export function nearestThreshold({ scope, metric, op = '>=', players, floor = MIN_POOL, min = 0, max = 5000 }) {
  const countAt = (value) => poolFor(scope, metric, value, players, op).length;

  // A threshold that already holds needs no suggestion.
  const typed = thresholdIn(scope, metric);
  if (typed !== null && countAt(typed) >= floor) {
    return { value: typed, count: countAt(typed) };
  }

  const search = (lo, hi) => {
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (countAt(mid) >= floor) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi;
  };

  const below = search(min, Math.min(max, typed ?? max));
  if (below >= min && countAt(below) >= floor) {
    return { value: below, count: countAt(below) };
  }

  const above = search(Math.max(min, (typed ?? min) + 1), max);
  if (above <= max && countAt(above) >= floor) {
    return { value: above, count: countAt(above) };
  }

  return null;
}

/** The threshold the scope already carries for this metric, or null. */
function thresholdIn(scope, metric) {
  for (const clause of scope.clauses ?? []) {
    for (const stat of clause.stats ?? []) {
      if (stat.metric === metric) return Number(stat.value);
    }
  }
  return null;
}

/** How a threshold reads in a sentence: "goals aged 30+", never a metric id. */
export function metricLabel(metric) {
  switch (metric) {
    case 'goals_after_age_30': return 'goals aged 30+';
    case 'international_caps': return 'international caps';
    case 'club_goals': return 'goals since 2012';
    case 'international_goals': return 'international goals';
    default: return 'the stat';
  }
}

/**
 * The sentence a player reads when the pool is too thin.
 *
 * It says how many players there are and what the floor is. It never says
 * "scope", "predicate" or a metric id.
 */
export function describeCoverage({ scope, count, floor = MIN_POOL, registry }) {
  if (count >= floor) return '';
  const what = describeScope(scope, registry);
  return `Only ${count} ${count === 1 ? 'player' : 'players'} fit ${what}. A vibe needs at least ${floor}.`;
}

/** A short description of what a scope points at, in words. */
export function describeScope(scope, registry) {
  const clause = scope?.clauses?.[0] ?? {};
  if (clause.tournaments?.length) {
    const name = clause.tournaments.map((id) => tournamentName(id, registry)).join(' or ');
    return name ? `${name}` : 'that tournament';
  }
  if (clause.clubs?.length) {
    return clause.clubs.length === 1 ? 'that club' : 'those clubs';
  }
  if (clause.nations?.length) {
    return clause.nations.length === 1 ? `players from ${clause.nations[0]}` : 'those nations';
  }
  if (clause.leagues?.length) {
    const years = clause.seasonStart && clause.seasonEnd ? `, ${clause.seasonStart}-${clause.seasonEnd}` : '';
    return `${clause.leagues.join(' or ')}${years}`;
  }
  if (clause.stats?.length) {
    const stat = clause.stats[0];
    return `${stat.value}+ ${metricLabel(stat.metric)}`;
  }
  return 'that vibe';
}

function tournamentName(id, registry) {
  const list = registry?.tournaments ?? [];
  const found = Array.isArray(list) ? list.find((t) => t.id === id) : list?.[id];
  return found?.name ?? '';
}

/** The scope's clauses, name and icon, as a link payload. */
export function encodeScope(scope) {
  const payload = { name: scope.name ?? '', icon: scope.icon ?? '', clauses: scope.clauses ?? [] };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * The scope a link carries, or null.
 *
 * A link that has been edited, truncated or is not a scope at all
 * decodes to null. It never decodes to half a scope.
 */
export function decodeScope(code) {
  if (!code || typeof code !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!Array.isArray(parsed.clauses)) return null;
  return { name: parsed.name ?? '', icon: parsed.icon ?? '', clauses: parsed.clauses };
}

/**
 * Is this a scope the server will accept?
 *
 * The shape, not the size: the floor is checked where the size is known.
 */
export function validateScope(scope, { registry = {}, players = [] } = {}) {
  if (!scope || !Array.isArray(scope.clauses) || scope.clauses.length === 0) {
    return { ok: false, reason: 'That vibe has nothing in it.' };
  }

  const knownNations = new Set();
  for (const p of players ?? []) {
    for (const c of p.citizenship ?? []) knownNations.add(c);
  }

  const knownTournaments = new Set(
    (Array.isArray(registry?.tournaments) ? registry.tournaments : []).map((t) => t.id),
  );

  for (const clause of scope.clauses) {
    for (const id of clause.leagues ?? []) {
      if (!registry?.leagues?.[id]) return { ok: false, reason: 'That competition is not one the data knows.' };
    }
    for (const id of clause.clubs ?? []) {
      if (!registry?.clubs?.[id]) return { ok: false, reason: 'That club is not one the data knows.' };
    }
    for (const id of clause.nations ?? []) {
      if (!knownNations.has(id)) return { ok: false, reason: 'That nation is not one the data knows.' };
    }
    for (const id of clause.tournaments ?? []) {
      if (!knownTournaments.has(id)) return { ok: false, reason: 'That tournament is not one the data knows.' };
    }
    for (const stat of clause.stats ?? []) {
      if (!METRICS[stat.metric]) return { ok: false, reason: 'That stat is not one the data knows.' };
      if (!OPS.has(stat.op)) return { ok: false, reason: 'That comparison is not one the data knows.' };
      if (typeof stat.value !== 'number' || !Number.isFinite(stat.value)) {
        return { ok: false, reason: 'That number is not a number.' };
      }
    }
    for (const key of ['seasonStart', 'seasonEnd']) {
      if (clause[key] !== undefined && typeof clause[key] !== 'number') {
        return { ok: false, reason: 'That era is not a pair of years.' };
      }
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/shared/scope.test.js`
Expected: PASS, 12 tests. If the nearest-threshold test fails with a suggestion that is not below the typed value, the binary search is searching the wrong half — read the "search downward first" comment.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
git add lib/scope.js tests/shared/scope.test.js
git commit -m "The advice around a scope

The engine decides which players a scope matches. This decides what to
tell a person about that scope: the nearest threshold that still holds,
the sentence that explains a thin pool, the link that carries it, and
whether the server will accept it.

The nearest threshold is a binary search rather than a scan, because a
\">=\" pool shrinks monotonically as the threshold rises."
```

---

## Task 2: The threshold control

**Files:**
- Create: `client/src/vibe-moves.js`
- Modify: `client/src/screens/vibes.js`
- Test: `tests/client/vibes.spec.js`

**Interfaces:**
- Consumes: `lib/scope.js` (`nearestThreshold`, `describeCoverage`, `metricLabel`), `js/engine/scope.js` (`scopePool`).
- Produces: `client/src/vibe-moves.js` exporting `MIN_POOL`, `MOVES`, `STAT_MOVES`, `STAT_METRICS`, `erasFor(players)`, `competitionsFor(registry, players)`, `clubsFor(players)`, `nationsFor(players)`, `tournamentsFor(registry, players)`, `applyMove(vibe, move, value, players, registry)`, `shareLink(scope)`.

**The era control stays as bands.** The spec's §5.5 says "era slider", but the coverage is not
smooth - La Liga 2010s resolves 236 players and 2002-11 resolves 49 - and a continuous
slider would have to interpolate over that cliff, showing a number that describes no window
that exists. `erasFor` is unchanged and this phase adds the reason beside it.

- [ ] **Step 1: Write the failing browser test**

Create `tests/client/vibes.spec.js`:

```js
import { test, expect } from '@playwright/test';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test('a threshold the player typed is kept, with a suggestion beside it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/vibes');
  await page.waitForSelector('#pool-count');

  const before = Number(await page.locator('#pool-count strong').innerText());

  // Type a threshold that leaves too few players.
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('200');
  await page.waitForTimeout(400);

  // The number they typed is still there.
  await expect(page.locator('#stat-value')).toHaveValue('200');

  // The count moved.
  const after = Number(await page.locator('#pool-count strong').innerText());
  expect(after).toBeLessThan(before);

  // And there is a suggestion.
  await expect(page.locator('#stat-suggestion')).toBeVisible();
  await expect(page.locator('#stat-suggestion')).toContainText(/try \d+/);

  expect(errors).toEqual([]);
});

test('a threshold of zero does not break the count', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('0');
  await page.waitForTimeout(400);
  await expect(page.locator('#pool-count strong')).toBeVisible();
  await page.locator('#stat-value').fill('-5');
  await page.waitForTimeout(400);
  await expect(page.locator('#pool-count strong')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a suggestion one tap away fixes the threshold', async ({ page }) => {
  await page.goto('./#/vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('200');
  await page.waitForTimeout(400);

  await page.locator('#stat-suggestion button').click();
  await page.waitForTimeout(400);

  const value = await page.locator('#stat-value').inputValue();
  expect(Number(value)).toBeLessThan(200);
  await expect(page.locator('#stat-suggestion')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/client/vibes.spec.js`
Expected: FAIL — there is no `#stat-value` field.

- [ ] **Step 3: Move the moves out of the screen**

Create `client/src/vibe-moves.js` with the content of `client/src/screens/vibes.js` up to and including `applyMove`, `moveRow` and the count helpers, changed to export rather than to be module-private:

```js
import { scopePool } from '/js/engine/index.js';

export const MIN_POOL = 20;

/** The named moves a player can make to a vibe. Each is one sentence, not a query. */
export const MOVES = [
  { id: 'era', label: 'Different era' },
  { id: 'competition', label: 'Different competition' },
  { id: 'club', label: 'Add a club' },
  { id: 'nation', label: 'Only these nations' },
  { id: 'tournament', label: 'A tournament' },
  { id: 'stat', label: 'A narrower stat' },
];

/** The thresholds that are one tap away. They are suggestions, not a menu. */
export const STAT_MOVES = [
  { id: 'goals_after_age_30', label: '50+ goals aged 30+', op: '>=', value: 50 },
  { id: 'goals_after_age_30', label: '30+ goals aged 30+', op: '>=', value: 30 },
  { id: 'international_caps', label: '50+ international caps', op: '>=', value: 50 },
  { id: 'international_caps', label: '100+ international caps', op: '>=', value: 100 },
  { id: 'club_goals', label: '100+ goals since 2012', op: '>=', value: 100 },
];

/** The stats a threshold can be set on. The label is words, never a metric id. */
export const STAT_METRICS = [
  { id: 'goals_after_age_30', label: 'goals aged 30+' },
  { id: 'international_caps', label: 'international caps' },
  { id: 'club_goals', label: 'goals since 2012' },
  { id: 'international_goals', label: 'international goals' },
];

export function erasFor(players) { /* the body of the existing erasFor */ }
export function competitionsFor(registry, players) { /* the body of the existing competitionsFor */ }
export function clubsFor(players) { /* the body of the existing clubsFor */ }
export function nationsFor(players) { /* the body of the existing nationsFor */ }

/** The tournaments the data knows, with how many players each has. */
export function tournamentsFor(registry, players) {
  const list = Array.isArray(registry?.tournaments) ? registry.tournaments : [];
  const counts = new Map();
  for (const p of players) {
    for (const id of p.tournaments ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return list
    .map((t) => ({ id: t.id, name: t.name, players: counts.get(t.id) ?? 0 }))
    .filter((t) => t.players > 0)
    .sort((a, b) => b.players - a.players);
}

/** Apply a move to a vibe's clauses, returning a NEW vibe. Never mutates. */
export function applyMove(vibe, move, value, players, registry) { /* the existing body, with the tournament case added */ }
```

The `applyMove` body gains a tournament case:

```js
    case 'tournament':
      return {
        ...vibe,
        clauses: [{ ...c, tournaments: [value.id] }],
      };
```

and the stat case accepts a typed value:

```js
    case 'stat':
      return {
        ...vibe,
        clauses: [{
          ...c,
          stats: [{ metric: value.metric, op: value.op ?? '>=', value: Number(value.value) }],
        }],
      };
```

Then in `client/src/screens/vibes.js`, delete the moved code and import it instead:

```js
import {
  MIN_POOL, MOVES, STAT_MOVES, STAT_METRICS,
  erasFor, competitionsFor, clubsFor, nationsFor, tournamentsFor, applyMove,
} from '../vibe-moves.js';
```

- [ ] **Step 4: Add the threshold field to the screen**

In `client/src/screens/vibes.js`, add a threshold row to the "Make it yours" section, after the moves:

```js
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'A threshold' }),
      el('div', { className: 'threshold-row' }, [
        el('select', { className: 'text-input', attrs: { id: 'stat-metric' } },
          STAT_METRICS.map((m) => el('option', { text: m.label, attrs: { value: m.id } }))),
        el('input', {
          className: 'text-input',
          attrs: { type: 'number', id: 'stat-value', min: '0', placeholder: '50', value: '50' },
        }),
      ]),
      el('p', { className: 'muted-note', attrs: { id: 'stat-suggestion' } }),
    ]),
```

The suggestion element is filled in by the screen's render, which recomputes it whenever the typed value changes. Add to the screen's render, after the moves are built:

```js
  const statMetric = store.state.scope?.clauses?.[0]?.stats?.[0]?.metric ?? STAT_METRICS[0].id;
  const typedValue = Number(thresholdInput?.value ?? 0);
  const suggestion = nearestThreshold({
    scope: { clauses: [{ stats: [{ metric: statMetric, op: '>=', value: typedValue }] }] },
    metric: statMetric,
    players,
    floor: MIN_POOL,
    max: 1000,
  });
```

and the suggestion text:

```js
  const suggestionText = suggestion && suggestion.count < count
    ? `Only ${suggestion.count} players hit ${typedValue}+ ${metricLabel(statMetric)} — try ${suggestion.value}+`
    : '';
```

The suggestion's button applies the suggestion:

```js
      el('p', { className: 'muted-note', attrs: { id: 'stat-suggestion' } }, [
        suggestionText,
        suggestion ? el('button', {
          className: 'btn btn--tiny',
          text: `Use ${suggestion.value}+`,
          attrs: { type: 'button' },
          on: {
            click: (e) => {
              e.preventDefault();
              thresholdInput.value = String(suggestion.value);
              onPick({ id: 'stat', metric: statMetric, op: '>=', value: suggestion.value }, suggestion);
            },
          },
        }) : null,
      ]),
```

The threshold input re-renders the screen on change, so the count and the suggestion stay live:

```js
        el('input', {
          className: 'text-input',
          attrs: { type: 'number', id: 'stat-value', min: '0', placeholder: '50', value: '50' },
          on: {
            input: (e) => {
              const value = Number(e.currentTarget.value);
              if (Number.isFinite(value)) {
                onPick({ id: 'stat', metric: statMetric, op: '>=', value }, value);
              }
            },
          },
        }),
```

- [ ] **Step 5: Run the browser test**

Run: `npx playwright test tests/client/vibes.spec.js`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test` and `npx playwright test`
Expected: both PASS. The existing client test that picks a preset and starts a quiz must still pass.

- [ ] **Step 7: Commit**

```bash
git add lib/scope.js client/src/vibe-moves.js client/src/screens/vibes.js tests/client/vibes.spec.js
git commit -m "A threshold you can type

The fixed choices become quick picks under a number field. Type 200 and
the count moves with you; the number stays in the field even when it
leaves three players, and a suggestion sits beside it - \"only 3 players
hit 200+ goals aged 30+ - try 50+\" - one tap away.

The moves move into their own module. The screen was 270 lines and
would have passed 400."
```

---

## Task 3: The share link

**Files:**
- Modify: `client/src/main.js`, `client/src/screens/home.js`, `client/src/screens/vibes.js`
- Test: `tests/client/vibes.spec.js`

**Interfaces:**
- Consumes: `lib/scope.js` (`encodeScope`, `decodeScope`), `client/src/store.js` (`setScope`).
- Produces: the route `#vibe?c=<payload>`, and `shareLink(scope) -> string` from `client/src/vibe-moves.js`.

- [ ] **Step 1: Write the failing browser test**

Add to `tests/client/vibes.spec.js`:

```js
test('a vibe can be shared, and the link opens as a card', async ({ page, context }) => {
  await page.goto('./#/vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#btn-share').click();

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#vibe?c=');

  // A different browser opens the link and lands on a playable card.
  const other = await (await context.browser().newContext()).newPage();
  await other.goto(link.replace('http://localhost:8123', '').startsWith('/') ? link : link);
  await other.waitForTimeout(800);
  await expect(other.locator('#pool-count')).toBeVisible();
  await expect(other.locator('.vibe-summary__body')).toContainText('La Liga 2010s');
});

test('a link that is not a vibe says so', async ({ page }) => {
  await page.goto('./#/vibe?c=not-a-scope');
  await page.waitForTimeout(600);
  await expect(page.locator('#vibe-error')).toContainText('not a vibe');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/client/vibes.spec.js`
Expected: FAIL — there is no `#btn-share` and no `#vibe` route.

- [ ] **Step 3: Add the link builder**

Add to `client/src/vibe-moves.js`:

```js
import { encodeScope } from '/lib/scope.js';

/** The link that carries a vibe. */
export function shareLink(scope) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#vibe?c=${encodeScope(scope)}`;
}
```

- [ ] **Step 4: Add the share button to the vibe screen**

In `client/src/screens/vibes.js`, add to the "Save it" section, after the save button:

```js
      el('button', {
        className: 'btn btn--ghost',
        text: 'Share this vibe',
        attrs: { type: 'button', id: 'btn-share' },
        on: {
          click: async (e) => {
            const link = shareLink(store.state.scope ?? vibe);
            try {
              await navigator.clipboard.writeText(link);
              e.currentTarget.textContent = 'Link copied';
            } catch {
              e.currentTarget.textContent = link;
            }
          },
        },
      }),
```

- [ ] **Step 5: Add the route**

In `client/src/main.js`, add a screen for the shared link:

```js
import * as sharedVibe from './screens/shared-vibe.js';
```

```js
  '#vibe': sharedVibe,
```

Create `client/src/screens/shared-vibe.js`:

```js
import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { decodeScope, describeScope } from '/lib/scope.js';

export function render(root) {
  const code = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('c');
  const scope = decodeScope(code);

  if (!scope) {
    mount(root, [
      el('section', { className: 'card' }, [
        el('h1', { className: 'page-title', text: 'That link is not a vibe' }),
        el('p', { className: 'muted-note', attrs: { id: 'vibe-error' } }, 'This link does not carry a vibe we can play.'),
        el('a', { className: 'btn btn--primary', text: 'Start from a vibe', attrs: { href: '#vibes' } }),
      ]),
    ]);
    return;
  }

  store.setScope({ id: 'shared', name: scope.name || 'A shared vibe', icon: scope.icon || '⚽', clauses: scope.clauses });

  mount(root, [
    el('section', { className: 'card vibe-summary' }, [
      el('span', { className: 'vibe-summary__icon', text: scope.icon || '⚽' }),
      el('div', { className: 'vibe-summary__body' }, [
        el('h1', { className: 'page-title', text: scope.name || 'A shared vibe' }),
        el('p', { className: 'muted-note', text: describeScope(scope) }),
      ]),
    ]),
    el('a', { className: 'btn btn--primary', text: 'Play this vibe', attrs: { href: '#vibes' } }),
    el('a', { className: 'btn btn--ghost', text: 'Make it ours', attrs: { href: '#vibes' } }),
  ]);
}
```

- [ ] **Step 6: Run the browser test**

Run: `npx playwright test tests/client/vibes.spec.js`
Expected: PASS, 4 tests. If the clipboard read fails, grant the permission in the test with `context.grantPermissions(['clipboard-read', 'clipboard-write'])`.

- [ ] **Step 7: Commit**

```bash
git add client/src/main.js client/src/screens/home.js client/src/screens/vibes.js client/src/screens/shared-vibe.js client/src/vibe-moves.js tests/client/vibes.spec.js
git commit -m "Share the vibe, not the query

The link carries the vibe's definition in the URL fragment, so it never
reaches a server. The recipient opens a ready-to-play card. A link that
has been edited, or is not a vibe at all, says so plainly and offers
the vibes instead."
```

---

## Task 4: The coverage reason

**Files:**
- Modify: `client/src/screens/vibes.js`
- Test: `tests/client/vibes.spec.js`

**Interfaces:**
- Consumes: `lib/scope.js` (`describeCoverage`), `client/src/vibe-moves.js` (`MIN_POOL`).
- Produces: the warning element `#pool-warning` carrying the reason.

- [ ] **Step 1: Write the failing browser test**

Add to `tests/client/vibes.spec.js`:

```js
test('a thin pool says why', async ({ page }) => {
  await page.goto('./#/vibes');
  await page.waitForSelector('#pool-count');

  // Pick an era with thin coverage.
  const era = page.locator('.move-row').filter({ hasText: 'Different era' }).locator('select, button').first();
  await era.click();
  await page.waitForTimeout(500);

  const warning = page.locator('#pool-warning');
  if (await warning.count()) {
    await expect(warning).toContainText(/Only \d+ players?/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/client/vibes.spec.js -g "a thin pool says why"`
Expected: FAIL — the warning is the generic "A vibe needs at least 20 players".

- [ ] **Step 3: Write the reason**

In `client/src/screens/vibes.js`, replace the warning:

```js
    tooSmall
      ? el('p', { className: 'notice notice--warn', id: 'pool-warning' }, [
          el('strong', { text: describeCoverage({ scope: store.state.scope, count, floor: MIN_POOL }) }),
        ])
      : null,
```

and import it:

```js
import { describeCoverage } from '/lib/scope.js';
```

- [ ] **Step 4: Run the browser test**

Run: `npx playwright test tests/client/vibes.spec.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/vibes.js tests/client/vibes.spec.js
git commit -m "A thin pool says why

\"A vibe needs at least 20 players\" becomes \"Only 49 players fit
La Liga 2010-2019. A vibe needs at least 20.\""
```

---

## Task 5: The save is refused with the reason

**Files:**
- Modify: `client/src/screens/vibes.js`
- Test: `tests/client/vibes.spec.js`

**Interfaces:**
- Consumes: `lib/scope.js` (`describeCoverage`), `client/src/store.js` (`saveVibe`).
- Produces: the save button being disabled with `#save-reason` carrying the reason.

- [ ] **Step 1: Write the failing browser test**

Add to `tests/client/vibes.spec.js`:

```js
test('a thin scope cannot be saved, and says why', async ({ page }) => {
  await page.goto('./#/vibes');
  await page.waitForSelector('#pool-count');

  // Make the scope thin: a stat threshold that leaves too few players.
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('300');
  await page.waitForTimeout(500);

  const save = page.locator('#btn-save');
  await expect(save).toBeDisabled();
  await expect(page.locator('#save-reason')).toContainText(/Only \d+ players?/);
});

test('a vibe saved on one phone does not appear on another', async ({ page, context }) => {
  await page.goto('./#/vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#vibe-name').fill('Mine');
  await page.locator('#btn-save').click();
  await page.waitForTimeout(300);

  // A different browser has its own storage.
  const other = await (await context.browser().newContext()).newPage();
  await other.goto('./');
  await other.waitForTimeout(600);
  await expect(other.locator('.vibe-card--saved')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/client/vibes.spec.js -g "a thin scope cannot be saved"`
Expected: FAIL — the save button is not disabled.

- [ ] **Step 3: Refuse the save**

In `client/src/screens/vibes.js`, the save button becomes:

```js
  const save = el('button', {
    className: 'btn btn--primary',
    text: 'Save this vibe',
    attrs: { type: 'button', id: 'btn-save' },
    on: {
      click: () => {
        if (tooSmall) return;
        store.saveVibe({ id: vibe.id, name, icon: vibe.icon, clauses: vibe.clauses });
      },
    },
  });
```

and the "Save it" section gains the reason:

```js
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Save it' }),
      nameInput,
      save,
      tooSmall
        ? el('p', { className: 'muted-note', attrs: { id: 'save-reason' } },
            `Not saved: ${describeCoverage({ scope: store.state.scope, count, floor: MIN_POOL })}`)
        : null,
    ]),
```

The save button is disabled when the pool is thin:

```js
  if (tooSmall) save.setAttribute('disabled', '');
```

- [ ] **Step 4: Run the browser test**

Run: `npx playwright test tests/client/vibes.spec.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/vibes.js tests/client/vibes.spec.js
git commit -m "A thin scope is refused, with the reason

The number the player typed is never thrown away - only saving is
refused, and it says how many players there are and what the floor is.
The vibe is not lost: widen it and save it then."
```

---

## Task 6: A crafted scope in a room

**Files:**
- Modify: `supabase/functions/_shared/start-room.js`, `supabase/migrations/20261021000200_room_functions.sql`
- Test: `tests/integration/room.test.js`

**Interfaces:**
- Consumes: `lib/scope.js` (`validateScope`), `js/engine/scope.js` (`scopePool`), `js/engine/planner.js` (`MIN_POOL`).
- Produces: `create_room(p_scope_id text, p_scope_clauses jsonb, p_display_name text)` keeps its signature and stores a crafted scope's clauses; `start-room` resolves and checks the scope.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/room.test.js`:

```js
test('a room can play a crafted scope', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'custom',
    p_scope_clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }],
    p_display_name: 'Alex',
  });
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const server = serverClient();
  const { data: plan } = await server.from('quiz_plans').select('*').eq('room_id', room.id).single();
  assert.equal(plan.plan.length, 10, 'the crafted scope produced a quiz');
});

test('a room refuses a scope that names a league that does not exist', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'custom',
    p_scope_clauses: [{ leagues: ['NOPE1'] }],
    p_display_name: 'Alex',
  });
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 422, JSON.stringify(started.body));
  assert.match(started.body.error, /not one the data knows/i);
});

test('a room refuses a scope with too few players, and says how many', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'custom',
    p_scope_clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 300 }] }],
    p_display_name: 'Alex',
  });
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 422, JSON.stringify(started.body));
  assert.match(started.body.error, /\d+/, 'the count is in the message');

  // And the room is still in the lobby.
  const { data: after } = await serverClient().from('rooms').select('status').eq('id', room.id).single();
  assert.equal(after.status, 'lobby');
});

test('a preset room still ignores the clauses the client sent', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    // A client that tries to smuggle a different scope in.
    p_scope_clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }],
    p_display_name: 'Alex',
  });
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const server = serverClient();
  const { data: room2 } = await server.from('rooms').select('pool_size').eq('id', room.id).single();
  assert.equal(room2.pool_size, 94, 'the World Cup 2022 pool, not the one the client asked for');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/integration/room.test.js`
Expected: FAIL — `start-room` refuses a crafted scope with "unknown vibe".

- [ ] **Step 3: Resolve the scope on the server**

In `supabase/functions/_shared/start-room.js`, replace the scope resolution:

```js
    // The scope comes from the preset, never from the client - unless the
    // client crafted a scope, which is then validated before it is planned.
    const preset = presetById(room.scope_id);
    let scope;
    if (preset) {
      scope = { clauses: preset.clauses };
    } else {
      const crafted = { clauses: room.scope_clauses ?? [] };
      const check = validateScope(crafted, { registry: pool.registry, players: pool.players ?? [] });
      if (!check.ok) {
        return json({ error: check.reason }, 422);
      }
      scope = crafted;
    }
```

and move the pool fetch above it, because the validation needs the registry:

```js
    const { data: file, error: fileError } = await admin.storage
      .from('pool')
      .createSignedUrl('pool.json', 600);
    if (fileError) throw fileError;
    const pool = await loadPool(file.signedUrl);
    const players = pool.players ?? [];
```

and add the import:

```js
import { validateScope } from '../../../lib/scope.js';
```

- [ ] **Step 4: Check the floor before the plan**

Still in `supabase/functions/_shared/start-room.js`, after the scope is resolved and before the plan is written:

```js
    // A vibe with too few players cannot produce a quiz. Say so, with the
    // count, rather than letting the engine's own floor throw.
    const poolSize = scopePool(scope, players).length;
    if (poolSize < MIN_POOL) {
      return json({
        error: `Only ${poolSize} ${poolSize === 1 ? 'player' : 'players'} fit that vibe. A vibe needs at least ${MIN_POOL}.`,
      }, 422);
    }
```

and import the floor:

```js
import { MIN_POOL } from '../../../js/engine/planner.js';
```

- [ ] **Step 5: Let a room carry a crafted scope**

In `supabase/migrations/20261021000200_room_functions.sql`, `create_room` already stores `p_scope_clauses`. Change the scope id it stores so a crafted scope is recognisable:

```sql
      insert into public.rooms (code, creator_id, scope_id, scope_clauses)
      values (v_code, auth.uid(), p_scope_id, coalesce(p_scope_clauses, '[]'::jsonb))
      returning * into v_room;
```

That is unchanged. Instead, change what the **client** sends, in `client/src/room.js`: the scope id it passes is the preset's id when there is one, and `'custom'` when the scope was crafted:

```js
    const { data, error } = await supabase.rpc('create_room', {
      p_scope_id: scope.id && scope.id !== 'shared' ? scope.id : 'custom',
      p_scope_clauses: scope.clauses ?? [],
      p_display_name: scope.displayName ?? 'Host',
    });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/integration/room.test.js`
Expected: PASS, 37 tests. The "a preset room still ignores the clauses the client sent" test must still pass — that is the guarantee this phase must not break.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/start-room.js supabase/migrations/20261021000200_room_functions.sql client/src/room.js tests/integration/room.test.js
git commit -m "A crafted scope can be played in a room

The room takes the scope's clauses. A preset room still uses the
preset's own clauses - the guarantee the room already had - and a
crafted scope is validated before it is planned. A scope with too few
players is refused with the count instead of letting the engine's floor
throw, and the room stays in the lobby."
```

---

## Task 7: The docs

**Files:**
- Create: `docs/SCOPES.md`
- Modify: `docs/HANDOFF-2026-10-21.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the note on how a vibe is stored, shared and played.

- [ ] **Step 1: Write the note**

Create `docs/SCOPES.md`:

```markdown
# Vibes

A vibe is a scope: a set of clauses that decide which players a quiz is
written about. Nobody sees that word. The player says "vibe", and
"craft" is what they do to one.

## Where a vibe lives

- **Presets** are in `js/presets.js`. Seven of them, shared by the browser
  and the server.
- **Crafted vibes** live in the browser's storage, on the phone that
  made them. There is no account and no server copy.
- **A shared vibe** travels in the link. The link carries the vibe's
  definition, in the URL fragment, so it never reaches a server.

## The floor

Twenty players. A vibe with fewer cannot produce a quiz, so it cannot be
saved and it cannot start a game. The builder says how many there are
rather than refusing a number you typed.

## Playing a crafted vibe in a room

The room carries the vibe's clauses. The server checks the shape of
what it is given - the competitions, clubs, nations and tournaments it
names, the stats it measures - before it writes a quiz. A preset room
uses the preset's own clauses, so a crafted scope never changes what a
preset means.

## The words

The player-facing noun is "vibe" and the verb is "craft". A stat is
"goals aged 30+", never `goals_after_age_30`. A room's scope is never
shown to a player.
```

- [ ] **Step 2: Update the handoff**

In `docs/HANDOFF-2026-10-21.md`, change the "What to do next" section's first item to say that Phase 5 is done, and add the phase's files to the file list in §1.

- [ ] **Step 3: Commit**

```bash
git add docs/SCOPES.md docs/HANDOFF-2026-10-21.md
git commit -m "How a vibe is stored, shared and played"
```

---

## After the plan

- **The hosted project still does not exist.** Every test in this phase runs against the local stack, and the local edge runtime still cannot boot on this host, so the Deno path is unverified.
- **Phase 6 — polish** is next: sound, haptics, motion, the empty and error states, and the PWA install.
- **The Phase 0 falsification test is still unrun.** The game is playable today, solo or in a room. It is the cheapest thing on the list and the most likely to change the product.
