# v1.2 Rematch, Stat Rounds, and Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.2: three stat-value rounds per ten, host rematch in the same room, and the three known reliability fixes.

**Architecture:** The planner places a seeded quota of stat slots, then fills each slot from the matching recipe group with the existing identity fallback. The room stores the same mix through `start-room`. Rematch is a host-only SQL function that deletes the game and returns the room to its lobby; the client follows the status change and restarts its poll. Reliability changes are local to the functions runner, `hasSteal`, and the render boundary.

**Tech Stack:** Plain ES modules, Node's test runner, Supabase Postgres + Edge Functions, Playwright, no build step.

**Spec:** `docs/superpowers/specs/2026-10-28-rematch-and-stat-rounds-design.md`

## Global Constraints

- No new dependencies.
- No schema change beyond `public.reset_room(uuid)`; no new tables, columns, indexes, policies, or realtime publications.
- `statRounds` defaults to `0` and is clamped to `0..rounds`. An omitted argument keeps today's identity-only plan.
- Stat recipes stay behind `phases: ['v1.1']`.
- Stat rounds use the existing four-option UI and unit-labelled options. No numeric input, no free text.
- The server stays authoritative: the plan and answer key never reach a player, and the client never scores a room answer.
- Rematch keeps the room row, code, scope, difficulty, members, `is_host`, and `joined_seq`.
- Rematch deletes rounds, answers, round secrets, effects, and the quiz plan; zeroes `total_score`, `correct_count`, `total_response_ms`; sets `status = 'lobby'`, `current_round = 0`, `finished_at = null`.
- Rematch does not auto-start. The host uses the normal Start button.
- The client remains build-free; `npm run publish` copies files to `dist/`.
- Commit after every task. Do not squash tasks together.
- `client/src/config.js` must point at the hosted project at commit time. Local test runs write the local values with `npm run supabase:sync`; restore the hosted values before committing or deploying.
- The two known base Playwright failures are excluded from gates: `a player who refreshes mid-round keeps their score` and `the home screen can create a room`. They are not regressions.

## Test Environment

The local stack is required for integration and Playwright work.

```bash
npm run supabase:start          # once per machine
npm run supabase:reset          # applies every migration; clears the Storage pool
npm run supabase:upload         # puts the player pool back
npm run supabase:serve          # leave running in another terminal
npm run supabase:sync           # writes the local Supabase values into client/src/config.js
```

`npm run supabase:serve` copies the engine into `supabase/functions/_shared/vendor/` and starts the functions runner on `http://127.0.0.1:54399`. Restart it after changing `js/engine/` or `supabase/functions/` so the runner serves the new code.

Before a commit that includes `client/src/config.js`, restore the hosted values:

```bash
set -a
. ./.env.local
set +a
npm run supabase:sync
git diff --exit-code client/src/config.js
```

If `.env.local` is unavailable, `git checkout -- client/src/config.js` restores the committed hosted values.

## File Structure

| File | Responsibility |
|---|---|
| `js/engine/planner.js` | Place the stat quota, fill each slot from its recipe group, keep the identity fallback. |
| `js/engine/index.js` | Forward `phases` and `statRounds` through `generateQuiz`. |
| `client/src/store.js` | Solo games ask for the v1.2 mix. |
| `supabase/functions/_shared/start-room.js` | Room games ask for the same mix. |
| `supabase/migrations/20261028000100_rematch.sql` | Add host-only, final-only `reset_room`. |
| `client/src/room.js` | Add `rematch()`, restart polling after a lobby, map rematch errors. |
| `client/src/room-state.js` | Clear the last game when a room returns to its lobby, and when round one of a new game arrives. |
| `client/src/screens/results.js` | Host-only Play again button, guest waiting note, lobby redirect. |
| `client/src/screens/reveal.js` | Redirect to the lobby after a rematch. |
| `client/src/screens/round.js` | Redirect to the lobby after a rematch. |
| `supabase/functions/_shared/effects.js` | Fail-closed `hasSteal`. |
| `supabase/functions/_shared/submit-answer.js` | Import `hasSteal` instead of defining it. |
| `client/src/main.js` | Defer store-driven renders while a primary pointer is down. |
| `scripts/serve-functions.js` | Lowercase CORS headers plus the two Supabase headers. |
| `tests/engine/planner.test.js` | Quota, slot determinism, fallback, stat adjacency. |
| `tests/engine/integration.test.js` | `generateQuiz` forwards the mix; stat round scoring. |
| `tests/client/client.spec.js` | Solo mix, relaxed prompt assertion. |
| `tests/integration/stat-rounds.test.js` | Room mix, unit-labelled options, `round_result.unit`, stat-round steal. |
| `tests/integration/rematch.test.js` | `reset_room` permissions, cleanup, and fresh start. |
| `tests/shared/room-state.test.js` | Rematch state clearing. |
| `tests/shared/effects.test.js` | Fail-closed `hasSteal`. |
| `tests/shared/cors.test.js` | Local runner header shape. |
| `tests/client/helpers.js` | One-round room helper for rematch tests. |
| `tests/client/room.spec.js` | Stat round UI, rematch flow, pointer race. |
| `docs/DEPLOY.md` | Post-deploy rematch and stat checks. |

## Review Focus

1. A stat slot whose scope has no stat recipe must fall back to identity and keep the quiz at its requested length, not truncate it. Task 1 test: `a pool without stat data falls back to identity`.
2. A rematch while a guest is on the reveal must clear the old answer/result and move the guest to the lobby, not leave the last game on screen. Task 5 tests: the three `applyRound` tests plus the Playwright rematch test.
3. A press held across a two-second sync must still answer; the click must not be lost when the button is replaced. Task 7 test: `a press that spans a room redraw still answers`.
4. A `room_effects` query error must refuse the answer rather than let a thief answer. Task 6 test: `a failed check fails closed`.
5. A rematch must delete effects and zero the scores so the next game starts clean. Task 4 integration test and Task 5 Playwright rematch test.

---

### Task 1: Planner Stat Quota

**Files:**
- Modify: `js/engine/planner.js:1-87`
- Modify: `js/engine/index.js:17-19`
- Test: `tests/engine/planner.test.js`
- Test: `tests/engine/integration.test.js`

**Interfaces:**
- Consumes: `makeRng`, `shuffle`, `recipesFor`, `candidateSubjects`, `composeRound`.
- Produces: `planQuiz({ ..., phases, statRounds })`; `generateQuiz({ ..., phases, statRounds })`. `statRounds` is an integer defaulting to `0`, clamped to `0..rounds`.

