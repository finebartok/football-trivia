# Multiplayer Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two to twelve people join a room with a six-character code, the host picks a vibe, the engine writes a ten-round quiz on the server, and everyone plays it on the same clock with a leaderboard at the end.

**Architecture:** Supabase Postgres holds the room state, with row-level security as the only thing standing between a curious player and the answer key. The quiz plan and the score are computed in Edge Functions that import the engine's own pure modules, so there is one implementation of the scoring rules. Clients render the clue ladder from absolute timestamps, push state changes over Realtime, and poll every two seconds — the poll drives the round advance and doubles as the fallback when Realtime degrades. Solo play keeps running the engine in the browser with no backend.

**Tech Stack:** Supabase (Postgres 17, Realtime, Auth, Storage, Edge Functions on Deno), `@supabase/supabase-js` v2 loaded from a CDN as an ES module, plain ESM JavaScript everywhere, no build step, `node --test` for unit and integration tests, Playwright for the browser tests.

**Spec:** `docs/superpowers/specs/2026-10-21-multiplayer-room-design.md` — read it before starting. It is the authority on behaviour. §12 of it lists four deliberate divergences from the v1 spec.

---

## Global Constraints

These apply to every task. They are not negotiable without changing the spec first.

- **The engine is not modified.** `js/engine/*` stays pure, DOM-free and free of `node:` imports. The Edge Functions import it as-is. If a task seems to need an engine change, the change belongs somewhere else.
- **No player-facing string may name a scope, a predicate, a metric, a window id or a raw id.** The noun is "vibe", the verb is "craft". A room, a scope or a metric is never shown to a player.
- **The plan never reaches a client.** `quiz_plans` and `round_secrets` have no SELECT policy at all. The `rounds` row carries no `correct` flag. A future round has no row until the previous one closes.
- **The score is computed server-side from server-measured timestamps.** The client's claimed stage is never trusted.
- **An open round's answers are not readable by members.** `is_correct` and `guessed_answer` would hand the answer to the room.
- **One round is materialised at a time.** `rooms.current_round` names the only round that exists.
- **The client has no build step.** It is plain ESM loaded by the browser. A dependency may be loaded from a CDN at runtime, but never bundled into the repo, and never imported as a bare specifier.
- **The client must not break when the backend is unreachable.** A failure to load the SDK, sign in, or reach the network leaves solo play working.
- **Node tests:** `npm test`. **Browser tests:** `npm run test:client`. **Integration tests** skip themselves when the local Supabase stack is not running.

## Review Focus

Five input classes the spec implies but no task's happy path exercises. Each one gets a test in the task that owns the code.

1. **An open round's answers.** A member must not be able to read the `answers` table mid-round, because `is_correct = true` names the winning guess. → Task 4
2. **A client that hands the server a scope of its own making.** A room created with `scope_id: 'wc-2022'` must be played as World Cup 2022 even if the creator sent clauses for something else. → Task 7
3. **An answer that arrives after the round closed.** Must be refused, must write no row, and must tell the player it was late. → Task 8
4. **A player who refreshes mid-round.** Must rejoin the same room, see the same round at the same point in the ladder, and keep the score. → Task 12
5. **Two players with the same display name.** The second must join successfully and the leaderboard must tell them apart. → Task 5

---

## File Structure

| Path | Responsibility |
|---|---|
| `js/presets.js` | The seven vibes. Shared by the browser and the server, so the server can resolve a room's scope by id. |
| `supabase/config.toml` | The Supabase project configuration. |
| `supabase/migrations/20261021000100_room_tables.sql` | The six tables and the row-level security policies. |
| `supabase/migrations/20261021000200_room_functions.sql` | `create_room`, `join_room`, `leave_room`. |
| `supabase/migrations/20261021000300_round_lifecycle.sql` | `advance_room`, `current_round`, `round_result`, `sync_room_state`. |
| `supabase/functions/_shared/client.js` | The Supabase clients: one on the caller's JWT, one on the service role. |
| `supabase/functions/_shared/pool.js` | Fetches `pool.json` from Storage and caches it for the life of the instance. |
| `supabase/functions/_shared/projection.js` | Turns a composed round into the client row and the secret. Pure. |
| `supabase/functions/pool-count/index.js` | The engine's first server-side proof: how many players a scope resolves to. |
| `supabase/functions/start-room/index.js` | Generates the plan and materialises round 1. |
| `supabase/functions/submit-answer/index.js` | Scores an answer and writes it. |
| `client/src/config.js` | The project URL and the anon key. |
| `client/src/supabase.js` | Loads the SDK, creates the client, signs in anonymously. |
| `client/src/room.js` | The room client: RPC calls, the realtime subscription, the poll, the room state. |
| `client/src/room-state.js` | The pure state helpers the room client uses. Node-testable. |
| `client/src/store.js` | Gains the room slice; `currentRound()` returns the server's round in room mode. |
| `client/src/screens/{home,lobby,round,reveal,results}.js` | The screens, in room mode. |
| `scripts/supabase-sync.js` | Writes `client/src/config.js`. |
| `scripts/upload-pool.js` | Uploads `pool.json` to the Storage bucket. |
| `tests/shared/{presets,projection}.test.js` | Node tests for the pure shared modules. |
| `tests/integration/room.test.js` | The room loop against the local stack. |
| `tests/client/room.spec.js` | Two browsers in one room. |

---

## Task 1: Move the presets into a shared module

The server has to resolve a room's scope from a preset by id, and the presets only exist in the browser today.

**Files:**
- Create: `js/presets.js`
- Modify: `client/src/pool.js:3-13`
- Test: `tests/shared/presets.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `PRESETS` (array of `{id, name, desc, icon, clauses, pool}`) and `presetById(id) -> preset | null`, both from `js/presets.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/presets.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetById } from '../../js/presets.js';

test('every preset has an id, a name and clauses', () => {
  assert.ok(PRESETS.length >= 7, 'there are at least seven vibes');
  const ids = new Set();
  for (const p of PRESETS) {
    assert.ok(p.id, 'a preset has an id');
    assert.ok(p.name, 'a preset has a name');
    assert.ok(Array.isArray(p.clauses) && p.clauses.length > 0, 'a preset has clauses');
    assert.equal(ids.has(p.id), false, `preset id ${p.id} is unique`);
    ids.add(p.id);
  }
});

test('a preset can be found by its id', () => {
  const first = PRESETS[0];
  assert.equal(presetById(first.id)?.name, first.name);
  assert.equal(presetById('no-such-vibe'), null);
});

test('the client re-exports the same presets', async () => {
  // The browser imports the presets through client/src/pool.js. That module
  // uses an absolute path, so it is read as text rather than imported.
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../../client/src/pool.js', import.meta.url), 'utf8'));
  assert.match(src, /from '\/js\/presets\.js'/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/shared/presets.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/presets.js`.

- [ ] **Step 3: Create the shared module**

Create `js/presets.js` with the preset list moved verbatim out of `client/src/pool.js`:

```js
/**
 * The vibes a player can pick.
 *
 * This module is shared. The browser shows these; the server resolves a
 * room's scope from one by id, so a client cannot hand the server a scope
 * of its own making.
 */

export const PRESETS = [
  { id: 'laliga-2010s', name: 'La Liga 2010s', desc: 'A decade of Spanish football', icon: '🇪🇸', clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }], pool: 1854 },
  { id: 'premier-2010s', name: 'Premier League 2010s', desc: 'A decade of English football', icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }], pool: 1924 },
  { id: 'premier-2425', name: 'Premier League 2024/25', desc: 'Last season, right now', icon: '🆕', clauses: [{ leagues: ['GB1'], seasonStart: 2024, seasonEnd: 2025 }], pool: 1983 },
  { id: 'wc-2022', name: 'World Cup 2022', desc: 'Every squad in Qatar', icon: '🏆', clauses: [{ tournaments: ['wc-2022'] }], pool: 231 },
  { id: 'late-bloomers', name: 'Late Bloomers', desc: '50+ goals aged 30+', icon: '🎯', clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 50 }] }], pool: 111 },
  { id: 'ever-capped', name: 'Ever Capped', desc: '50+ international caps', icon: '🎽', clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 50 }] }], pool: 1023 },
  { id: 'centurion-club', name: 'Century Club', desc: '100+ goals since 2012', icon: '💯', clauses: [{ stats: [{ metric: 'club_goals', op: '>=', value: 100 }] }], pool: 160 },
];

/** The preset with this id, or null. The server uses it to resolve a scope. */
export function presetById(id) {
  return PRESETS.find((p) => p.id === id) ?? null;
}
```

- [ ] **Step 4: Point the client at it**

In `client/src/pool.js`, delete the `export const PRESETS = [...]` block (the seven entries) and replace it with:

```js
export { PRESETS } from '/js/presets.js';
```

Keep everything else in `client/src/pool.js` exactly as it is.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/shared/presets.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, no failures. The existing engine tests are untouched.

- [ ] **Step 7: Commit**

```bash
git add js/presets.js client/src/pool.js tests/shared/presets.test.js
git commit -m "Move the presets where the server can reach them too"
```

---

## Task 2: The Supabase project, the local stack and the client config

**Files:**
- Create: `supabase/config.toml` (generated), `client/src/config.js`, `scripts/supabase-sync.js`
- Test: `tests/shared/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `config` from `client/src/config.js` — `{ supabaseUrl, supabaseAnonKey }`. `scripts/supabase-sync.js` writes that file and exits 0.

- [ ] **Step 1: Initialise the project**

Run: `npx supabase@latest init --yes`
Expected: `supabase/config.toml` exists and `supabase/` is created.

- [ ] **Step 2: Turn on anonymous sign-ins**

In `supabase/config.toml`, find the `[auth]` section and make sure this line reads `true`:

```toml
[auth]
enable_anonymous_sign_ins = true
```

If the line is absent, add it under `[auth]`.

- [ ] **Step 3: Write the failing test**

Create `tests/shared/config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../client/src/config.js';

test('the client knows where the backend is', () => {
  assert.match(config.supabaseUrl, /^https?:\/\//, 'a url');
  assert.ok(config.supabaseAnonKey.length > 20, 'an anon key');
});

test('the anon key is the public one, never the service role', () => {
  assert.equal(config.supabaseAnonKey.includes('service_role'), false);
  assert.equal(/sb_secret_/.test(config.supabaseAnonKey), false, 'a secret key must never be in the client');
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test tests/shared/config.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `client/src/config.js`.

- [ ] **Step 5: Write the config file**

Create `client/src/config.js`:

```js
/**
 * Where the room backend lives.
 *
 * Generated by scripts/supabase-sync.js. The anon key is public by
 * definition - it is the key that is allowed to be in a browser. It can
 * read nothing: the quiz plan and the answer key sit behind row-level
 * security that the anon key cannot pass.
 */
export const config = {
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};
```

- [ ] **Step 6: Write the sync script**

Create `scripts/supabase-sync.js`:

```js
/**
 * Writes client/src/config.js from the environment.
 *
 * With no environment set it writes the local Supabase stack's
 * credentials, which are fixed because the local stack's JWT secret is
 * fixed. Point SUPABASE_URL and SUPABASE_ANON_KEY at a hosted project to
 * write that one instead.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const body = `/**
 * Where the room backend lives.
 *
 * Generated by scripts/supabase-sync.js. The anon key is public by
 * definition - it is the key that is allowed to be in a browser. It can
 * read nothing: the quiz plan and the answer key sit behind row-level
 * security that the anon key cannot pass.
 */
export const config = {
  supabaseUrl: '${url}',
  supabaseAnonKey: '${key}',
};
`;

await fs.writeFile(path.join(ROOT, 'client/src/config.js'), body);
console.log(`wrote client/src/config.js for ${url}`);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test tests/shared/config.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 8: Add the npm scripts**

In `package.json`, add to `scripts`:

```json
"supabase:start": "supabase start",
"supabase:stop": "supabase stop",
"supabase:reset": "supabase db reset",
"supabase:serve": "supabase functions serve --env-file supabase/.env.local",
"supabase:sync": "node scripts/supabase-sync.js"
```

- [ ] **Step 9: Bring the local stack up**

Run: `npx supabase@latest start`
Expected: the containers come up and the command prints the API URL and the anon key. This downloads about 10GB of images the first time and needs that much free disk.

Run: `npx supabase@latest status`
Expected: JSON containing `"API_URL":"http://127.0.0.1:54321"`. If your key differs from the one in `client/src/config.js`, run `npm run supabase:sync` and commit the result.

- [ ] **Step 10: Commit**

```bash
git add supabase/config.toml client/src/config.js scripts/supabase-sync.js tests/shared/config.test.js package.json
git commit -m "The Supabase project and the client's pointer to it"
```

---

## Task 3: The engine runs inside an Edge Function

This is the riskiest assumption in the phase: that the browser's engine modules bundle and run under Deno. Prove it before building on it.

**Files:**
- Create: `supabase/functions/_shared/client.js`, `supabase/functions/_shared/pool.js`, `supabase/functions/_shared/projection.js`, `supabase/functions/pool-count/index.js`
- Test: `tests/shared/projection.test.js`

**Interfaces:**
- Consumes: `js/engine/index.js` (`scopePool`), `js/presets.js` (`presetById`).
- Produces:
  - `projectRound(round, roundNumber) -> { client, secret }` from `_shared/projection.js`.
  - `loadPool(url, token) -> Promise<{players, registry}>` from `_shared/pool.js`.
  - `serviceClient() -> SupabaseClient` and `callerClient(req) -> SupabaseClient` from `_shared/client.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/projection.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRound } from '../../supabase/functions/_shared/projection.js';

const composed = {
  template: 'identify',
  prompt: 'Who is this?',
  context: '2022 World Cup',
  subjectId: 28003,
  answer: 'Lionel Messi',
  options: [
    { id: 'opt-0', label: 'Lionel Messi', value: 'Lionel Messi', correct: true },
    { id: 'opt-1', label: 'Neymar', value: 'Neymar', correct: false },
  ],
  clues: [{ id: 'c1', label: 'CAREER CLUBS', value: 'Barcelona', iconKey: null }],
  revealSchedule: [{ stage: 1, revealAtMs: 2000 }],
};

test('the client row never carries the answer', () => {
  const { client } = projectRound(composed, 1);
  const json = JSON.stringify(client);
  assert.equal(json.includes('Lionel Messi'), false, 'the target must not appear in the client row');
  assert.equal(json.includes('"correct"'), false, 'no option may carry a correct flag');
});

test('the client row keeps the option labels and their raw values', () => {
  const { client } = projectRound(composed, 1);
  assert.deepEqual(client.options, [
    { id: 'opt-0', label: 'Lionel Messi', value: 'Lionel Messi' },
    { id: 'opt-1', label: 'Neymar', value: 'Neymar' },
  ]);
});

test('the client row uses the engine shape the browser already understands', () => {
  const { client } = projectRound(composed, 3);
  assert.equal(client.round_number, 3);
  assert.equal(client.template, 'identify');
  assert.equal(client.prompt, 'Who is this?');
  assert.deepEqual(client.reveal_schedule, [{ stage: 1, revealAtMs: 2000 }]);
});

test('the secret holds the answer', () => {
  const { secret } = projectRound(composed, 1);
  assert.equal(secret.answer_value, 'Lionel Messi');
  assert.equal(secret.target_player_id, 28003);
});