- [ ] **Step 1: Write the failing planner tests**

In `tests/engine/planner.test.js`, add the World Cup scope beside the existing `scope`:

```js
const wcScope = {
  v: 2, name: 'World Cup 2022',
  clauses: [{ tournaments: ['wc-2022'] }],
};
```

Replace the whole `test('no metric repeats consecutively', ...)` block with:

```js
test('a stat metric does not repeat consecutively when another stat recipe exists', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({
    scope: wcScope,
    pool: players,
    registry,
    seed: 1,
    rounds: 10,
    phases: ['v1.1'],
    statRounds: 3,
  });
  const stats = plan.rounds.map((r, i) => ({ i, template: r.template, metric: r.metric }));
  assert.equal(stats.filter((r) => r.template === 'stat_value').length, 3);
  for (let i = 1; i < stats.length; i++) {
    const a = stats[i - 1];
    const b = stats[i];
    if (a.template !== 'stat_value' || b.template !== 'stat_value') continue;
    assert.notEqual(a.metric, b.metric,
      `stat metric repeated at rounds ${i} and ${i + 1}`);
  }
});
```

Add the quota tests after it:

```js
test('a ten-round v1.2 quiz has three stat rounds and seven identity rounds', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({
    scope, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  const templates = plan.rounds.map((r) => r.template);
  assert.equal(templates.filter((t) => t === 'stat_value').length, 3);
  assert.equal(templates.filter((t) => t === 'identify').length, 7);
});

test('the same seed puts the stat rounds in the same places', () => {
  const { players, registry } = loadFixture();
  const make = (seed) => planQuiz({
    scope, pool: players, registry, seed, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  assert.deepEqual(
    make(1).rounds.map((r) => r.template),
    make(1).rounds.map((r) => r.template),
  );
});

test('a different seed can move the stat rounds', () => {
  const { players, registry } = loadFixture();
  const places = (seed) => planQuiz({
    scope, pool: players, registry, seed, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  }).rounds.map((r, i) => (r.template === 'stat_value' ? i : -1)).filter((i) => i >= 0);
  assert.notDeepEqual(places(1), places(2));
});

test('statRounds 0 keeps the v1 identity-only quiz', () => {
  const { players, registry } = loadFixture();
  const plan = planQuiz({
    scope, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 0,
  });
  assert.ok(plan.rounds.every((r) => r.template === 'identify'));
});

test('a pool without stat data falls back to identity', () => {
  const { players, registry } = loadFixture();
  const late = {
    v: 2, name: 'Late Bloomers',
    clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 50 }] }],
  };
  const plan = planQuiz({
    scope: late, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  assert.equal(plan.rounds.length, 10);
  assert.ok(plan.rounds.every((r) => r.template === 'identify'));
});
```

In `tests/engine/integration.test.js`, replace the `answering a stat round scores correctly` test with:

```js
test('generateQuiz forwards the stat mix', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({
    scope, pool: players, registry, seed: 1, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  assert.equal(plan.rounds.filter((r) => r.template === 'stat_value').length, 3);
  assert.equal(plan.rounds.filter((r) => r.template === 'identify').length, 7);
});

test('answering a stat round scores correctly', () => {
  const { players, registry } = loadFixture();
  const plan = generateQuiz({
    scope, pool: players, registry, seed: 3, rounds: 10,
    phases: ['v1.1'], statRounds: 3,
  });
  const statRound = plan.rounds.find((r) => r.template === 'stat_value');
  assert.ok(statRound, 'the mix contains a stat round');
  assert.equal(statRound.options.length, 4);
  assert.equal(statRound.options.filter((o) => o.correct).length, 1);
  assert.ok(statRound.unit, 'the stat round carries a unit');
  const correct = statRound.options.find((o) => o.correct);
  const res = answerRound(statRound, { answer: correct.value, stage: 1, elapsedMs: 1500 });
  assert.equal(res.correct, true);
  assert.equal(res.points, 7500);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/engine/planner.test.js tests/engine/integration.test.js`

Expected: FAIL. The quota tests see ten `identify` rounds and zero `stat_value` rounds because `statRounds` is ignored.

- [ ] **Step 3: Implement the planner quota**

In `js/engine/planner.js`, change the import line to:

```js
import { makeRng, shuffle } from './rng.js';
```

Replace the whole `planQuiz` function with:

```js
export function planQuiz({ scope, pool, registry, seed = 1, rounds = 10, difficulty = 'medium', phases = [], statRounds = 0 }) {
  const rng = makeRng(seed);
  const players = scopePool(scope, pool);

  if (players.length < MIN_POOL) {
    throw new Error(`scope resolves to ${players.length} players, below the floor of ${MIN_POOL}`);
  }

  const window = resolveWindow(scope, registry);
  const recipes = recipesFor({ template: null, window, pool: players, phases });
  if (recipes.length === 0) {
    throw new Error('no question recipe is available for this scope');
  }

  // The stat rounds are placed before anything is composed, so the mix is
  // a property of the plan and not of what happened to be available late.
  const statCount = Math.max(0, Math.min(rounds, Math.trunc(Number(statRounds) || 0)));
  const statSlots = statCount === 0
    ? new Set()
    : new Set(shuffle(rng, Array.from({ length: rounds }, (_, i) => i)).slice(0, statCount));

  const usedSubjects = new Set();
  const plan = [];

  for (let i = 0; i < rounds; i++) {
    const depth = DIFFICULTY_DEPTH[difficulty] ?? 2;
    const wanted = statSlots.has(i) ? 'stat_value' : 'identify';
    const preferred = recipes.filter((r) => r.template === wanted);
    const groups = wanted === 'stat_value'
      ? [preferred, recipes.filter((r) => r.template !== 'stat_value')]
      : [preferred];

    let candidates = [];
    for (const group of groups) {
      candidates = [];
      for (const recipe of group) {
        // No metric repeats consecutively - but only when there is another
        // recipe in this group to pick instead. A group with one recipe
        // must still fill the slot.
        if (group.length > 1 && plan.length && plan[plan.length - 1].metric === recipe.metric) continue;
        const cands = candidateSubjects({ scope, pool: players, registry, window, metric: recipe.metric });
        for (const c of cands) {
          // No subject repeats.
          if (usedSubjects.has(c.subject.id)) continue;
          // candidateSubjects already filters out subjects the metric has no
          // value for, so composeRound cannot throw on this pair.
          candidates.push({ ...c, recipe });
        }
      }
      if (candidates.length > 0) break;
    }

    if (candidates.length === 0) break;

    const chosen = candidates[Math.floor(rng() * candidates.length)];

    // The difficulty curve: early rounds reveal fewer stages, later rounds
    // dig deeper. Depth never decreases, so reveal depth never goes backwards.
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
  }

  const families = new Set(plan.map(r => r.family));
  let hardest = { index: 1, depth: 0 };
  for (const [i, r] of plan.entries()) {
    if (r.clues.length > hardest.depth) hardest = { index: i + 1, depth: r.clues.length };
  }
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

In `js/engine/index.js`, replace `generateQuiz` with:

```js
export function generateQuiz({ scope, pool, registry, seed = 1, rounds = 10, difficulty = 'medium', phases = [], statRounds = 0 }) {
  return planQuiz({ scope, pool, registry, seed, rounds, difficulty, phases, statRounds });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/planner.test.js tests/engine/integration.test.js`

Expected: PASS. The quota tests see three stat and seven identity rounds; the Late Bloomers plan stays at ten identity rounds.

- [ ] **Step 5: Commit**

```bash
git add js/engine/planner.js js/engine/index.js tests/engine/planner.test.js tests/engine/integration.test.js
git commit -m "feat(engine): mix three stat rounds into a ten-round quiz"
```

---

### Task 2: Solo Mix

**Files:**
- Modify: `client/src/store.js:204-221`
- Test: `tests/client/client.spec.js:80-90, 160-180`

**Interfaces:**
- Consumes: `planQuiz` with `phases` and `statRounds` from Task 1.
- Produces: a solo quiz with exactly three `stat_value` rounds and seven `identify` rounds on a scope that supports them.

- [ ] **Step 1: Write the failing Playwright test**

In `tests/client/client.spec.js`, change the exact prompt assertion in the clue test:

```js
  await expect(page.locator('.round-prompt')).toHaveText(/Who is this\?|How many /);
```

In `a whole quiz plays through to the results`, after the `.results-cta` assertion, add:

```js
  await expect(page.locator('.card').filter({ hasText: 'Your quiz' }))
    .toContainText('different kinds of question');
```

Add this test after `the answer buttons are not rebuilt while the round ticks`:

```js
test('a solo quiz mixes three stat rounds into ten', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);
  const templates = await page.evaluate(async () => {
    const { store } = await import('/client/src/store.js');
    return store.state.quiz.rounds.map((round) => round.template);
  });
  expect(templates.filter((t) => t === 'stat_value')).toHaveLength(3);
  expect(templates.filter((t) => t === 'identify')).toHaveLength(7);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test client.spec.js --grep "a solo quiz mixes three stat rounds into ten"`

Expected: FAIL. The quiz has ten `identify` rounds and zero `stat_value` rounds.

- [ ] **Step 3: Pass the mix from the solo store**

In `client/src/store.js`, replace the `planQuiz` call in `startQuiz` with:

```js
    const quiz = planQuiz({
      scope,
      pool: pool.players,
      registry: pool.registry,
      seed,
      rounds: 10,
      difficulty: 'medium',
      phases: ['v1.1'],
      statRounds: 3,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test client.spec.js --grep "a solo quiz mixes three stat rounds into ten"`

Expected: PASS.

Then run the clue test that was relaxed:

Run: `npx playwright test client.spec.js --grep "the round screen shows the clues"`

Expected: PASS for either an identity or a stat first round.

- [ ] **Step 5: Commit**

```bash
git add client/src/store.js tests/client/client.spec.js
git commit -m "feat(client): play the v1.2 mix in solo games"
```

---

### Task 3: Room Mix and Stat-Round Steal

**Files:**
- Modify: `supabase/functions/_shared/start-room.js:132-141`
- Test: `tests/integration/stat-rounds.test.js` (new)

**Interfaces:**
- Consumes: `planQuiz` with `phases` and `statRounds` from Task 1; `start-room` returns the first projected round.
- Produces: every started room plans three stat rounds per ten (clamped to the room's `total_rounds`), and a steal on a stat round copies the numeric answer and half the points.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/stat-rounds.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A started one-round room. The planner clamps the mix to one stat round. */
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

test('a ten-round room plan has three stat rounds and seven identity rounds', { skip }, async () => {
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
  assert.equal(templates.filter((t) => t === 'stat_value').length, 3);
  assert.equal(templates.filter((t) => t === 'identify').length, 7);
});

test('a one-round room starts on a stat round with unit-labelled options', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  assert.equal(round.template, 'stat_value');
  assert.match(round.prompt, /^How many /);
  assert.equal(round.options.length, 4);
  for (const option of round.options) {
    assert.match(option.label, /^\d[\d,]*\s+\w+$/, `"${option.label}" has no unit`);
  }

  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();
  assert.ok(secret.unit, 'the answer key carries the unit');

  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
  }, guest.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.correct, true);

  // The host has no answer of their own, so move the deadline back rather
  // than waiting twenty seconds for the round to close.
  await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', round.id);
  await host.client.rpc('current_round', { p_room_id: room.id });

  const result = await guest.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.data.unit, secret.unit);
  assert.equal(String(result.data.answer), String(secret.answer_value));
});

test('a steal on a stat round copies the numeric answer and half the points', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();

  const steal = await host.client.rpc('use_room_effect', {
    p_room_id: room.id,
    p_round_number: 1,
    p_kind: 'steal',
    p_target_user_id: guest.userId,
  });
  assert.equal(steal.error, null, steal.error?.message);

  // The victim can still bet on the thief's copied answer.
  const bet = await guest.client.rpc('use_room_effect', {
    p_room_id: room.id,
    p_round_number: 1,
    p_kind: 'side_bet',
    p_target_user_id: host.userId,
  });
  assert.equal(bet.error, null, bet.error?.message);

  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
  }, guest.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.correct, true);
  const guestPoints = answer.body.points;

  // The thief's placeholder answer means the victim's answer closes the
  // round without waiting for the deadline.
  const closed = await host.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(closed.error, null, closed.error?.message);

  const { data: answers } = await server.from('answers')
    .select('*').eq('room_id', room.id);
  const thief = answers.find((a) => a.user_id === host.userId);
  const victim = answers.find((a) => a.user_id === guest.userId);
  assert.equal(thief.guessed_answer, String(secret.answer_value));
  assert.equal(thief.is_correct, true);
  assert.equal(thief.points_earned, Math.floor(guestPoints / 2));
  assert.equal(victim.points_earned, guestPoints);

  // The side bet pays because the thief's copied answer is correct.
  const { data: effects } = await server.from('room_effects')
    .select('*').eq('room_id', room.id);
  const sideBet = effects.find((e) => e.kind === 'side_bet' && e.actor_id === guest.userId);
  assert.equal(sideBet.bonus_points, 500);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/integration/stat-rounds.test.js`

Expected: FAIL. The ten-round plan has zero `stat_value` rounds, and the one-round room starts on an identity round.

- [ ] **Step 3: Pass the mix from the room function**

In `supabase/functions/_shared/start-room.js`, replace the `planQuiz` call with:

```js
      const quiz = planQuiz({
        scope,
        pool: players,
        registry: pool.registry,
        seed,
        rounds: room.total_rounds,
        difficulty: room.difficulty,
        phases: ['v1.1'],
        statRounds: 3,
      });
```

Restart the functions runner so it copies the new engine:

```bash
npm run supabase:serve
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/integration/stat-rounds.test.js`

Expected: PASS. The ten-round room has three stat and seven identity rounds; the one-round room starts on a stat round; the thief copies the numeric answer and earns half the victim's points.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/start-room.js tests/integration/stat-rounds.test.js
git commit -m "feat(room): plan the v1.2 mix and cover stat-round steals"
```

---

### Task 4: Host-Only Rematch Function

**Files:**
- Create: `supabase/migrations/20261028000100_rematch.sql`
- Test: `tests/integration/rematch.test.js` (new)

**Interfaces:**
- Consumes: `rooms`, `room_memberships`, `quiz_plans`, `rounds`, `answers`, `round_secrets`, `room_effects`.
- Produces: `public.reset_room(p_room_id uuid) returns jsonb`, host-only, final-only, returning `{ "ok": true }`.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/rematch.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A final one-round room with scores, an effect, and a stored plan. */
async function finalRoom() {
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

  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', started.body.id).single();
  for (const player of [host, guest]) {
    const res = await callFunction('submit-answer', {
      room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
    }, player.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  // An effect belongs to the game too; the reset must cascade it away.
  const { error: effectError } = await server.from('room_effects').insert({
    room_id: room.id,
    round_id: started.body.id,
    actor_id: host.userId,
    target_id: guest.userId,
    kind: 'side_bet',
  });
  assert.equal(effectError, null, effectError?.message);

  await host.client.rpc('current_round', { p_room_id: room.id });
  const { data: final } = await server.from('rooms').select('*').eq('id', room.id).single();
  assert.equal(final.status, 'final');

  const { data: scored } = await server.from('room_memberships')
    .select('*').eq('room_id', room.id);
  assert.ok(scored.some((m) => m.total_score > 0), 'the game has scores to clear');

  return { room, host, guest, server, roundId: started.body.id };
}

test('the host resets a final room to the lobby and clears the game', { skip }, async () => {
  const { room, host, guest, server, roundId } = await finalRoom();

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);
  assert.deepEqual(reset.data, { ok: true });

  const { data: after } = await server.from('rooms').select('*').eq('id', room.id).single();
  assert.equal(after.status, 'lobby');
  assert.equal(after.current_round, 0);
  assert.equal(after.finished_at, null);

  for (const table of ['rounds', 'answers', 'quiz_plans']) {
    const { data } = await server.from(table).select('*').eq('room_id', room.id);
    assert.equal(data.length, 0, `${table} is empty after a rematch`);
  }
  const { data: secrets } = await server.from('round_secrets')
    .select('*').eq('round_id', roundId);
  assert.equal(secrets.length, 0, 'the answer key is gone');
  const { data: effects } = await server.from('room_effects')
    .select('*').eq('room_id', room.id);
  assert.equal(effects.length, 0, 'the effects are gone');

  const { data: members } = await server.from('room_memberships')
    .select('*').eq('room_id', room.id).order('joined_seq');
  assert.equal(members.length, 2, 'the players stay');
  assert.equal(members[0].is_host, true);
  assert.equal(members[1].is_host, false);
  for (const m of members) {
    assert.equal(m.total_score, 0);
    assert.equal(m.correct_count, 0);
    assert.equal(m.total_response_ms, 0);
  }

  // The next start is a fresh game in the same room.
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.notEqual(started.body.id, roundId);
  const { data: rounds } = await server.from('rounds').select('*').eq('room_id', room.id);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round_number, 1);
  const { data: plan } = await server.from('quiz_plans')
    .select('*').eq('room_id', room.id).single();
  assert.ok(plan.seed, 'a new plan was written');
});

test('only the host can reset, and only a final room', { skip }, async () => {
  const { room, host, guest } = await finalRoom();

  const byGuest = await guest.client.rpc('reset_room', { p_room_id: room.id });
  assert.ok(byGuest.error, 'a guest cannot reset');
  assert.match(byGuest.error.message, /only the host/);

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);

  const again = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.ok(again.error, 'a lobby is not a finished game');
  assert.match(again.error.message, /not finished/);
});

test('a running room cannot be reset', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();
  await server.from('rooms').update({ total_rounds: 1 }).eq('id', room.id);
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.ok(reset.error, 'a running game cannot be reset');
  assert.match(reset.error.message, /not finished/);
});

test('the new host can reset after the old host leaves', { skip }, async () => {
  const { room, host, guest } = await finalRoom();

  const left = await host.client.rpc('leave_room', { p_room_id: room.id });
  assert.equal(left.error, null, left.error?.message);

  const { data: members } = await guest.client
    .from('room_memberships').select('*').eq('room_id', room.id);
  const hosts = members.filter((m) => m.is_host);
  assert.equal(hosts.length, 1, 'exactly one host');
  assert.equal(hosts[0].user_id, guest.userId, 'the host role moved to the remaining player');

  const reset = await guest.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);
});

test('a host alone can reset a final room', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();
  await server.from('rooms').update({ total_rounds: 1 }).eq('id', room.id);
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', started.body.id).single();
  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
  }, host.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  await host.client.rpc('current_round', { p_room_id: room.id });

  const { data: final } = await server.from('rooms').select('status').eq('id', room.id).single();
  assert.equal(final.status, 'final');
  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/integration/rematch.test.js`

Expected: FAIL with `function public.reset_room(uuid) does not exist`.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20261028000100_rematch.sql`:

```sql
-- A rematch: the host returns a finished room to its lobby.
--
-- The room row, its code, its members and their join order stay. The game
-- itself - plan, rounds, answers, secrets and effects - is deleted, and the
-- scores go back to zero. The next start-room writes a fresh quiz with a
-- new seed.

create or replace function public.reset_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_is_host boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'no such room' using errcode = 'P0002';
  end if;

  select m.is_host into v_is_host
  from public.room_memberships m
  where m.room_id = p_room_id and m.user_id = auth.uid();

  if not coalesce(v_is_host, false) then
    raise exception 'only the host can start a rematch' using errcode = '42501';
  end if;

  if v_room.status <> 'final' then
    raise exception 'the game is not finished' using errcode = '22023';
  end if;

  delete from public.quiz_plans where room_id = p_room_id;
  delete from public.rounds where room_id = p_room_id;

  update public.room_memberships
  set total_score = 0,
      correct_count = 0,
      total_response_ms = 0
  where room_id = p_room_id;

  update public.rooms
  set status = 'lobby',
      current_round = 0,
      finished_at = null
  where id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;
```

Apply it to the local stack:

```bash
npm run supabase:reset
npm run supabase:upload
npm run supabase:serve
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/integration/rematch.test.js`

Expected: PASS. The host resets, the game rows are gone, the scores are zero, the members stay, and the next start writes a new plan. The guest and a running room are refused.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028000100_rematch.sql tests/integration/rematch.test.js
git commit -m "feat(room): add a host-only rematch reset"
```

---

### Task 5: Client Rematch Flow

**Files:**
- Modify: `client/src/room-state.js:8-34`
- Modify: `client/src/room.js:122-165, 336-351, 438-459`
- Modify: `client/src/screens/results.js:1-136`
- Modify: `client/src/screens/reveal.js:193-200`
- Modify: `client/src/screens/round.js:41-56`
- Test: `tests/shared/room-state.test.js`
- Test: `tests/client/helpers.js`
- Test: `tests/client/room.spec.js`

**Interfaces:**
- Consumes: `reset_room` from Task 4; the room mix from Task 3.
- Produces: `room.rematch(): Promise<boolean>`; `#btn-rematch` for the host; `#rematch-waiting` for guests; a lobby redirect from results, reveal, and round.

- [ ] **Step 1: Write the failing state and Playwright tests**

In `tests/shared/room-state.test.js`, add:

```js
test('a rematch clears the last game when the room returns to the lobby', () => {
  const state = {
    status: 'final',
    round: null,
    currentRound: 1,
    totalRounds: 1,
    myAnswer: { points: 100 },
    answeredRound: 1,
    lastResult: { round_number: 1 },
    fetchingResult: true,
    myEffects: [{ kind: 'steal' }],
    lastResultAskedAt: 5,
  };
  applyRound(state, { status: 'lobby', current_round: 0, total_rounds: 1, round: null });
  assert.equal(state.status, 'lobby');
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.lastResult, null);
  assert.equal(state.fetchingResult, false);
  assert.deepEqual(state.myEffects, []);
  assert.equal(state.lastResultAskedAt, null);
});

test('a rematch clears a game the player never saw finish', () => {
  const state = {
    status: 'round_active',
    round: { id: 'old', round_number: 1 },
    myAnswer: { points: 100 },
    answeredRound: 1,
    lastResult: { round_number: 1 },
    myEffects: [{ kind: 'steal' }],
  };
  applyRound(state, { status: 'lobby', current_round: 0, round: null });
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.lastResult, null);
  assert.deepEqual(state.myEffects, []);
});

test('round one of a new game clears the last game even when the number repeats', () => {
  const state = {
    round: { id: 'old', round_number: 1 },
    myAnswer: { points: 100 },
    answeredRound: 1,
    lastResult: { round_number: 1, answer: 'old game' },
  };
  applyRound(state, { status: 'round_active', round: { id: 'new', round_number: 1 } });
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.lastResult, null);
});
```

In `tests/client/helpers.js`, import the integration server client and add:

```js
import { serverClient } from '../integration/helpers.js';

/** A two-player room whose next game is one round long. */
export async function roomWithOneRound(browser) {
  const made = await roomWithTwoPlayers(browser);
  const server = serverClient();
  const { error } = await server.from('rooms')
    .update({ total_rounds: 1 }).eq('code', made.code);
  if (error) throw error;
  return made;
}
```

In `tests/client/room.spec.js`, import the helper:

```js
import { roomWithTwoPlayers, roomWithOneRound } from './helpers.js';
```

Add this test at the end of the file:

```js
test('the host rematches in the same room and the guest follows', async ({ browser }) => {
  const { host, guest, code } = await roomWithOneRound(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  // A one-round room clamps the mix to one round, and that round is stat.
  await expect(host.locator('.round-prompt')).toContainText(/How many /);
  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);

  // The round closes, and the reveal shows the value with its unit.
  await expect(guest.locator('#btn-next')).toContainText('See how it went', { timeout: 30000 });
  await expect(host.locator('.reveal-card__name')).toContainText(/\d+ (goal|goals|cap|caps)/);

  // The guest sees the waiting note on the results screen.
  await guest.locator('#btn-next').click();
  await expect(guest).toHaveURL(/#results/);
  await expect(guest.locator('#rematch-waiting')).toContainText('Waiting for the host to start again.');
  await expect(guest.locator('#btn-rematch')).toHaveCount(0);

  // The host goes to the results and sees the button.
  await expect(host.locator('#btn-next')).toContainText('See how it went', { timeout: 30000 });
  await host.locator('#btn-next').click();
  await expect(host).toHaveURL(/#results/);
  await expect(host.locator('#btn-rematch')).toBeVisible();

  // Put the guest back on the reveal, where a stale result is most likely
  // to strand them. The reset must pull them to the lobby.
  await guest.evaluate(() => { location.hash = '#reveal'; });
  await expect(guest).toHaveURL(/#reveal/);
  await host.locator('#btn-rematch').click();
  await expect(host).toHaveURL(/#room-lobby/);
  await expect(guest).toHaveURL(/#room-lobby/);
  await expect(host.locator('#room-code')).toHaveText(code);

  // A fresh game in the same room, with zero scores and effects available.
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);
  await expect(host.locator('.round-meta')).toContainText('Round 1 of 1');
  await expect(host.locator('#btn-steal')).toBeVisible();
  await expect(guest.locator('#btn-steal')).toBeVisible();
  const score = await host.evaluate(async () => {
    const { room } = await import('/client/src/room.js');
    return room.state.leaderboard.find((m) => m.user_id === room.state.me)?.total_score ?? null;
  });
  expect(score).toBe(0);

  expect([...hostErrors, ...guestErrors]).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/shared/room-state.test.js`

Expected: FAIL. `applyRound` leaves `myAnswer`, `answeredRound`, `lastResult`, and `myEffects` in place when a lobby payload arrives.

Run: `npx playwright test room.spec.js --grep "the host rematches in the same room"`

Expected: FAIL. `#btn-rematch` does not exist.

- [ ] **Step 3: Implement the client rematch flow**

In `client/src/room-state.js`, replace `applyRound` with:

```js
/** Fold the server's current-round payload into the room state. */
export function applyRound(state, payload) {
  const next = payload?.round ?? null;
  const nextStatus = payload?.status ?? state.status ?? 'lobby';

  // A lobby has no game in it. A rematch returns the room here, and a
  // player who was offline for the reset may still be carrying the last
  // game's answer, result or effects. None of it belongs to the lobby.
  if (!next && nextStatus === 'lobby') {
    state.myAnswer = null;
    state.answeredRound = null;
    state.lastResult = null;
    state.lastResultAskedAt = null;
    state.fetchingResult = false;
    state.myEffects = [];
  }

  // A new round means the last answer is spent: the player has to be
  // able to answer again, and the reveal has to ask about the round that
  // just closed, not the one that just opened. A rematch can reuse round
  // number one, so the round id is the reliable identity when both sides
  // have one.
  const sameRound = next && state.round
    ? (next.id && state.round.id
      ? next.id === state.round.id
      : next.round_number === state.round.round_number)
    : null;

  if (next && state.round && !sameRound) {
    // The reveal may have just fetched the result for the round that is
    // being closed. Keep it: the round change is the same poll that
    // closes the round, and wiping it would show a blank reveal. The
    // old answeredRound is read first because it is nulled below.
    // A new game starts at round one; no result from the last game can
    // belong to it, even if the old game also ended on round one.
    const revealing = state.answeredRound;
    const keep = next.round_number === 1
      ? null
      : (state.lastResult?.round_number === revealing ? state.lastResult : null);
    state.myAnswer = null;
    state.answeredRound = null;
    state.lastResult = keep;
    state.fetchingResult = false;
  }

  state.round = next;
  state.currentRound = payload?.current_round ?? 0;
  state.totalRounds = payload?.total_rounds ?? state.totalRounds ?? 10;
  state.status = nextStatus;
  state.answeredCount = payload?.answered_count ?? 0;
  return state;
}
```

In `client/src/room.js`, replace the final-status line in `sync` with:

```js
  // The poll is also the heartbeat: the server marks a member offline
  // after thirty seconds without one, so it runs for as long as the
  // player is in the room. A final room stops it; a rematch returning to
  // the lobby starts it again, even for a client that missed the realtime
  // update.
  if (data.status === 'final') stopPolling();
  else if (data.status === 'lobby' && !pollTimer) startPolling();
```

Add `rematch` after `start`:

```js
  /** Return the finished room to its lobby for a fresh game. */
  async rematch() {
    const supabase = await ensure();
    if (!supabase || !state.roomId) return false;
    state.error = null;
    const { data, error } = await supabase.rpc('reset_room', { p_room_id: state.roomId });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return false;
    }
    await sync();
    notify();
    return data?.ok === true;
  },
```

Add the rematch messages to `friendly` before the generic return:

```js
  if (m.includes('only the host')) return 'Only the host can start a rematch.';
  if (m.includes('not finished')) return 'That game has not finished yet.';
```

In `client/src/screens/results.js`, add the room import:

```js
import { room } from '../room.js';
```

Replace `renderRoom` with:

```js
/** The final leaderboard of a room. */
function renderRoom(root, roomState) {
  // A rematch happened while this client was on the results screen.
  if (roomState.status === 'lobby') {
    location.hash = '#room-lobby';
    return;
  }

  const board = roomState.leaderboard ?? [];
  const me = board.find((m) => m.user_id === roomState.me);
  const score = me?.total_score ?? 0;
  const isHost = roomState.members.some((m) => m.user_id === roomState.me && m.is_host);

  const rematch = isHost
    ? el('button', {
      className: 'btn btn--primary results-cta',
      text: 'Play again',
      attrs: { type: 'button', id: 'btn-rematch' },
      on: {
        click: async () => {
          rematch.disabled = true;
          rematch.textContent = 'Resetting…';
          const ok = await room.rematch();
          if (!ok) {
            rematch.disabled = false;
            rematch.textContent = 'Play again';
          }
        },
      },
    })
    : el('p', {
      className: 'muted-note',
      attrs: { id: 'rematch-waiting' },
      text: 'Waiting for the host to start again.',
    });

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '⚽ Football Trivia', attrs: { href: '#home' } }),
    ]),

    el('section', { className: 'results-hero' }, [
      el('p', { className: 'results-hero__label', text: 'FINAL SCORE' }),
      el('p', { className: 'results-hero__score', text: pointsLabel(score), attrs: { id: 'final-score' } }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'The room' }),
      ...board.map((m, i) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: `${i + 1}. ${labelFor(roomState, m.user_id)}` }),
        el('span', { className: 'rank-row__points', text: pointsLabel(m.total_score) }),
      ])),
      el('p', { className: 'muted-note', text: 'A fresh quiz is written every time you play.' }),
    ]),

    roomState.error
      ? el('p', { className: 'notice notice--warn', attrs: { id: 'room-error' }, text: roomState.error })
      : null,
    rematch,
    el('a', {
      className: 'btn',
      text: 'Craft your own vibe',
      attrs: { href: '#vibes' },
    }),
  ].filter(Boolean));
}
```

In `client/src/screens/reveal.js`, add the lobby guard at the start of `renderRoom`:

```js
function renderRoom(root, roomState) {
  // A rematch returned the room to its lobby. There is no round to reveal.
  if (roomState.status === 'lobby' && !roomState.round) {
    location.hash = '#room-lobby';
    return;
  }

  const answeredRound = roomState.answeredRound;
```

In `client/src/screens/round.js`, add the lobby guard after `roomState` is read:

```js
  // A rematch returns the room to its lobby; the round screen has nothing
  // to show.
  if (store.state.mode === 'room' && roomState?.status === 'lobby' && !roomState.round) {
    location.hash = '#room-lobby';
    return;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/shared/room-state.test.js`

Expected: PASS.

Run: `npx playwright test room.spec.js --grep "the host rematches in the same room"`

Expected: PASS. The host resets, both players land in the lobby, the same code is shown, and the next game starts with zero scores and effect buttons available.

- [ ] **Step 5: Commit**

```bash
git add client/src/room-state.js client/src/room.js client/src/screens/results.js client/src/screens/reveal.js client/src/screens/round.js tests/shared/room-state.test.js tests/client/helpers.js tests/client/room.spec.js
git commit -m "feat(room): let the host rematch in the same room"
```

---

### Task 6: Fail-Closed Steal Guard

**Files:**
- Create: `supabase/functions/_shared/effects.js`
- Modify: `supabase/functions/_shared/submit-answer.js:13-22, 85, 133`
- Test: `tests/shared/effects.test.js` (new)

**Interfaces:**
- Consumes: a Supabase admin client with `.from().select().eq().eq().eq().maybeSingle()`.
- Produces: `hasSteal(admin, roundId, userId): Promise<boolean>`, returning `true` when the query errors.

- [ ] **Step 1: Write the failing unit test**

Create `tests/shared/effects.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSteal } from '../../supabase/functions/_shared/effects.js';

function adminReturning(result) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return chain;
}

test('a steal row means the caller is copying', async () => {
  const admin = adminReturning({ data: { id: 'effect-1' }, error: null });
  assert.equal(await hasSteal(admin, 'round-1', 'user-1'), true);
});

test('no steal row means the caller answers for themselves', async () => {
  const admin = adminReturning({ data: null, error: null });
  assert.equal(await hasSteal(admin, 'round-1', 'user-1'), false);
});

test('a failed check fails closed', async () => {
  const admin = adminReturning({ data: null, error: { message: 'connection reset' } });
  assert.equal(await hasSteal(admin, 'round-1', 'user-1'), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/shared/effects.test.js`

Expected: FAIL with `Cannot find module .../supabase/functions/_shared/effects.js`.

- [ ] **Step 3: Add the module and use it**

Create `supabase/functions/_shared/effects.js`:

```js
/**
 * Whether this player is copying somebody in this round.
 *
 * Fail closed: if the check cannot run, assume a steal exists. Letting the
 * player answer would score a round they are not playing, and the answer
 * would be theirs, not the target's.
 */
export async function hasSteal(admin, roundId, userId) {
  const { data, error } = await admin
    .from('room_effects')
    .select('id')
    .eq('round_id', roundId)
    .eq('actor_id', userId)
    .eq('kind', 'steal')
    .maybeSingle();
  if (error) return true;
  return Boolean(data);
}
```

In `supabase/functions/_shared/submit-answer.js`, add the import:

```js
import { hasSteal } from './effects.js';
```

Delete the local `hasSteal` function. The two call sites stay as they are:

```js
    if (await hasSteal(admin, round.id, userId)) {
      return json({ error: 'you are copying a player this round' }, 409);
    }
```

and:

```js
        if (await hasSteal(admin, round.id, userId)) {
          return json({ error: 'you are copying a player this round' }, 409);
        }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/shared/effects.test.js`

Expected: PASS. A row is `true`, no row is `false`, and an error is `true`.

Restart the functions runner and run the effects integration suite:

```bash
npm run supabase:serve
node --test tests/integration/effects.test.js
```

Expected: PASS. The existing steal behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/effects.js supabase/functions/_shared/submit-answer.js tests/shared/effects.test.js
git commit -m "fix(room): fail closed when the steal check cannot run"
```

---

### Task 7: Pointer-Aware Render Guard

**Files:**
- Modify: `client/src/main.js:30-108`
- Test: `tests/client/room.spec.js`

**Interfaces:**
- Consumes: the existing `render()` entry point and `store.subscribe(render)`.
- Produces: store-driven renders deferred while a primary pointer is down, coalesced into one render flushed after `pointerup`/`pointercancel`.

- [ ] **Step 1: Write the failing Playwright test**

In `tests/client/room.spec.js`, add at the end:

```js
test('a press that spans a room redraw still answers', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  const box = await host.locator('.option').first().boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();

  // A poll lands while the finger is still down. It notifies every
  // subscriber, which is exactly what used to replace the button.
  await host.evaluate(async () => {
    const { room } = await import('/client/src/room.js');
    await room.sync();
  });

  await host.mouse.up();
  await expect(host).toHaveURL(/#reveal/);

  const answered = await host.evaluate(async () => {
    const { room } = await import('/client/src/room.js');
    return room.state.answeredRound;
  });
  expect(answered).toBe(1);
  expect([...hostErrors, ...guestErrors]).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test room.spec.js --grep "a press that spans a room redraw still answers"`

Expected: FAIL. The sync rebuilds the round screen while the pointer is down; the button under the pointer is replaced, so `mouse.up()` fires no click and the URL stays `#round`.

- [ ] **Step 3: Defer renders while the pointer is down**

In `client/src/main.js`, replace the block that starts at `let rendering = false;` with:

```js
let rendering = false;
let lastHash = null;
// A press can span a two-second room sync. Rebuilding the screen while
// the pointer is down replaces the button under the finger, and the
// browser never fires the click. Defer store-driven renders until the
// press is over.
let pointerDown = false;
let pendingRender = false;
```

Rename the existing `export function render()` to `function renderNow()`:

```js
function renderNow() {
  if (rendering) return;
  rendering = true;
  try {
```

Keep the whole existing body and its `finally` block unchanged.

After `renderNow`, add:

```js
export function render() {
  if (pointerDown) {
    pendingRender = true;
    return;
  }
  renderNow();
}

function releasePointer() {
  pointerDown = false;
  if (!pendingRender) return;
  pendingRender = false;
  // The click for this press is dispatched after pointerup. A zero-delay
  // task lets that click run against the live element first.
  setTimeout(render, 0);
}

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  pointerDown = true;
}, true);

window.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  releasePointer();
}, true);

window.addEventListener('pointercancel', releasePointer, true);
```

Replace the bottom wiring with:

```js
window.addEventListener('hashchange', renderNow);
store.subscribe(render);

// Mount the current hash immediately (synchronously) so the screen is on
// paint even before the async pool load resolves; store notifications
// re-render afterwards, guarded against re-entrancy.
render();
store.init().then(render).catch(() => render());
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test room.spec.js --grep "a press that spans a room redraw still answers"`

Expected: PASS. The answer is registered after the press, and the URL moves to `#reveal`.

- [ ] **Step 5: Commit**

```bash
git add client/src/main.js tests/client/room.spec.js
git commit -m "fix(client): keep a press alive across a room redraw"
```

---

### Task 8: Local CORS Patch

**Files:**
- Modify: `scripts/serve-functions.js:43-49`
- Test: `tests/shared/cors.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: one lowercase set of CORS headers on the local functions runner, including `x-client-info` and `x-supabase-api-version`.

- [ ] **Step 1: Write the failing test**

In `tests/shared/cors.test.js`, add the `fs` import at the top:

```js
import fs from 'node:fs';
```

Add:

```js
test('the local runner sends one set of lowercase CORS headers', () => {
  const source = fs.readFileSync(
    new URL('../../scripts/serve-functions.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /'access-control-allow-origin'/);
  assert.match(
    source,
    /'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version'/,
  );
  assert.doesNotMatch(source, /'Access-Control-Allow-Origin'/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/shared/cors.test.js`

Expected: FAIL. The runner still uses mixed-case keys and lacks the two Supabase headers.

- [ ] **Step 3: Apply the saved patch**

In `scripts/serve-functions.js`, replace the comment and `CORS` block with:

```js
// The hosted project's gateway adds these. The local runner has to do
// the same, or the browser refuses the call. Lowercase, because the
// handler's Response headers come back from the Headers iterator
// lowercased - a mixed-case twin of the same header would reach the wire
// twice and the browser would refuse the call.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};
```

- [ ] **Step 4: Run the test and the syntax check**

Run: `node --test tests/shared/cors.test.js`

Expected: PASS.

Run: `node --check scripts/serve-functions.js`

Expected: no output, exit code 0.

Restart the runner and run the room suite to prove the browser accepts the calls:

```bash
npm run supabase:serve
npx playwright test room.spec.js --grep "the round screen shows the server round to everyone"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/serve-functions.js tests/shared/cors.test.js
git commit -m "fix(dev): send one set of CORS headers from the local runner"
```

---

### Task 9: Deploy Notes and Full Gate

**Files:**
- Modify: `docs/DEPLOY.md:148-156`
- Test: the whole suite.

**Interfaces:**
- Consumes: every task above.
- Produces: a documented post-deploy check list and a green gate.

- [ ] **Step 1: Add the post-deploy checks**

In `docs/DEPLOY.md`, add to the `## 3. What to check after it is live` list:

```md
- [ ] A room reaches a stat round, the options carry their units, and the reveal shows the value with its unit.
- [ ] The host rematches after the final, round 1 of the new game starts in the same room, and the room code is unchanged.
- [ ] A steal still copies the target's answer and pays half their points.
```

- [ ] **Step 2: Run the full unit and integration suite**

Restart the functions runner so it serves the final code:

```bash
npm run supabase:serve
npm test
```

Expected: all tests pass. Integration tests run because the local stack is up; the one known skip is the suite that skips when the stack is down. If a test fails, fix it in the task that owns the code, then re-run this command.

- [ ] **Step 3: Run the Playwright suite, excluding the two known base failures**

```bash
npx playwright test --grep-invert "a player who refreshes mid-round keeps their score|the home screen can create a room"
```

Expected: all remaining tests pass, including the stat-round, rematch, and pointer-race tests. The two excluded tests are known base failures and are not v1.2 regressions.

- [ ] **Step 4: Restore the hosted client config and commit the docs**

```bash
set -a
. ./.env.local
set +a
npm run supabase:sync
git diff --exit-code client/src/config.js
git add docs/DEPLOY.md
git commit -m "docs: add the v1.2 live checks"
```

If `git diff --exit-code client/src/config.js` reports a difference, do not commit it. Restore the hosted file with `git checkout -- client/src/config.js` and re-run the check.

- [ ] **Step 5: Final branch check**

```bash
git status --short
git log --oneline -10
```

Expected: a clean working tree, and one commit per task above.

---

### Task 10: Deploy and Live Check

**Files:**
- No source changes. This task applies the migration, deploys the functions, publishes the client, and verifies the live game.

**Interfaces:**
- Consumes: the merged v1.2 branch and `.env.local`.
- Produces: the hosted project running v1.2.

- [ ] **Step 1: Merge and push**

After the branch review passes, merge the work to `main` and push:

```bash
git checkout main
git pull --ff-only
git merge --no-ff v1-2-rematch-stat-rounds
git push origin main
```

Expected: Vercel starts a deploy from `main`.

- [ ] **Step 2: Apply the hosted migration and functions**

```bash
set -a
. ./.env.local
set +a
npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" --yes
npx supabase db push --password "$SUPABASE_DB_PASSWORD" --yes
npm run supabase:deploy
```

Expected: `20261028000100_rematch.sql` is applied, and `start-room`, `submit-answer`, and `pool-count` are deployed. The pool does not change; do not re-upload it.

- [ ] **Step 3: Confirm the client points at the hosted project and is live**

```bash
npm run supabase:sync
git diff --exit-code client/src/config.js
npm run publish
```

Expected: `client/src/config.js` still points at `https://rexwrapjdqikblkdohnl.supabase.co`, and `dist/` is regenerated. Vercel serves it after the push. If `npm run supabase:sync` changed the file, commit the corrected config and push again.

- [ ] **Step 4: Live check with two browsers**

Open `https://football-trivia-xi.vercel.app/` in two browsers and check:

1. Create a room, join with the code, and start.
2. Play until a stat round appears. The prompt starts with "How many", the four options carry units, and the reveal shows the value with its unit.
3. Finish the game. The host sees `Play again`; the guest sees "Waiting for the host to start again."
4. The host taps `Play again`. Both players land in the lobby with the same code and zero scores.
5. The host starts. Round 1 of the new game is on screen, and both effect buttons are available.
6. Use a steal on any round. The victim sees the warning, the thief copies the answer, and the reveal pays half the target's points.
7. Check both consoles for errors. Expected: none.

- [ ] **Step 5: Record the result**

Report the live checks and the commit range in the final message. No commit is needed for this task.