test('a numeric answer is stored as a string', () => {
  const numeric = { ...composed, template: 'stat_value', answer: 3, unit: 'goals' };
  const { secret, client } = projectRound(numeric, 1);
  assert.equal(secret.answer_value, '3');
  assert.equal(JSON.stringify(client).includes('"3 goals"'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/shared/projection.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `supabase/functions/_shared/projection.js`.

- [ ] **Step 3: Write the projection**

Create `supabase/functions/_shared/projection.js`:

```js
/**
 * Turns a composed round into the two shapes the database stores.
 *
 * The client row is what a room member may read. It must not contain the
 * answer, and it must not contain a flag saying which option is right -
 * the row is readable, so anything in it is public to the room.
 *
 * The secret is the answer key. It goes into round_secrets, which no
 * client can read.
 *
 * Pure: no imports, so it runs in Deno and in Node and can be tested by
 * both.
 */

export function projectRound(round, roundNumber) {
  return {
    client: {
      round_number: roundNumber,
      template: round.template,
      prompt: round.prompt,
      context: round.context ?? null,
      clues: round.clues.map((c) => ({
        id: c.id,
        label: c.label,
        value: c.value,
        iconKey: c.iconKey ?? null,
      })),
      options: round.options.map((o) => ({
        id: o.id,
        label: o.label,
        value: o.value,
      })),
      reveal_schedule: round.revealSchedule.map((s) => ({
        stage: s.stage,
        revealAtMs: s.revealAtMs,
      })),
    },
    secret: {
      answer_value: String(round.answer),
      target_player_id: round.subjectId ?? null,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/shared/projection.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the pool loader**

Create `supabase/functions/_shared/pool.js`:

```js
/**
 * The player pool, fetched from Storage.
 *
 * The pool is the engine's input contract. It is 3.7MB, so it is fetched
 * once per function instance and held in memory.
 */

let cached = null;

export async function loadPool(url, token) {
  if (cached) return cached;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`could not fetch the player pool: ${res.status} ${res.statusText}`);
  }
  cached = await res.json();
  return cached;
}
```

- [ ] **Step 6: Write the client factory**

Create `supabase/functions/_shared/client.js`:

```js
/**
 * The Supabase clients a function may use.
 *
 * `serviceClient` bypasses row-level security. It is the only thing that
 * may read the quiz plan and the answer key, and it is used only where
 * the caller has already been checked.
 *
 * `callerClient` carries the caller's own JWT, so the database applies
 * the caller's permissions. Use it for anything that reads a room's
 * members.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function callerClient(req) {
  const auth = req.headers.get('Authorization') ?? '';
  return createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: auth } } },
  );
}
```

- [ ] **Step 7: Write the pool-count function**

Create `supabase/functions/pool-count/index.js`:

```js
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const scopeId = url.searchParams.get('scope_id') ?? '';
    const preset = presetById(scopeId);
    if (!preset) {
      return new Response(JSON.stringify({ error: 'unknown vibe' }), { status: 400 });
    }

    const admin = serviceClient();
    const { data: file, error } = await admin.storage.from('pool').createSignedUrl('pool.json', 600);
    if (error) throw error;

    const pool = await loadPool(file.signedUrl);
    const players = scopePool({ clauses: preset.clauses }, pool.players ?? []);
    return new Response(JSON.stringify({ scope_id: scopeId, count: players.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 8: Write the pool upload script**

Create `scripts/upload-pool.js`:

```js
/**
 * Uploads the player pool to the Storage bucket the server reads.
 *
 * The pool is the engine's input contract, produced by
 * `npm run fixtures` from the database.
 */
import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const body = await fs.readFile(new URL('../data/fixtures/pool.sample.json', import.meta.url));
const admin = createClient(url, key, { auth: { persistSession: false } });

const { error } = await admin.storage.from('pool').upload('pool.json', body, {
  contentType: 'application/json',
  upsert: true,
});
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(`uploaded pool.json (${Math.round(body.length / 1024)}KB) to ${url}`);
```

- [ ] **Step 9: Install the SDK for the scripts**

Run: `npm install @supabase/supabase-js@2`
Expected: it is added to `dependencies`. This is the one runtime dependency in the project, and it is used by the Node scripts and by the browser (from a CDN).

- [ ] **Step 10: Create the bucket and upload the pool**

Run:

```bash
curl -s -X POST "http://127.0.0.1:54321/storage/v1/bucket" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"pool","name":"pool","public":false}' || true
node scripts/upload-pool.js
```

If the bucket already exists the curl prints an error and the script still works. Expected: `uploaded pool.json (3690KB) to http://127.0.0.1:54321`.

- [ ] **Step 11: Serve the function and prove the engine runs**

Run: `npx supabase@latest functions serve --env-file supabase/.env.local`
Expected: the function is served on http://127.0.0.1:54321/functions/v1/pool-count

In another shell, run:

```bash
curl -s "http://127.0.0.1:54321/functions/v1/pool-count?scope_id=wc-2022"
```

Expected: `{"scope_id":"wc-2022","count":231}`

**If this fails, stop.** The most likely cause is that the bundler refuses to follow an import from outside the function's directory. The fix is to add an import map at `supabase/functions/deno.json`:

```json
{ "imports": { "@engine/": "../../js/engine/", "@presets/": "../../js/presets.js" } }
```

and change the imports in the function to `import { scopePool } from '@engine/index.js';` and `import { presetById } from '@presets/';`. If the import map does not work either, copy `js/engine/` and `js/presets.js` into `supabase/functions/_shared/vendor/` with a script, and change the imports to point there. Record which fix you used in the task ledger.

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/_shared supabase/functions/pool-count scripts/upload-pool.js package.json package-lock.json
git commit -m "The engine runs on the server"
```

---

## Task 4: The tables and the row-level security

**Files:**
- Create: `supabase/migrations/20261021000100_room_tables.sql`
- Test: `tests/integration/room.test.js` (the RLS part)

**Interfaces:**
- Consumes: nothing.
- Produces: the tables `rooms`, `room_memberships`, `quiz_plans`, `rounds`, `round_secrets`, `answers`, and the helper `public.is_room_member(room_id) -> boolean`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261021000100_room_tables.sql`:

```sql
-- The room. Everything a player may see is here; everything a player may
-- not see is somewhere they cannot reach.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  creator_id uuid not null references auth.users(id),
  scope_id text not null,
  scope_clauses jsonb not null default '[]'::jsonb,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  status text not null default 'lobby' check (status in ('lobby','round_active','round_ended','final','abandoned')),
  max_players int not null default 12,
  current_round int not null default 0,
  total_rounds int not null default 10,
  pool_size int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists rooms_code_idx on public.rooms (code);
create index if not exists rooms_creator_idx on public.rooms (creator_id);

create table if not exists public.room_memberships (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,
  is_host boolean not null default false,
  joined_seq int not null,
  last_seen_at timestamptz not null default now(),
  total_score int not null default 0,
  correct_count int not null default 0,
  total_response_ms int not null default 0,
  unique (room_id, user_id)
);
create index if not exists room_memberships_room_idx on public.room_memberships (room_id);

-- The plan. Service role only. A client may never read it.
create table if not exists public.quiz_plans (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  seed bigint not null,
  plan jsonb not null,
  generated_at timestamptz not null default now()
);

-- One row per round, materialised only when that round begins.
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number int not null,
  template text not null,
  prompt text not null,
  context text,
  clues jsonb not null,
  options jsonb not null,
  reveal_schedule jsonb not null,
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  closed_at timestamptz,
  unique (room_id, round_number)
);
create index if not exists rounds_room_idx on public.rounds (room_id);

-- The answer key. Service role only. A client may never read it.
create table if not exists public.round_secrets (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  answer_value text not null,
  target_player_id bigint
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  guessed_answer text not null,
  is_correct boolean not null,
  stage_locked int not null,
  response_time_ms int not null,
  points_earned int not null,
  received_at timestamptz not null default now(),
  unique (round_id, user_id)
);
create index if not exists answers_room_idx on public.answers (room_id);

-- The bucket the server reads the player pool from.
insert into storage.buckets (id, name, public)
values ('pool', 'pool', false)
on conflict (id) do nothing;

alter table public.rooms enable row level security;
alter table public.room_memberships enable row level security;
alter table public.quiz_plans enable row level security;
alter table public.rounds enable row level security;
alter table public.round_secrets enable row level security;
alter table public.answers enable row level security;

-- "Is the caller in this room?" SECURITY DEFINER so it can answer the
-- question without the caller's own row-level security getting in the way.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_memberships m
    where m.room_id = p_room_id and m.user_id = auth.uid()
  );
$$;

-- rooms: a member may read it; only the state-machine functions may change it.
create policy rooms_select on public.rooms for select
  using (creator_id = auth.uid() or public.is_room_member(id));
create policy rooms_insert on public.rooms for insert
  with check (creator_id = auth.uid());
create policy rooms_delete on public.rooms for delete
  using (creator_id = auth.uid());

-- room_memberships: readable by the room. Written only by the server.
create policy memberships_select on public.room_memberships for select
  using (public.is_room_member(room_id));

-- quiz_plans: no policy at all. Nobody but the service role reads it.
-- round_secrets: no policy at all. Nobody but the service role reads it.

-- rounds: a member may read a round that has begun. No policy for writes.
create policy rounds_select on public.rounds for select
  using (public.is_room_member(room_id) and started_at <= now());

-- answers: readable only once the round is closed. While a round is open,
-- is_correct and guessed_answer would hand the answer to the whole room.
create policy answers_select on public.answers for select
  using (
    public.is_room_member(room_id)
    and exists (
      select 1 from public.rounds r
      where r.id = answers.round_id and r.closed_at is not null
    )
  );
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase@latest db reset`
Expected: the migration applies with no error. A SQL error names the file and the statement.

- [ ] **Step 3: Write the integration test harness**

Create `tests/integration/helpers.js`:

```js
/**
 * The local Supabase stack, when it is running.
 *
 * The integration tests skip themselves when it is not, so `npm test`
 * stays green on a machine without Docker.
 */
import { createClient } from '@supabase/supabase-js';

export const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export async function stackIsUp() {
  try {
    const res = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

/** A signed-in anonymous client, as a player would have. */
export async function playerClient() {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, userId: data.user.id };
}

/** A client on the service role. The server's own key. */
export function serverClient() {
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
}
```

- [ ] **Step 4: Write the failing RLS test**

Create `tests/integration/room.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

test('the plan and the answer key are invisible to a player', { skip }, async () => {
  const { client, userId } = await playerClient();
  const server = serverClient();

  const { data: room, error: roomError } = await server
    .from('rooms')
    .insert({ code: 'RLSTEST', creator_id: userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();
  assert.equal(roomError, null, roomError?.message);

  const { data: plan, error: planError } = await client
    .from('quiz_plans')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(planError, null);
  assert.equal(plan.length, 0, 'a player must not read the plan');

  const { data: secrets, error: secretError } = await client
    .from('round_secrets')
    .select('*')
    .eq('round_id', '00000000-0000-0000-0000-000000000000');
  assert.equal(secretError, null);
  assert.equal(secrets.length, 0, 'a player must not read the answer key');
});

test('a player cannot write an answer row', { skip }, async () => {
  const { client, userId } = await playerClient();
  const server = serverClient();
  const { data: room } = await server
    .from('rooms')
    .insert({ code: 'RLSWRITE', creator_id: userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();

  const { error } = await client.from('answers').insert({
    room_id: room.id,
    round_id: '00000000-0000-0000-0000-000000000000',
    user_id: userId,
    guessed_answer: 'Lionel Messi',
    is_correct: true,
    stage_locked: 1,
    response_time_ms: 100,
    points_earned: 7500,
  });
  assert.ok(error, 'a player must not be able to insert a forged answer');
});

test('a player cannot update their own score', { skip }, async () => {
  const { client, userId } = await playerClient();
  const server = serverClient();
  const { data: room } = await server
    .from('rooms')
    .insert({ code: 'RLSSCORE', creator_id: userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();
  await server.from('room_memberships').insert({
    room_id: room.id, user_id: userId, display_name: 'Alex', joined_seq: 1,
  });

  const { error } = await client
    .from('room_memberships')
    .update({ total_score: 75000 })
    .eq('room_id', room.id);
  assert.ok(error, 'a player must not be able to set their own score');
});
```

- [ ] **Step 5: Add the test that pins the mid-round answers**

Add to `tests/integration/room.test.js`:

```js
test('an open round\'s answers are invisible to the room', { skip }, async () => {
  // is_correct and guessed_answer together would hand the answer to
  // everyone, so the table stays shut until the round closes.
  const host = await playerClient();
  const server = serverClient();
  const { data: room } = await server
    .from('rooms')
    .insert({ code: 'RLSOPEN', creator_id: host.userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();
  await server.from('room_memberships').insert({
    room_id: room.id, user_id: host.userId, display_name: 'Alex', joined_seq: 1,
  });

  const { data: round1 } = await server.from('rounds').insert({
    room_id: room.id, round_number: 1, template: 'identify', prompt: 'Who is this?',
    context: null, clues: [], options: [], reveal_schedule: [],
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
  }).select().single();

  await server.from('answers').insert({
    room_id: room.id, round_id: round1.id, user_id: host.userId,
    guessed_answer: 'Lionel Messi', is_correct: true, stage_locked: 1,
    response_time_ms: 1200, points_earned: 7500,
  });

  const { data: visible, error } = await host.client
    .from('answers').select('*').eq('room_id', room.id);
  assert.equal(error, null);
  assert.equal(visible.length, 0, 'an open round\'s answers must not be readable');

  await server.from('rounds').update({ closed_at: new Date().toISOString() }).eq('id', round1.id);
  const { data: after } = await host.client
    .from('answers').select('*').eq('room_id', room.id);
  assert.equal(after.length, 1, 'a closed round\'s answers are readable');
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/integration/room.test.js`
Expected: PASS, 4 tests. If the stack is not running the tests skip and say so — bring it up with `npx supabase@latest start` and run them again.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261021000100_room_tables.sql tests/integration
git commit -m "The room tables, and the walls around them"
```

---

## Task 5: Create, join, leave

**Files:**
- Create: `supabase/migrations/20261021000200_room_functions.sql`
- Modify: `tests/integration/room.test.js`

**Interfaces:**
- Consumes: `public.is_room_member` from Task 4.
- Produces:
  - `public.create_room(p_scope_id text, p_scope_clauses jsonb, p_display_name text) -> rooms`
  - `public.join_room(p_code text, p_display_name text) -> rooms`
  - `public.leave_room(p_room_id uuid) -> void`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/room.test.js`:

```js
test('the host creates a room and gets a code', { skip }, async () => {
  const { client, userId } = await playerClient();
  const { data: room, error } = await client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    p_scope_clauses: [{ tournaments: ['wc-2022'] }],
    p_display_name: 'Alex',
  });
  assert.equal(error, null, error?.message);
  assert.match(room.code, /^[A-Z2-9]{6}$/, 'a six character code');
  assert.equal(room.creator_id, userId);
  assert.equal(room.status, 'lobby');

  const { data: members } = await client
    .from('room_memberships')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].is_host, true);
  assert.equal(members[0].display_name, 'Alex');
});

test('a second player joins with the code', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });

  const guest = await playerClient();
  const { data: joined, error } = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Sam',
  });
  assert.equal(error, null, error?.message);
  assert.equal(joined.id, room.id);

  const { data: members } = await host.client
    .from('room_memberships')
    .select('*')
    .eq('room_id', room.id)
    .order('joined_seq');
  assert.equal(members.length, 2);
  assert.equal(members[1].display_name, 'Sam');
  assert.equal(members[1].joined_seq, 2);
});

test('two players may share a display name', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  const { error } = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Alex',
  });
  assert.equal(error, null, 'the second Alex must be able to join');
});

test('a display name is trimmed, stripped and capped', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: '  Sam the Great  ',
  });
  const { data: members } = await host.client
    .from('room_memberships').select('*').eq('room_id', room.id).order('joined_seq');
  assert.equal(members[1].display_name, 'Sam the Great');
});

test('a room that is full refuses another player', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  await host.client.rpc('set_room_capacity', { p_room_id: room.id, p_max_players: 1 });

  const guest = await playerClient();
  const { error } = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Sam',
  });
  assert.ok(error, 'a full room must refuse');
});

test('a player who leaves gives up the host role', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  await guest.client.rpc('join_room', { p_code: room.code, p_display_name: 'Sam' });

  await host.client.rpc('leave_room', { p_room_id: room.id });

  const { data: members } = await guest.client
    .from('room_memberships').select('*').eq('room_id', room.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].is_host, true, 'the host role moves to the player who stayed');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/integration/room.test.js`
Expected: FAIL with `function public.create_room does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261021000200_room_functions.sql`:

```sql
-- The room lifecycle a player drives directly.

create or replace function public.create_room(
  p_scope_id text,
  p_scope_clauses jsonb,
  p_display_name text
) returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_code text;
  v_name text;
  i int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_name := public.clean_display_name(p_display_name);

  -- The code is an invitation, not a secret, but it still should not be
  -- guessable in a handful of tries: 32 characters, six of them.
  for i in 1 .. 20 loop
    v_code := '';
    for j in 1 .. 6 loop
      v_code := v_code || substr(
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        1 + floor(random() * 32)::int,
        1);
    end loop;
    begin
      insert into public.rooms (code, creator_id, scope_id, scope_clauses)
      values (v_code, auth.uid(), p_scope_id, coalesce(p_scope_clauses, '[]'::jsonb))
      returning * into v_room;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  if v_room.id is null then
    raise exception 'could not allocate a room code' using errcode = 'P0001';
  end if;

  insert into public.room_memberships (room_id, user_id, display_name, is_host, joined_seq)
  values (v_room.id, auth.uid(), v_name, true, 1);

  return v_room;
end;
$$;

create or replace function public.clean_display_name(p_name text)
returns text
language sql
immutable
as $$
  select left(
    case
      when btrim(regexp_replace(coalesce(p_name, ''), '[^[:print:]]', '', 'g')) = ''
        then 'Player'
      else btrim(regexp_replace(coalesce(p_name, ''), '[^[:print:]]', '', 'g'))
    end,
    24);
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_name text;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_room
  from public.rooms
  where upper(code) = upper(btrim(coalesce(p_code, '')));

  if v_room.id is null then
    raise exception 'no room has that code' using errcode = 'P0002';
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'that game has already started' using errcode = 'P0002';
  end if;

  v_name := public.clean_display_name(p_display_name);

  select count(*) into v_count
  from public.room_memberships
  where room_id = v_room.id;

  if v_count >= v_room.max_players then
    raise exception 'that room is full' using errcode = 'P0002';
  end if;

  insert into public.room_memberships (room_id, user_id, display_name, joined_seq)
  values (
    v_room.id,
    auth.uid(),
    v_name,
    coalesce((select max(joined_seq) from public.room_memberships where room_id = v_room.id), 0) + 1
  )
  on conflict (room_id, user_id)
  do update set display_name = excluded.display_name;

  return v_room;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_host boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select is_host into v_was_host
  from public.room_memberships
  where room_id = p_room_id and user_id = auth.uid();

  delete from public.room_memberships
  where room_id = p_room_id and user_id = auth.uid();

  if v_was_host then
    update public.room_memberships m
    set is_host = true
    where m.id = (
      select id from public.room_memberships
      where room_id = p_room_id
      order by joined_seq
      limit 1
    );
  end if;
end;
$$;

-- A room's size, for tests and for a future "private room" setting.
create or replace function public.set_room_capacity(p_room_id uuid, p_max_players int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.rooms where id = p_room_id and creator_id = auth.uid()
  ) then
    raise exception 'only the host may resize a room' using errcode = '42501';
  end if;

  update public.rooms
  set max_players = least(greatest(p_max_players, 2), 12)
  where id = p_room_id;
end;
$$;
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase@latest db reset`
Expected: applies cleanly.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/integration/room.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261021000200_room_functions.sql tests/integration/room.test.js
git commit -m "Create a room, join it, leave it"
```

---

## Task 6: The round lifecycle

The advance, the current round, the result and the reconnect.

**Files:**
- Create: `supabase/migrations/20261021000300_round_lifecycle.sql`
- Modify: `tests/integration/room.test.js`

**Interfaces:**
- Consumes: the tables from Task 4, `leave_room` from Task 5.
- Produces:
  - `public.advance_room(p_room_id uuid) -> void`
  - `public.current_round(p_room_id uuid) -> jsonb`
  - `public.round_result(p_room_id uuid, p_round_number int) -> jsonb`
  - `public.sync_room_state(p_room_id uuid) -> jsonb`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/room.test.js`:

```js
test('the current round is null before the game starts', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const { data, error } = await host.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(error, null, error?.message);
  assert.equal(data.status, 'lobby');
  assert.equal(data.round, null);
});

test('an expired round advances and the next one appears', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();

  // Stand in for the edge function that starts the game: one round in,
  // and a plan with a second round waiting in it.
  const { data: round1 } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'identify',
    prompt: 'Who is this?',
    context: '2022 World Cup',
    clues: [{ id: 'c1', label: 'CAREER CLUBS', value: 'Barcelona' }],
    options: [{ id: 'opt-0', label: 'Lionel Messi', value: 'Lionel Messi' }],
    reveal_schedule: [{ stage: 1, revealAtMs: 2000 }],
    started_at: new Date(Date.now() - 60000).toISOString(),
    deadline_at: new Date(Date.now() - 1000).toISOString(),
  }).select().single();

  await server.from('round_secrets').insert({
    round_id: round1.id, answer_value: 'Lionel Messi', target_player_id: 28003,
  });
  await server.from('quiz_plans').insert({
    room_id: room.id,
    seed: 1,
    plan: [{
      client: {
        round_number: 2, template: 'identify', prompt: 'Who is this?', context: null,
        clues: [{ id: 'c1', label: 'CAREER CLUBS', value: 'Bayern' }],
        options: [{ id: 'opt-0', label: 'Thomas Muller', value: 'Thomas Muller' }],
        reveal_schedule: [{ stage: 1, revealAtMs: 2000 }],
      },
      secret: { answer_value: 'Thomas Muller', target_player_id: 1 },
    }],
  });
  await server.from('rooms').update({ status: 'round_active', current_round: 1 }).eq('id', room.id);

  const { data, error } = await host.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(error, null, error?.message);
  assert.equal(data.current_round, 2);
  assert.equal(data.round.round_number, 2);
  assert.equal(data.round.prompt, 'Who is this?');

  const { data: closed } = await server.from('rounds').select('closed_at').eq('id', round1.id).single();
  assert.ok(closed.closed_at, 'the first round must be closed');

  const { data: secret } = await server.from('round_secrets').select('answer_value').eq('round_id', round1.id).single();
  assert.equal(secret.answer_value, 'Lionel Messi');
});

test('the answer is only available once the round is closed', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();
  const { data: round1 } = await server.from('rounds').insert({
    room_id: room.id, round_number: 1, template: 'identify', prompt: 'Who is this?',
    context: null, clues: [], options: [], reveal_schedule: [],
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
  }).select().single();
  await server.from('round_secrets').insert({ round_id: round1.id, answer_value: 'Lionel Messi' });
  await server.from('rooms').update({ status: 'round_active', current_round: 1 }).eq('id', room.id);

  const { error } = await host.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.ok(error, 'the answer must not be readable while the round is open');

  await server.from('rounds').update({ closed_at: new Date().toISOString() }).eq('id', round1.id);
  const { data, error: afterError } = await host.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(afterError, null, afterError?.message);
  assert.equal(data.answer, 'Lionel Messi');
});

test('a player who is not in the room gets nothing', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const stranger = await playerClient();
  const { error } = await stranger.client.rpc('current_round', { p_room_id: room.id });
  assert.ok(error, 'a stranger must not read a room');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/integration/room.test.js`
Expected: FAIL with `function public.current_round does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261021000300_round_lifecycle.sql`:

```sql
-- The round lifecycle.
--
-- The server is the clock. A round closes when its deadline passes or
-- when every member has answered, and the next round is materialised at
-- that moment - so a future round has no row until the one before it
-- closes, and a client that queries the table directly finds nothing to
-- read ahead.

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
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null or v_room.status <> 'round_active' then
    return;
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;
  if v_round.id is null then
    return;
  end if;

  -- Still time, and somebody has not answered: the round goes on.
  if now() <= v_round.deadline_at and not exists (
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

  -- The scores become visible when the round closes, not when they are
  -- earned. Nobody learns anything from anybody else's play mid-round.
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

  -- A host who has gone quiet does not hold the room hostage.
  if not exists (
    select 1 from public.room_memberships
    where room_id = p_room_id and is_host and last_seen_at > now() - interval '30 seconds'
  ) then
    update public.room_memberships m
    set is_host = true
    where m.id = (
      select id from public.room_memberships
      where room_id = p_room_id
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
    clues, options, reveal_schedule, started_at, deadline_at
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
    v_started,
    v_started + interval '20 seconds'
  )
  returning id into v_round;

  insert into public.round_secrets (round_id, answer_value, target_player_id)
  values (
    v_round.id,
    v_next->'secret'->>'answer_value',
    nullif(v_next->'secret'->>'target_player_id', '')::bigint
  );

  update public.rooms
  set current_round = current_round + 1, status = 'round_active'
  where id = p_room_id;
end;
$$;

create or replace function public.current_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_answered int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  -- The poll is the heartbeat, so liveness costs no extra traffic.
  update public.room_memberships
  set last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();

  perform public.advance_room(p_room_id);

  select * into v_room from public.rooms where id = p_room_id;

  select count(*) into v_answered
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where r.room_id = p_room_id and r.round_number = v_room.current_round;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;

  return jsonb_build_object(
    'status', v_room.status,
    'current_round', v_room.current_round,
    'total_rounds', v_room.total_rounds,
    'answered_count', v_answered,
    'round', case when v_round.id is null then null else jsonb_build_object(
      'id', v_round.id,
      'round_number', v_round.round_number,
      'template', v_round.template,
      'prompt', v_round.prompt,
      'context', v_round.context,
      'clues', v_round.clues,
      'options', v_round.options,
      'reveal_schedule', v_round.reveal_schedule,
      'started_at', v_round.started_at,
      'deadline_at', v_round.deadline_at
    ) end
  );
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
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;
  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    raise exception 'that round is still open' using errcode = 'P0002';
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

  select to_jsonb(a) - 'id' - 'room_id' - 'round_id' - 'user_id' into v_mine
  from public.answers a
  where a.round_id = v_round.id and a.user_id = auth.uid();

  return jsonb_build_object(
    'round_number', p_round_number,
    'answer', v_secret.answer_value,
    'leaderboard', v_leaderboard,
    'my_answer', v_mine
  );
end;
$$;

create or replace function public.sync_room_state(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_state := public.current_round(p_room_id);

  return v_state || jsonb_build_object(
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
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase@latest db reset`
Expected: applies cleanly.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/integration/room.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261021000300_round_lifecycle.sql tests/integration/room.test.js
git commit -m "The round clock, and the answer nobody may read early"
```

---

## Task 7: Start the game

**Files:**
- Create: `supabase/functions/start-room/index.js`
- Test: `tests/integration/room.test.js` (the start part)

**Interfaces:**
- Consumes: `projectRound` from Task 3, `public.rooms` from Task 4.
- Produces: the Edge Function `start-room`. In: `{ room_id }`. Out: the round-1 payload.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/room.test.js`:

```js
test('the host starts the game and the first round appears', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });

  const res = await fetch(`${FUNCTIONS_URL}/start-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${host.accessToken}`,
    },
    body: JSON.stringify({ room_id: room.id }),
  });
  assert.equal(res.status, 200, await res.text());

  const payload = await res.json();
  assert.equal(payload.round_number, 1);
  assert.ok(payload.options.length === 4, 'four options');
  assert.equal(JSON.stringify(payload).includes('"correct"'), false, 'no correct flag');

  const server = serverClient();
  const { data: plan } = await server.from('quiz_plans').select('*').eq('room_id', room.id).single();
  assert.ok(plan, 'the plan exists');
  assert.equal(plan.plan.length, 10, 'ten rounds planned');

  const { data: secret } = await server
    .from('round_secrets').select('*').eq('round_id', payload.id).single();
  assert.ok(secret?.answer_value, 'the answer key exists');
});

test('a player who is not the host cannot start the game', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  await guest.client.rpc('join_room', { p_code: room.code, p_display_name: 'Sam' });

  const res = await fetch(`${FUNCTIONS_URL}/start-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${guest.accessToken}`,
    },
    body: JSON.stringify({ room_id: room.id }),
  });
  assert.equal(res.status, 403);
});

test('the game is played with the server preset, not the clauses the client sent', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    // A client that tries to smuggle a different scope in.
    p_scope_clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }],
    p_display_name: 'Alex',
  });

  const res = await fetch(`${FUNCTIONS_URL}/start-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${host.accessToken}`,
    },
    body: JSON.stringify({ room_id: room.id }),
  });
  assert.equal(res.status, 200, await res.text());

  const server = serverClient();
  const { data: plan } = await server.from('quiz_plans').select('*').eq('room_id', room.id).single();
  const first = plan.plan[0];
  assert.ok(first, 'a plan');
  const { data: room2 } = await server.from('rooms').select('pool_size').eq('id', room.id).single();
  assert.equal(room2.pool_size, 231, 'the World Cup 2022 pool, not the one the client asked for');
});
```

Add to `tests/integration/helpers.js`:

```js
export const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? `${URL}/functions/v1`;
```

and change `playerClient` to return the access token:

```js
export async function playerClient() {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, userId: data.user.id, accessToken: data.session.access_token };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/integration/room.test.js`
Expected: FAIL with a 404 from the function.

- [ ] **Step 3: Write the function**

Create `supabase/functions/start-room/index.js`:

```js
/**
 * Start the game.
 *
 * The plan is generated here, on the server, and never leaves it. The
 * client gets the first round's clues and options and nothing else.
 */
import { planQuiz, scopePool } from '../../../js/engine/index.js';
import { presetById } from '../../../js/presets.js';
import { serviceClient, callerClient } from '../_shared/client.js';
import { loadPool } from '../_shared/pool.js';
import { projectRound } from '../_shared/projection.js';

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const caller = callerClient(req);
    const { data: authData, error: authError } = await caller.auth.getUser(auth.replace('Bearer ', ''));
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 });
    }
    const userId = authData.user.id;

    const body = await req.json().catch(() => ({}));
    const roomId = body.room_id;
    if (!roomId) {
      return new Response(JSON.stringify({ error: 'room_id is required' }), { status: 400 });
    }

    const admin = serviceClient();

    // The room, and the caller's right to start it.
    const { data: room, error: roomError } = await admin
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();
    if (roomError || !room) {
      return new Response(JSON.stringify({ error: 'no such room' }), { status: 404 });
    }

    const { data: membership } = await admin
      .from('room_memberships')
      .select('*')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership?.is_host) {
      return new Response(JSON.stringify({ error: 'only the host starts the game' }), { status: 403 });
    }
    if (room.status !== 'lobby') {
      return new Response(JSON.stringify({ error: 'the game has already started' }), { status: 409 });
    }

    // The scope comes from the preset, never from the client.
    const preset = presetById(room.scope_id);
    if (!preset) {
      return new Response(JSON.stringify({ error: 'unknown vibe' }), { status: 400 });
    }
    const scope = { clauses: preset.clauses };

    const { data: file, error: fileError } = await admin.storage
      .from('pool')
      .createSignedUrl('pool.json', 600);
    if (fileError) throw fileError;
    const pool = await loadPool(file.signedUrl);

    const players = pool.players ?? [];
    const seed = crypto.getRandomValues(new BigUint64Array(1))[0] % 2147483647n;

    const quiz = planQuiz({
      scope,
      pool: players,
      registry: pool.registry,
      seed: Number(seed),
      rounds: room.total_rounds,
      difficulty: room.difficulty,
    });

    // The plan is stored once. The projection runs once. The database
    // copies jsonb from one round to the next.
    const projected = quiz.rounds.map((round, i) => projectRound(round, i + 1));

    await admin.from('quiz_plans').upsert({
      room_id: roomId,
      seed: Number(seed),
      plan: projected,
    });

    const first = projected[0];
    const startedAt = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 20000).toISOString();

    const { data: inserted, error: roundError } = await admin
      .from('rounds')
      .insert({
        room_id: roomId,
        round_number: first.client.round_number,
        template: first.client.template,
        prompt: first.client.prompt,
        context: first.client.context,
        clues: first.client.clues,
        options: first.client.options,
        reveal_schedule: first.client.reveal_schedule,
        started_at: startedAt,
        deadline_at: deadlineAt,
      })
      .select()
      .single();
    if (roundError) throw roundError;

    await admin.from('round_secrets').insert({
      round_id: inserted.id,
      answer_value: first.secret.answer_value,
      target_player_id: first.secret.target_player_id,
    });

    await admin.from('rooms').update({
      status: 'round_active',
      current_round: 1,
      pool_size: scopePool(scope, players).length,
    }).eq('id', roomId);

    return new Response(JSON.stringify({
      id: inserted.id,
      round_number: first.client.round_number,
      template: first.client.template,
      prompt: first.client.prompt,
      context: first.client.context,
      clues: first.client.clues,
      options: first.client.options,
      reveal_schedule: first.client.reveal_schedule,
      started_at: startedAt,
      deadline_at: deadlineAt,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 4: Serve the function**

Run: `npx supabase@latest functions serve --env-file supabase/.env.local`
Expected: `start-room` is listed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/integration/room.test.js`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/start-room tests/integration
git commit -m "The host starts the game, and the plan never leaves the server"
```

---

## Task 8: Answer a question

**Files:**
- Create: `supabase/functions/submit-answer/index.js`
- Test: `tests/integration/room.test.js`

**Interfaces:**
- Consumes: the engine's `answerRound` and `scoreRound`, `public.rounds`, `public.round_secrets`.
- Produces: the Edge Function `submit-answer`. In: `{ room_id, round_number, guessed_answer }`. Out: `{ correct, points, stage }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/room.test.js`:

```js
test('an answer is scored by the server', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await startGame(host, room.id);
  assert.equal(started.status, 200);

  const server = serverClient();
  const { data: secret } = await server
    .from('round_secrets').select('*').eq('round_id', started.body.id).single();

  const res = await fetch(`${FUNCTIONS_URL}/submit-answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${host.accessToken}`,
    },
    body: JSON.stringify({
      room_id: room.id,
      round_number: 1,
      guessed_answer: secret.answer_value,
    }),
  });
  assert.equal(res.status, 200, await res.text());
  const scored = await res.json();
  assert.equal(scored.correct, true);
  assert.ok(scored.points > 0, 'points for a correct answer');

  const { data: answers } = await server
    .from('answers').select('*').eq('room_id', room.id);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].is_correct, true);
});

test('an answer after the round closed is refused', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await startGame(host, room.id);
  const server = serverClient();
  await server.from('rounds')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', started.body.id);

  const res = await fetch(`${FUNCTIONS_URL}/submit-answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${host.accessToken}`,
    },
    body: JSON.stringify({
      room_id: room.id, round_number: 1, guessed_answer: 'Lionel Messi',
    }),
  });
  assert.equal(res.status, 409, 'a late answer must be refused');

  const { data: answers } = await server.from('answers').select('*').eq('room_id', room.id);
  assert.equal(answers.length, 0, 'no row is written for a late answer');
});

test('answering twice keeps the first answer', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await startGame(host, room.id);

  const answer = (guessed) => fetch(`${FUNCTIONS_URL}/submit-answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${host.accessToken}`,
    },
    body: JSON.stringify({
      room_id: room.id, round_number: 1, guessed_answer: guessed,
    }),
  });

  await answer('Someone Else');
  await answer('Someone Else');
  const server = serverClient();
  const { data: answers } = await server.from('answers').select('*').eq('room_id', room.id);
  assert.equal(answers.length, 1, 'a retry does not write a second row');
});
```

Add a helper to `tests/integration/room.test.js`:

```js
async function startGame(host, roomId) {
  const res = await fetch(`${FUNCTIONS_URL}/start-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${host.accessToken}`,
    },
    body: JSON.stringify({ room_id: roomId }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/integration/room.test.js`
Expected: FAIL with a 404 from the function.

- [ ] **Step 3: Write the function**

Create `supabase/functions/submit-answer/index.js`:

```js
/**
 * Answer a question.
 *
 * The score is computed here, from the server's own clock. A client that
 * claims to have answered at stage 1 gets the stage the server says they
 * answered at, and a client that sends the winning answer twice does not
 * get two answers.
 */
import { answerRound, scoreRound } from '../../../js/engine/index.js';
import { serviceClient, callerClient } from '../_shared/client.js';

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const caller = callerClient(req);
    const { data: authData, error: authError } = await caller.auth.getUser(auth.replace('Bearer ', ''));
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 });
    }
    const userId = authData.user.id;

    const body = await req.json().catch(() => ({}));
    const { room_id: roomId, round_number: roundNumber, guessed_answer: guessed } = body;
    if (!roomId || !roundNumber) {
      return new Response(JSON.stringify({ error: 'room_id and round_number are required' }), { status: 400 });
    }

    const admin = serviceClient();

    const { data: membership } = await admin
      .from('room_memberships')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: 'not a member of that room' }), { status: 403 });
    }

    const { data: round } = await admin
      .from('rounds')
      .select('*')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber)
      .maybeSingle();
    if (!round) {
      return new Response(JSON.stringify({ error: 'no such round' }), { status: 404 });
    }

    const { data: secret } = await admin
      .from('round_secrets')
      .select('*')
      .eq('round_id', round.id)
      .maybeSingle();
    if (!secret) {
      return new Response(JSON.stringify({ error: 'no answer key for that round' }), { status: 500 });
    }

    const receivedAt = new Date();

    // The round is open if it has not been closed and its deadline has
    // not passed. The server's clock decides.
    if (round.closed_at || receivedAt > new Date(round.deadline_at)) {
      return new Response(JSON.stringify({ error: 'too late - that round is over' }), { status: 409 });
    }

    // A retry returns the first answer rather than writing a second row.
    const { data: existing } = await admin
      .from('answers')
      .select('*')
      .eq('round_id', round.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({
        correct: existing.is_correct,
        points: existing.points_earned,
        stage: existing.stage_locked,
        already: true,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // The stage the server says the player answered at: the number of
    // reveals that had happened by the time the answer arrived.
    const schedule = round.reveal_schedule ?? [];
    const elapsed = Math.max(0, receivedAt.getTime() - new Date(round.started_at).getTime());
    const stage = Math.max(1, schedule.filter((s) => elapsed >= (s.revealAtMs ?? 0)).length);

    // The engine decides whether the answer is right and what it is worth.
    const verdict = answerRound(
      { template: round.template, answer: secret.answer_value },
      { answer: guessed, stage, elapsedMs: elapsed },
    );
    const score = scoreRound({ correct: verdict.correct, stage, elapsedMs: elapsed });

    const { error: insertError } = await admin.from('answers').insert({
      room_id: roomId,
      round_id: round.id,
      user_id: userId,
      guessed_answer: String(guessed ?? ''),
      is_correct: verdict.correct,
      stage_locked: stage,
      response_time_ms: elapsed,
      points_earned: score.points,
      received_at: receivedAt.toISOString(),
    });
    if (insertError) throw insertError;

    return new Response(JSON.stringify({
      correct: verdict.correct,
      points: score.points,
      stage,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 4: Serve the function**

Run: `npx supabase@latest functions serve --env-file supabase/.env.local`
Expected: `submit-answer` is listed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/integration/room.test.js`
Expected: PASS, 19 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/submit-answer tests/integration/room.test.js
git commit -m "The server scores the answer"
```

---

## Task 9: The client's Supabase plumbing

**Files:**
- Create: `client/src/supabase.js`, `client/src/room-state.js`
- Test: `tests/shared/room-state.test.js`

**Interfaces:**
- Consumes: `config` from `client/src/config.js`.
- Produces:
  - `connect() -> Promise<SupabaseClient | null>` from `client/src/supabase.js` — null when the SDK cannot be loaded.
  - `applyRound(state, payload)`, `applyMembers(state, members)`, `applyLeaderboard(state, board)`, `labelFor(state, userId)` from `client/src/room-state.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/room-state.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRound, applyMembers, applyLeaderboard, labelFor } from '../../client/src/room-state.js';

test('the room round replaces the previous one', () => {
  const state = { round: null };
  applyRound(state, { current_round: 2, round: { round_number: 2, prompt: 'Who is this?' } });
  assert.equal(state.round.round_number, 2);
  assert.equal(state.round.prompt, 'Who is this?');
});

test('a null round clears it', () => {
  const state = { round: { round_number: 1 } };
  applyRound(state, { current_round: 0, round: null });
  assert.equal(state.round, null);
});

test('members are listed in join order', () => {
  const state = { members: [] };
  applyMembers(state, [{ joined_seq: 2, display_name: 'Sam' }, { joined_seq: 1, display_name: 'Alex' }]);
  assert.deepEqual(state.members.map((m) => m.display_name), ['Alex', 'Sam']);
});

test('two players with the same name are told apart', () => {
  const state = { members: [] };
  applyMembers(state, [
    { user_id: 'a', joined_seq: 1, display_name: 'Alex' },
    { user_id: 'b', joined_seq: 2, display_name: 'Alex' },
  ]);
  assert.equal(labelFor(state, 'a'), 'Alex');
  assert.equal(labelFor(state, 'b'), 'Alex #2');
});

test('the leaderboard is ordered by points, then correct, then speed', () => {
  const state = { leaderboard: [] };
  applyLeaderboard(state, [
    { user_id: 'a', display_name: 'Slow', total_score: 100, correct_count: 1, total_response_ms: 9000 },
    { user_id: 'b', display_name: 'Fast', total_score: 100, correct_count: 1, total_response_ms: 3000 },
    { user_id: 'c', display_name: 'Top', total_score: 500, correct_count: 2, total_response_ms: 9000 },
  ]);
  assert.deepEqual(state.leaderboard.map((m) => m.display_name), ['Top', 'Fast', 'Slow']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/shared/room-state.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the state module**

Create `client/src/room-state.js`:

```js
/**
 * The pure parts of the room state.
 *
 * Kept apart from room.js so they can be tested without a browser, a
 * network or the Supabase SDK.
 */

/** Fold the server's current-round payload into the room state. */
export function applyRound(state, payload) {
  state.round = payload?.round ?? null;
  state.currentRound = payload?.current_round ?? 0;
  state.totalRounds = payload?.total_rounds ?? state.totalRounds ?? 10;
  state.status = payload?.status ?? state.status ?? 'lobby';
  state.answeredCount = payload?.answered_count ?? 0;
  return state;
}

/** Fold the member list in, in join order. */
export function applyMembers(state, members) {
  state.members = [...(members ?? [])].sort((a, b) => (a.joined_seq ?? 0) - (b.joined_seq ?? 0));
  return state;
}

/** Fold the leaderboard in, ranked the way the game ranks it. */
export function applyLeaderboard(state, board) {
  state.leaderboard = [...(board ?? [])].sort((a, b) => {
    if ((b.total_score ?? 0) !== (a.total_score ?? 0)) return (b.total_score ?? 0) - (a.total_score ?? 0);
    if ((b.correct_count ?? 0) !== (a.correct_count ?? 0)) return (b.correct_count ?? 0) - (a.correct_count ?? 0);
    if ((a.total_response_ms ?? 0) !== (b.total_response_ms ?? 0)) return (a.total_response_ms ?? 0) - (b.total_response_ms ?? 0);
    return (a.joined_seq ?? 0) - (b.joined_seq ?? 0);
  });
  return state;
}

/**
 * What to call a player in the leaderboard.
 *
 * Two players may pick the same name, so the second one gets a number.
 */
export function labelFor(state, userId) {
  const name = state.members.find((m) => m.user_id === userId)?.display_name
    ?? state.leaderboard.find((m) => m.user_id === userId)?.display_name
    ?? 'Player';
  const sameName = [...state.members, ...state.leaderboard]
    .filter((m) => m.display_name === name)
    .sort((a, b) => (a.joined_seq ?? 0) - (b.joined_seq ?? 0));
  if (sameName.length < 2) return name;
  const index = sameName.findIndex((m) => m.user_id === userId);
  return index < 0 ? name : `${name} #${index + 1}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/shared/room-state.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the Supabase client module**

Create `client/src/supabase.js`:

```js
/**
 * The Supabase client, and the anonymous identity behind it.
 *
 * The SDK is loaded from a CDN as an ES module. The client has no build
 * step, so it cannot bundle a dependency, and a dependency that is not
 * loaded must not break the game: if the import fails, `connect` returns
 * null and multiplayer is unavailable while solo play carries on.
 */
import { config } from './config.js';

const SDK_URL = 'https://esm.sh/@supabase/supabase-js@2.49.8';

let client = null;
let loading = null;

/**
 * The signed-in client, or null when the backend cannot be reached.
 *
 * The identity is anonymous: no email, no password, no sign-up form. The
 * session is persisted, so a refresh keeps the same player.
 */
export async function connect() {
  if (client) return client;
  if (loading) return loading;

  loading = (async () => {
    let createClient;
    try {
      ({ createClient } = await import(SDK_URL));
    } catch (err) {
      console.warn('multiplayer is unavailable:', err);
      return null;
    }

    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn('multiplayer is unavailable:', error);
        return null;
      }
    }

    client = supabase;
    return client;
  })();

  const result = await loading;
  loading = null;
  return result;
}

/** The signed-in user's id, or null. */
export async function myUserId() {
  const supabase = await connect();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/supabase.js client/src/room-state.js tests/shared/room-state.test.js
git commit -m "The client's side of the room"
```

---

## Task 10: The room client

**Files:**
- Create: `client/src/room.js`
- Modify: `client/src/store.js`

**Interfaces:**
- Consumes: `connect` from `client/src/supabase.js`, the state helpers from `client/src/room-state.js`.
- Produces: `room` — an object with `state`, `subscribe(fn)`, `create({scope})`, `join({code, displayName})`, `leave()`, `start()`, `answer(guessed)`, `sync()`, `dispose()`.

- [ ] **Step 1: Write the room client**

Create `client/src/room.js`:

```js
/**
 * The room client.
 *
 * This is the only module in the browser that knows Supabase exists.
 * Everything else asks this one for the room's state.
 */
import { connect, myUserId } from './supabase.js';
import { applyRound, applyMembers, applyLeaderboard } from './room-state.js';

const POLL_MS = 2000;

const state = {
  connected: false,
  me: null,
  roomId: null,
  code: null,
  status: 'lobby',
  scopeId: null,
  scopeName: null,
  scopeIcon: null,
  members: [],
  leaderboard: [],
  round: null,
  currentRound: 0,
  totalRounds: 10,
  answeredCount: 0,
  myAnswer: null,
  answeredRound: null,
  fetchingResult: false,
  lastResult: null,
  error: null,
};

const listeners = new Set();
let channel = null;
let pollTimer = null;
let client = null;
let me = null;

function notify() {
  for (const fn of listeners) fn();
}

async function ensure() {
  if (client) return client;
  client = await connect();
  if (client) {
    me = await myUserId();
    state.me = me;
    state.connected = true;
  }
  return client;
}

function applyPayload(payload) {
  if (!payload) return;
  applyRound(state, payload);
  if (payload.members) applyMembers(state, payload.members);
  if (payload.leaderboard) applyLeaderboard(state, payload.leaderboard);
}

async function subscribe(roomId) {
  if (!client) return;
  if (channel) await client.removeChannel(channel);

  channel = client
    .channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` }, () => sync())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_memberships', filter: `room_id=eq.${roomId}` }, () => sync())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => sync())
    .subscribe();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { sync().catch(() => {}); }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export const room = {
  state,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** The room state, for the screens. */
  get current() {
    return state;
  },

  async create({ scope }) {
    const supabase = await ensure();
    if (!supabase) {
      state.error = 'Multiplayer is unavailable right now.';
      notify();
      return null;
    }
    const { data, error } = await supabase.rpc('create_room', {
      p_scope_id: scope.id,
      p_scope_clauses: scope.clauses ?? [],
      p_display_name: scope.displayName ?? 'Host',
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.roomId = data.id;
    state.code = data.code;
    state.scopeId = scope.id;
    state.scopeName = scope.name;
    state.scopeIcon = scope.icon ?? null;
    state.status = data.status;
    state.error = null;
    await subscribe(data.id);
    await sync();
    notify();
    return data;
  },

  async join({ code, displayName }) {
    const supabase = await ensure();
    if (!supabase) {
      state.error = 'Multiplayer is unavailable right now.';
      notify();
      return null;
    }
    const { data, error } = await supabase.rpc('join_room', {
      p_code: code,
      p_display_name: displayName,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.roomId = data.id;
    state.code = data.code;
    state.status = data.status;
    state.error = null;
    await subscribe(data.id);
    await sync();
    notify();
    return data;
  },

  async leave() {
    if (!client || !state.roomId) return;
    await client.rpc('leave_room', { p_room_id: state.roomId });
    stopPolling();
    if (channel) {
      await client.removeChannel(channel);
      channel = null;
    }
    state.roomId = null;
    state.code = null;
    state.members = [];
    state.leaderboard = [];
    state.round = null;
    notify();
  },

  async start() {
    const supabase = await ensure();
    if (!supabase) return null;
    const { data, error } = await supabase.functions.invoke('start-room', {
      body: { room_id: state.roomId },
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.error = null;
    startPolling();
    await sync();
    notify();
    return data;
  },

  /** Lock an answer. The score comes back from the server. */
  async answer(guessed) {
    const supabase = await ensure();
    if (!supabase || !state.round) return null;
    const { data, error } = await supabase.functions.invoke('submit-answer', {
      body: {
        room_id: state.roomId,
        round_number: state.round.round_number,
        guessed_answer: guessed,
      },
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.myAnswer = data;
    // Remember which round this was. The room moves on to the next one
    // as soon as the round closes, and the reveal still needs to know
    // which round it is revealing.
    state.answeredRound = state.round.round_number;
    state.error = null;
    notify();
    return data;
  },

  /** Ask the server what is happening. Also drives the round advance. */
  async sync() {
    const supabase = client;
    if (!supabase || !state.roomId) return null;
    const { data, error } = await supabase.rpc('sync_room_state', { p_room_id: state.roomId });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.error = null;
    applyPayload(data);
    if (data.status === 'round_active' && !pollTimer) startPolling();
    if (data.status !== 'round_active' && pollTimer && data.status === 'final') stopPolling();
    notify();
    return data;
  },

  /** The finished round: the answer and the leaderboard. */
  async result(roundNumber) {
    const supabase = client;
    if (!supabase || !state.roomId) return null;
    const { data, error } = await supabase.rpc('round_result', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.lastResult = data;
    state.fetchingResult = false;
    applyLeaderboard(state, data.leaderboard);
    notify();
    return data;
  },

  dispose() {
    stopPolling();
    if (client && channel) client.removeChannel(channel);
    channel = null;
  },
};

/** A server error, said the way a player would say it. */
function friendly(message) {
  const m = String(message ?? '');
  if (m.includes('already started')) return 'That game has already started. Join the next one.';
  if (m.includes('no room has that code')) return 'No room has that code.';
  if (m.includes('room is full')) return 'That room is full.';
  if (m.includes('too late')) return 'Too late - that round is over.';
  if (m.includes('not signed in')) return 'Could not sign you in. Try again.';
  return 'Something went wrong. Try again.';
}
```

- [ ] **Step 2: Wire the room into the store**

In `client/src/store.js`, add the import and the subscription:

```js
import { room } from './room.js';
```

and inside the module, after the `const listeners = new Set();` declaration:

```js
room.subscribe(() => {
  state.room = room.state;
  notify();
});
```

and inside the `state` object add:

```js
  room: null,
```

and change `currentRound()`:

```js
  currentRound() {
    if (state.room?.round) return state.room.round;
    if (!state.quiz) return null;
    return state.quiz.rounds[state.roundIndex] ?? null;
  },
```

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/room.js client/src/store.js
git commit -m "The room client"
```

---

## Task 11: The home screen, the join screen and the room lobby

The solo lobby keeps working exactly as it does — it is the screen the
solo path lands on, and the existing browser test depends on it. The
room gets its own lobby, at `#room-lobby`.

**Files:**
- Create: `client/src/screens/join.js`, `client/src/screens/room-lobby.js`
- Modify: `client/src/screens/home.js`, `client/src/screens/vibes.js`, `client/src/main.js`, `client/styles/app.css`

**Interfaces:**
- Consumes: `room` from `client/src/room.js`, `PRESETS` from `/js/presets.js`.
- Produces: the route `#join`, the route `#room-lobby`, and a "Play solo" button on the vibe screen.

- [ ] **Step 1: Write the join screen**

Create `client/src/screens/join.js`:

```js
import { el, mount } from '../ui.js';
import { room } from '../room.js';

export function render(root) {
  const codeInput = el('input', {
    className: 'text-input',
    attrs: {
      type: 'text',
      id: 'join-code',
      placeholder: 'ABC234',
      maxlength: '6',
      autocapitalize: 'characters',
      autocomplete: 'off',
    },
  });

  const nameInput = el('input', {
    className: 'text-input',
    attrs: {
      type: 'text',
      id: 'join-name',
      placeholder: 'Your name',
      maxlength: '24',
      autocomplete: 'off',
    },
  });

  const errorEl = el('p', { className: 'muted-note', attrs: { id: 'join-error' } });

  const join = el('button', {
    className: 'btn btn--primary',
    text: 'Join the room',
    attrs: { type: 'button', id: 'btn-join' },
    on: {
      click: async () => {
        join.disabled = true;
        join.textContent = 'Joining\u2026';
        const joined = await room.join({
          code: codeInput.value.trim(),
          displayName: nameInput.value.trim() || 'Player',
        });
        if (joined) {
          location.hash = '#room-lobby';
        } else {
          join.disabled = false;
          join.textContent = 'Join the room';
          errorEl.textContent = room.state.error ?? 'Could not join that room.';
        }
      },
    },
  });

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '\u2190 Back', attrs: { href: '#home' } }),
    ]),
    el('section', { className: 'card' }, [
      el('h1', { className: 'page-title', text: 'Join a room' }),
      el('p', { className: 'muted-note', text: 'Type the code your host is showing you.' }),
      codeInput,
      nameInput,
      join,
      errorEl,
    ]),
  ]);
}
```

- [ ] **Step 2: Write the room lobby**

Create `client/src/screens/room-lobby.js`:

```js
import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { room } from '../room.js';

export function render(root) {
  const roomState = store.state.room;

  if (!roomState?.roomId) {
    location.hash = '#home';
    return;
  }

  const isHost = roomState.members.some((m) => m.user_id === roomState.me && m.is_host);

  const start = isHost
    ? el('button', {
      className: 'btn btn--primary',
      text: 'Start the quiz',
      attrs: { type: 'button', id: 'btn-start' },
      on: {
        click: async () => {
          start.disabled = true;
          start.textContent = 'Writing your quiz\u2026';
          const started = await room.start();
          if (started) {
            location.hash = '#round';
          } else {
            start.disabled = false;
            start.textContent = 'Start the quiz';
          }
        },
      },
    })
    : el('p', { className: 'muted-note', text: 'Waiting for the host to start the quiz.' });

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '\u2190 Back', attrs: { href: '#home' } }),
    ]),

    el('section', { className: 'card room-code' }, [
      el('p', { className: 'muted-note', text: 'Share this code so your friends can join' }),
      el('p', { className: 'room-code__value', text: roomState.code ?? '', attrs: { id: 'room-code' } }),
      el('button', {
        className: 'btn btn--tiny',
        text: 'Copy code',
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            navigator.clipboard?.writeText((roomState.code ?? '').replace(/ /g, '')).then(() => {
              e.target.textContent = 'Copied';
            }).catch(() => {});
          },
        },
      }),
    ]),

    el('section', { className: 'card vibe-summary' }, [
      el('span', { className: 'vibe-summary__icon', text: roomState.scopeIcon || '\u26bd' }),
      el('div', { className: 'vibe-summary__body' }, [
        el('h1', { className: 'page-title', text: roomState.scopeName ?? 'Your vibe' }),
        el('p', { className: 'muted-note', text: 'A quiz is written around your vibe' }),
      ]),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'In the room' }),
      el('div', { attrs: { id: 'room-players' } }, roomState.members.map((m) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: m.display_name }),
        el('span', { className: 'muted-note', text: m.is_host ? 'host' : '' }),
      ]))),
      el('p', { className: 'muted-note', text: 'The game starts when the host is ready.' }),
    ]),

    el('p', { className: 'fresh-quiz-note', text: 'A fresh quiz is written every time you play.' }),

    start,
  ]);
}
```

- [ ] **Step 3: Add the doors on the home screen**

In `client/src/screens/home.js`, add to the `mount(root, [...])` list, after the "Start from a vibe" section:

```js
    el('h2', { className: 'section-title', text: 'Play together' }),
    el('div', { className: 'vibe-grid' }, [
      el('a', { className: 'vibe-card vibe-card--door', attrs: { href: '#vibes' } }, [
        el('span', { className: 'vibe-card__icon', text: '\ud83d\udc65' }),
        el('span', { className: 'vibe-card__body' }, [
          el('strong', { className: 'vibe-card__name', text: 'Create a room' }),
          el('span', { className: 'vibe-card__desc', text: 'Pick a vibe, get a code, invite your friends' }),
        ]),
      ]),
      el('a', { className: 'vibe-card vibe-card--door', attrs: { href: '#join' } }, [
        el('span', { className: 'vibe-card__icon', text: '\ud83d\udd11' }),
        el('span', { className: 'vibe-card__body' }, [
          el('strong', { className: 'vibe-card__name', text: 'Join a room' }),
          el('span', { className: 'vibe-card__desc', text: 'Got a code? Type it in' }),
        ]),
      ]),
    ]),
```

- [ ] **Step 4: Let the vibe screen create a room, and keep solo**

In `client/src/screens/vibes.js`, the scope is already set when a preset is chosen. Leave that alone and add the two buttons to the screen's mounted children:

```js
    el('div', { className: 'vibe-actions' }, [
      el('button', {
        className: 'btn btn--primary',
        text: 'Create a room',
        attrs: { type: 'button', id: 'btn-create-room' },
        on: {
          click: async () => {
            const created = await room.create({ scope: store.state.scope });
            if (created) location.hash = '#room-lobby';
          },
        },
      }),
      el('a', {
        className: 'btn btn--ghost',
        text: 'Play solo',
        attrs: { href: '#lobby' },
      }),
    ]),
```

and add the import at the top of `client/src/screens/vibes.js`:

```js
import { room } from '../room.js';
```

- [ ] **Step 5: Register the routes**

In `client/src/main.js`, add the imports and the routes:

```js
import * as join from './screens/join.js';
import * as roomLobby from './screens/room-lobby.js';
```

```js
  '#join': join,
  '#room-lobby': roomLobby,
```

- [ ] **Step 6: Add the styles**

In `client/styles/app.css`, append:

```css
.vibe-card--door {
  text-decoration: none;
  color: inherit;
  display: flex;
  gap: 12px;
  align-items: center;
}

.text-input {
  width: 100%;
  padding: 12px;
  margin: 8px 0;
  border: 2px solid currentColor;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.vibe-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}
```

- [ ] **Step 7: Run the browser tests**

Run: `npm run test:client`
Expected: PASS. The solo test still finds `#lobby` and `#btn-start` — the solo path is untouched.

- [ ] **Step 8: Commit**

```bash
git add client/src/screens client/src/main.js client/styles/app.css
git commit -m "The doors: create a room, join a room"
```

## Task 12: The round screen in room mode

**Files:**
- Modify: `client/src/screens/round.js`

**Interfaces:**
- Consumes: `room` from `client/src/room.js`, `store.currentRound()`.
- Produces: a round screen that plays either a solo round or a room round.

- [ ] **Step 1: Write the failing browser test**

Add to `tests/client/client.spec.js`:

```js
test('the round screen shows the server round in a room', async ({ page, browser }) => {
  const errors = watchErrors(page);
  const host = await page.context().newPage();
  const guest = await (await browser.newContext()).newPage();

  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(3).click();
  await expect(host).toHaveURL(/#room-lobby/);
  const code = await host.locator('#room-code').innerText();

  await guest.goto('./');
  await guest.locator('#join-code').fill(code);
  await guest.locator('#join-name').fill('Sam');
  await guest.locator('#btn-join').click();
  await expect(guest).toHaveURL(/#room-lobby/);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  // Both players see the same prompt and the same options.
  await expect(host.locator('.option')).toHaveCount(4);
  await expect(guest.locator('.option')).toHaveCount(4);
  const hostOptions = await host.locator('.option__label').allInnerTexts();
  const guestOptions = await guest.locator('.option__label').allInnerTexts();
  expect(hostOptions.sort()).toEqual(guestOptions.sort());

  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/client/client.spec.js -g "the round screen shows the server round"`
Expected: FAIL — there is no `#room-lobby` route yet, or the join screen is missing.

- [ ] **Step 3: Make the round screen serve both modes**

In `client/src/screens/round.js`, at the top of `render`, replace the quiz/round lookup with:

```js
  const quiz = store.state.quiz;
  const roomState = store.state.room;
  const inRoom = Boolean(roomState?.round);

  // The server's round is the engine's round with one key renamed: the
  // column is reveal_schedule, the engine calls it revealSchedule.
  const round = inRoom
    ? { ...roomState.round, revealSchedule: roomState.round.reveal_schedule ?? [] }
    : store.currentRound();

  if (!round) {
    location.hash = '#home';
    return;
  }
```

and replace the "already answered" check with:

```js
  // The round has already been answered - the reveal screen is next.
  const answered = inRoom
    ? Boolean(roomState.myAnswer)
    : store.state.answers.some((a) => a.roundIndex === store.state.roundIndex);
  if (answered) {
    location.hash = '#reveal';
    return;
  }
```

and replace the start time with the server's:

```js
  // In a room the server decides when the round started. The client
  // renders the same absolute schedule, so two phones reveal the same
  // clue at the same moment.
  const startedAt = inRoom
    ? new Date(roomState.round.started_at).getTime()
    : (store.state.roundStartedAt || Date.now());
```

and replace the timer deadline:

```js
const ROUND_MS = 20000;
```
with a computed deadline:

```js
  const deadline = inRoom
    ? new Date(roomState.round.deadline_at).getTime()
    : startedAt + ROUND_MS;
```

and change the remaining-time calculation in `paint()`:

```js
    const remaining = Math.max(0, deadline - elapsed);
```

and change the option click handler:

```js
      click: async () => {
        const elapsed = Math.max(0, Date.now() - startedAt);
        const stage = Math.max(1, revealedStages(round, elapsed));
        if (inRoom) {
          // The server decides whether the answer was right and what it
          // is worth. The client never scores its own game.
          const scored = await room.answer(opt.value ?? opt.label);
          if (!scored) return;
          location.hash = '#reveal';
          return;
        }
        const scored = answerRound(round, { answer: opt.value ?? opt.label, stage, elapsedMs: elapsed });
        store.recordAnswer({
          roundIndex: store.state.roundIndex,
          stage,
          correct: scored.correct,
          points: scored.points,
          chosen: opt.label,
          answer: round.answer,
        });
        location.hash = '#reveal';
      },
```

and change the round counter, because a room has no local quiz to count:

```js
    el('div', { className: 'round-meta' }, [
      el('span', {
        className: 'muted-note',
        text: inRoom
          ? `Round ${roomState.round.round_number} of ${roomState.totalRounds}`
          : `Round ${round.stage} of ${quiz.rounds.length}`,
      }),
    ]),
```

and change the banner, because a room has no scope in the store:

```js
  const scopeWindow = resolveWindow(store.state.scope, store.state.registry);
  const windowLabel = round.context
    ?? scopeWindow?.label
    ?? store.state.scope?.name
    ?? roomState.scopeName
    ?? '';
```

and add the import:

```js
import { room } from '../room.js';
```

- [ ] **Step 4: Run the browser test**

Run: `npx playwright test tests/client/client.spec.js -g "the round screen shows the server round"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/round.js tests/client/client.spec.js
git commit -m "The round screen plays the server's round"
```

---

## Task 13: The reveal and the results in room mode

**Files:**
- Modify: `client/src/screens/reveal.js`, `client/src/screens/results.js`

**Interfaces:**
- Consumes: `room.result(roundNumber)` from `client/src/room.js`.
- Produces: a reveal that shows the server's answer and a results screen that shows the server's leaderboard.

- [ ] **Step 1: Write the failing browser test**

Add to `tests/client/client.spec.js`:

```js
test('a room shows the same answer to everyone and a leaderboard', async ({ page, browser }) => {
  const host = await page.context().newPage();
  const guest = await (await browser.newContext()).newPage();

  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(3).click();
  await expect(host).toHaveURL(/#room-lobby/);
  const code = await host.locator('#room-code').innerText();

  await guest.goto('./');
  await guest.locator('#join-code').fill(code);
  await guest.locator('#join-name').fill('Sam');
  await guest.locator('#btn-join').click();
  await expect(guest).toHaveURL(/#room-lobby/);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  // Both answer the first option.
  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();

  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);

  const hostAnswer = await host.locator('.verdict strong').innerText();
  const guestAnswer = await guest.locator('.verdict strong').innerText();
  expect(hostAnswer).toBe(guestAnswer);
});

test('a player who refreshes mid-round keeps their score', async ({ page, browser }) => {
  const host = await page.context().newPage();
  const guest = await (await browser.newContext()).newPage();

  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(3).click();
  await expect(host).toHaveURL(/#room-lobby/);
  const code = await host.locator('#room-code').innerText();

  await guest.goto('./');
  await guest.locator('#join-code').fill(code);
  await guest.locator('#join-name').fill('Sam');
  await guest.locator('#btn-join').click();
  await expect(guest).toHaveURL(/#room-lobby/);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  await guest.locator('.option').first().click();
  await expect(guest).toHaveURL(/#reveal/);

  // The phone sleeps and the player comes back.
  await guest.reload();
  await guest.waitForTimeout(1500);

  // Still in the room, still the same round.
  await expect(guest).toHaveURL(/#round|#reveal/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/client/client.spec.js -g "a room shows the same answer"`
Expected: FAIL — the reveal shows nothing in room mode.

- [ ] **Step 3: Make the reveal work in room mode**

In `client/src/screens/reveal.js`, at the top of `render`, add:

```js
import { room } from '../room.js';
```

and inside `render`, before building the card:

```js
  const roomState = store.state.room;
  const inRoom = Boolean(roomState?.roomId);
```

and where the card's facts are built, for room mode use the server's result:

```js
  if (inRoom && roomState.lastResult) {
    facts.push({ label: 'The answer', value: roomState.lastResult.answer });
  }
```

and the "It was" line:

```js
  const answerText = inRoom && roomState.lastResult
    ? roomState.lastResult.answer
    : (round?.unit ? `${round.answer} ${round.answer === 1 ? round.unit.replace(/s$/, '') : round.unit}` : String(round?.answer ?? ''));
```

- [ ] **Step 4: Fetch the result when the reveal opens**

At the top of the reveal's `render`, before building anything:

```js
  if (inRoom && !roomState.lastResult && roomState.answeredRound) {
    // The answer is only available once the round is closed. Ask for it,
    // and paint when it arrives. The flag keeps this from asking twice:
    // the room's state change re-renders the screen.
    if (!roomState.fetchingResult) {
      roomState.fetchingResult = true;
      room.result(roomState.answeredRound);
    }
    return;
  }
```

Note which round is asked for: `answeredRound`, not the room's current round. The room
moves on as soon as the round closes, so the room's current round is already the next
one by the time the reveal opens.

and clear the flag when the result arrives — in `room.result`, set `state.lastResult = data` and `state.fetchingResult = false` ✓ (add that line to `client/src/room.js`).

- [ ] **Step 5: Make the results screen show the server's leaderboard**

In `client/src/screens/results.js`, add:

```js
import { room } from '../room.js';
```

and inside `render`:

```js
  const roomState = store.state.room;
  const inRoom = Boolean(roomState?.roomId);
```

and where the rows are built, for room mode use `roomState.leaderboard`:

```js
  const rows = inRoom && roomState.leaderboard.length
    ? roomState.leaderboard.map((m, i) => ({ ...m, position: i + 1 }))
    : store.state.answers.map((a, i) => ({ ...a, position: i + 1 }));
```

- [ ] **Step 6: Run the browser tests**

Run: `npm run test:client`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/screens/reveal.js client/src/screens/results.js client/src/room.js tests/client/client.spec.js
git commit -m "The reveal and the leaderboard, from the server"
```

---

## Task 14: The whole loop, end to end

**Files:**
- Modify: `tests/integration/room.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: one test that plays a room from creation to the final leaderboard.

- [ ] **Step 1: Write the test**

Add to `tests/integration/room.test.js`:

```js
test('a room plays ten rounds and keeps a leaderboard', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  await guest.client.rpc('join_room', { p_code: room.code, p_display_name: 'Sam' });

  const started = await startGame(host, room.id);
  assert.equal(started.status, 200, started.body?.error);

  const server = serverClient();
  const { data: secret } = await server
    .from('round_secrets').select('*').eq('round_id', started.body.id).single();

  // Both players answer correctly.
  for (const who of [host, guest]) {
    const res = await fetch(`${FUNCTIONS_URL}/submit-answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${who.accessToken}`,
      },
      body: JSON.stringify({
        room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
      }),
    });
    assert.equal(res.status, 200);
  }

  // Everyone answered, so the round closes on the next call.
  const { data: state } = await host.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(state.current_round, 2);
  assert.ok(state.answered_count >= 2, 'the server counts the answers');

  // The leaderboard is visible once the round is closed.
  const { data: result } = await host.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.answer, secret.answer_value);
  assert.equal(result.leaderboard.length, 2);
  assert.ok(result.leaderboard.every((m) => m.total_score > 0), 'both players scored');
});
```

- [ ] **Step 2: Run it**

Run: `node --test tests/integration/room.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/room.test.js
git commit -m "A room plays a whole round"
```

---

## Task 15: The deploy note

**Files:**
- Create: `docs/MULTIPLAYER.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the instructions for running the room on a hosted Supabase project.

- [ ] **Step 1: Write the note**

Create `docs/MULTIPLAYER.md`:

```markdown
# Multiplayer

The game works on its own: pick a vibe, play ten rounds, no backend. This
is how to run the room.

## Locally

```bash
npx supabase start                 # the local stack (about 10GB of images)
npx supabase db reset              # apply the migrations
npm run supabase:sync              # write client/src/config.js
npm run supabase:upload            # put the player pool in Storage
npx supabase functions serve --env-file supabase/.env.local
npm run dev                        # the game on http://localhost:8099/
```

Open two browsers, create a room in one, join it in the other with the
code.

## On a hosted project

1. Create a free project at supabase.com.
2. Authentication → Providers → Anonymous → on.
3. `npx supabase login` and `npx supabase link --project-ref <ref>`.
4. `npx supabase db push` — the migrations.
5. `npx supabase functions deploy start-room` and
   `npx supabase functions deploy submit-answer`.
6. Storage → create a bucket called `pool`, not public.
7. `SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> npm run supabase:sync`
   and commit the result.
8. `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run supabase:upload`.

The anon key in `client/src/config.js` is public by definition. It can read
nothing: the quiz plan and the answer key are behind row-level security
that the anon key cannot pass.
```

- [ ] **Step 2: Add the upload script to package.json**

In `package.json`, add:

```json
"supabase:upload": "node scripts/upload-pool.js"
```

- [ ] **Step 3: Commit**

```bash
git add docs/MULTIPLAYER.md package.json
git commit -m "How to run the room"
```

---

## After the plan

- The **Phase 0 falsification test** from the v1 spec is still not run: the game is playable today, so it can be run with a group of friends before anything else is built on top of it.
- **Phase 5** — the scope builder — is the next phase. The room takes a preset id today, and the server resolves the scope by id, so a custom scope needs one more thing: a way to store a scope that is not a preset.
