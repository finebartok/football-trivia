# Multiplayer Room — Phase 4 design

**Date:** 2026-10-21
**Status:** approved in conversation; written up here for review
**Supersedes:** nothing. `docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` §7 remains the product-level contract; this document is the buildable version of it, and it **diverges from §7 in four named places** (§12).

---

## 1. What this is

Phase 4 turns the playable-but-solo game into a multiplayer one. Two to twelve people join a room with a six-character code, the host picks a vibe, the engine writes a ten-round quiz **on the server**, and everyone plays the same quiz on the same clock.

The design goal is the one the v1 spec states: **the engine is under the hood**. A player never receives the plan, never receives an answer before the round resolves, and cannot forge a score.

### 1.1 What "done" means

Two browsers in one room play a full ten-round game together: same options, same clue ladder revealing at the same moment, both scores correct, a leaderboard at the end, and a refresh mid-game rejoins with the score intact.

---

## 2. The player's experience

1. **Home** gains two doors beside the existing "play solo":
   - **Create a room** — pick a vibe, get a code.
   - **Join a room** — type a code, type a display name.
2. **Lobby** — the players who have actually joined, listed, with the host marked. The host's button says "Start the quiz". The code is shown big and copyable.
3. **Rounds** — ten of them. Everyone sees the same four options and the same four clue cards. The clue ladder reveals on a shared absolute clock. One answer per player; the round ends at the deadline or when everyone has answered.
4. **Reveal** — everyone sees the same target player and the same answer, and their own points.
5. **Results** — the final leaderboard, ranked by points, then correct count, then total response time, then join order.
6. **Reconnect** — a refresh, a backgrounded phone, or a dropped network rejoins the round in progress with the score intact.
7. **Late join is refused** — the game is already running. The message says so plainly.

Player-facing wording rules, unchanged from the v1 spec: the noun is **vibe**, the verb is **craft**. No string in the room flow may name a scope, a predicate, a metric, a window id or a raw id.

---

## 3. Architecture

### 3.1 Where each piece lives

| Piece | Where | Why there |
|---|---|---|
| Room state | Postgres tables: `rooms`, `room_memberships`, `rounds`, `round_secrets`, `answers`, `quiz_plans` | Row-level security is the only mechanism that can make "no client sees the plan" true. |
| The quiz plan | Edge Function `start-room` | The engine is pure ESM and runs unchanged in Deno. The plan must exist where the client cannot reach it. |
| The score | Edge Function `submit-answer` | A score the client computes is a score the client can forge. The function uses the engine's own scoring module, so there is one implementation of the rules. |
| The clock | Absolute timestamps in the database | The server decides when a round starts and ends. Clients render the same schedule, so a phone that slept catches up instantly. |
| Push | Realtime `postgres_changes` on `rooms`, `room_memberships`, `rounds`, `answers` | The client learns about the lobby, the next round and the leaderboard without polling. Writes cannot be forged because every write goes through a `SECURITY DEFINER` function. |
| Fallback and round advance | A 2-second client poll during an active round | Serves two jobs: it notices the deadline and asks the server to advance, and it keeps the game playable if Realtime degrades. One mechanism, not two. |
| Identity | Supabase anonymous sign-in | No email, no password, no sign-up form. A display name typed in the lobby; deliberately not unique. |
| The player pool | Supabase Storage, `pool.json` | The engine's input contract. The server holds it; the browser loads its own copy lazily, only when the vibe screen needs it. |

### 3.2 The engine needs no changes

`planQuiz({ scope, pool, registry, seed, rounds, difficulty })` already takes the pool as an argument, and nothing in `js/engine/` imports `js/engine/fixture.js` (the Node-only file that reads the pool from disk). So the Edge Function imports the engine's pure modules, passes the pool it fetched from Storage, and gets a plan.

`submit-answer` imports the same `scoreRound` and `normaliseName` the browser uses in solo play. **One implementation of the scoring rules**, not a SQL twin that can drift.

### 3.3 One module moves

The presets (the seven vibes a player can pick) currently live in `client/src/pool.js`, which only the browser can import. The server needs them too: the scope the quiz is actually built from is resolved by `scope_id` from the shared preset module, so a client that hand-edits its own scope gets a game built from the real preset anyway.

So the preset list moves to `js/presets.js` at the repo root — importable by the browser (the dev server already serves `/js/engine/`) and by the Edge Function. `client/src/pool.js` re-exports it, so the client's imports do not change.

The same module gives the client the pool count for a vibe ("236 players in the pool"): the client counts against the pool it loads, the server counts against the pool it holds, and `rooms.pool_size` is written from the server's count when the game starts.

### 3.4 The solo path is not removed

Solo play keeps running the engine in the browser with no backend. The room is a second source of rounds, not a replacement for the first.

This costs one branch in the store and one in the round screen's answer handler. It buys: the game still starts instantly with no network, and a Supabase outage does not brick the game.

---

## 4. Data model

Six tables. All timestamps are `timestamptz`. All uuid defaults are `gen_random_uuid()`.

```sql
create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                    -- 6 chars, no I/O/0/1
  creator_id uuid not null references auth.users(id),
  scope_id text not null,                       -- a preset id, e.g. 'wc-2022'
  scope_clauses jsonb not null,                 -- the scope snapshot, taken at create time
  difficulty text not null check (difficulty in ('easy','medium','hard')) default 'medium',
  status text not null check (status in ('lobby','round_active','round_ended','final','abandoned')) default 'lobby',
  max_players int not null default 12,
  current_round int not null default 0,
  total_rounds int not null default 10,
  pool_size int not null default 0,             -- how many players the scope resolves to
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on rooms (code);
create index on rooms (creator_id);

create table room_memberships (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,                   -- deliberately NOT unique
  is_host boolean not null default false,
  joined_seq int not null,                      -- tie-break for the leaderboard and for "Alex #2"
  last_seen_at timestamptz not null default now(),
  total_score int not null default 0,
  correct_count int not null default 0,
  total_response_ms int not null default 0,
  unique (room_id, user_id)
);

-- The plan. Generated once, read only by the service role.
create table quiz_plans (
  room_id uuid primary key references rooms(id) on delete cascade,
  seed bigint not null,
  plan jsonb not null,                          -- the composed rounds, with their answers
  generated_at timestamptz not null default now()
);

-- One row per round, materialised only when that round begins.
create table rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  prompt text not null,
  context text,                                 -- the window label, shown as a banner
  clues jsonb not null,                         -- [{id,label,value,iconKey,window}]
  options jsonb not null,                       -- [{id,label}] - NO correct flag, ever
  reveal_schedule jsonb not null,               -- [{stage, reveal_at}] absolute timestamptz
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  closed_at timestamptz,
  unique (room_id, round_number)
);

-- The answer key. Never readable by a client.
create table round_secrets (
  round_id uuid primary key references rounds(id) on delete cascade,
  answer_value text not null,                   -- the authoritative answer, any template
  target_player_id bigint                       -- set when the template names a player
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  guessed_answer text not null,
  is_correct boolean not null,                  -- server-computed
  stage_locked int not null,                    -- server-computed
  response_time_ms int not null,                -- server-computed
  points_earned int not null,                   -- server-computed
  received_at timestamptz not null default now(),
  unique (round_id, user_id)
);
```

### 4.1 Why `answer_value` and not `target_player_id`

The v1 spec's schema had `round_secrets.target_player_id` and `answers.guessed_player_name`, because when it was written the engine shipped only the `identify` template. The engine now also ships `stat_value` (a numeric answer: "3 goals"). The answer key is therefore **template-agnostic**: a text value that is compared after the same normalisation the engine uses.

`target_player_id` stays as a nullable column because the recap wants to link the round to the player it was about.

### 4.2 Why `options` carries no `correct` flag

`rounds` is readable by room members. If it carried the flag, every member could read the answer straight out of the table. The row carries four option labels; the server knows which one is right because it holds the answer value in `round_secrets` and matches it against the labels with the engine's `normaliseName`.

### 4.3 Row-level security

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `rooms` | creator or member | authenticated | `SECURITY DEFINER` functions only | creator |
| `room_memberships` | same-room members | `auth.uid() = user_id`, room is `lobby`, not full | own row only | own row or creator |
| `quiz_plans` | **nobody** | service role | service role | service role |
| `rounds` | members, and only rows whose `started_at <= now()` | service role | service role | service role |
| `round_secrets` | **nobody** | service role | service role | service role |
| `answers` | room members, **but only for rounds that are closed** | **nobody** | **never** | never |

Every table gets `alter table <table> enable row level security` and a policy per operation. `service_role` bypasses RLS by default, which is what the Edge Functions use.

**`answers` has no client INSERT path at all.** The Edge Function writes the row with the service role. An RPC that took pre-computed `is_correct` and `points_earned` would be forgeable — any authenticated client could call it with the winning values — so the only route to an answer row is the Edge Function, which computes the score itself.

### 4.3.1 Why an open round's answers are not readable

An answer row carries `guessed_answer` and `is_correct`. If members could read the table during a round, the first player to answer correctly would hand the answer to everyone: read `is_correct = true`, read that player's `guessed_answer`, and copy it. The row is therefore unreadable until the round closes.

This has two consequences, both intended:

- **A score becomes visible when its round closes, not when it is earned.** The membership totals are aggregated from the answers table by the advance function when the round closes. A player who scores 7,500 in round 3 does not telegraph it to the room during round 3.
- **The mid-round counter comes from the server, not from the table.** `current_round` returns `answered_count` — how many members have answered — which leaks nothing. The realtime subscription on `answers` fires only for closed rounds, because realtime applies the same row-level security the table does.

So during a round, a player learns nothing at all from anybody else's play.

### 4.4 The functions

All are `SECURITY DEFINER` with `set search_path = public`, and all validate the caller.

| Function | Returns | Rules |
|---|---|---|
| `create_room(scope_id text, scope_clauses jsonb)` | `rooms` row | authenticated; the code is generated server-side (6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, retried on collision); the caller becomes the host with `joined_seq = 1`. The stored clauses are for display only — the authoritative scope is resolved from the shared preset module by `scope_id` when the game starts, so a client that stores something else gets a game built from the preset anyway |
| `join_room(code text, display_name text)` | `rooms` row | room exists, `status = 'lobby'`, not full; inserts the membership; assigns `joined_seq`. The display name is trimmed, stripped of control characters and capped at 24 characters — it is untrusted input from another device |
| `leave_room(room_id uuid)` | void | removes the membership; if the host left, transfer the host role to the longest-tenured remaining member |
| `current_round(room_id uuid)` | the client-visible round, or null | advances the room if the round is over; members only |
| `round_result(room_id uuid, round_number int)` | `{answer, target_player, leaderboard}` | **returns the answer only if that round is closed** |
| `sync_room_state(room_id uuid)` | status, current round, schedule, revealed stages, own prior answer, leaderboard | members only; never includes the target of an open round |

There is deliberately **no `submit_answer` RPC**. The Edge Function writes the answer row with the service role, after checking the round is open and computing the score. Every client-facing write goes through a function that validates the caller; every write that touches an answer goes through code the client cannot call.

### 4.4.1 Who is online

`room_memberships.last_seen_at` is updated by the caller's own `current_round` call — the poll the client already makes is the heartbeat, so liveness costs no extra traffic. A member is offline when `last_seen_at < now() - 30 seconds`.

`leave_room` is called explicitly when the player taps "Leave". If the host disappears without calling it, `advance_room` promotes the longest-tenured online member when it next runs.

### 4.5 The advance

`advance_room(room_id)` — `SECURITY DEFINER`, called from `current_round`:

1. If the room is not `round_active`, return.
2. If `now() <= deadline_at` **and** not every member has answered, return.
3. Close the round: set `closed_at = now()`, and fold this round's answers into the memberships' running totals (`total_score`, `correct_count`, `total_response_ms`). The totals are only updated here, so nobody sees a score before the round that earned it closes.
4. If the round was the last, set the room to `final` and `finished_at = now()`.
5. Otherwise, take round *n+1* out of `quiz_plans.plan`, insert its `rounds` row and its `round_secrets` row, set the room's `current_round`, set `status = 'round_active'`, and set the new `started_at = now()` and `deadline_at = now() + 20s`.

Because a future round has no row until the previous one closes, a member who queries `rounds` directly finds nothing to read ahead. The one row that exists carries no answer.

**A room only advances while somebody is watching.** If every phone is asleep the room sits on the expired round until someone returns, and that player is told they missed it. This is deliberate: burning rounds for an audience of nobody is worse than waiting, and it removes the need for a cron job.

### 4.6 Timestamps and drift

The client renders the clue ladder by comparing `now()` to absolute `reveal_at` values, not by counting ticks. A phone that was asleep for two minutes renders the fully-revealed ladder the instant it wakes. Two phones with skewed clocks can disagree by a fraction of a second, which is below the threshold of a human noticing.

The server's `received_at` is authoritative for scoring and for the deadline.

---

## 5. The server functions (Edge Functions, Deno)

Two functions under `supabase/functions/`, plus the shared modules they both use. Each uses the service-role key to read what the client cannot, and validates the caller's JWT for anything a client initiates. The third thing the design called for, a reconnect sync, turned out to need nothing the client cannot read, so it is an RPC instead — see §5.3.

### 5.1 `start-room`

**In:** `{ room_id, seed }` with the caller's JWT.
**Out:** the round-1 payload.

1. Check the caller is the room's host and the room is `lobby`.
2. Resolve the scope: look `scope_id` up in the shared preset module and take **its** clauses.
3. Fetch `pool.json` from Storage (cached in module scope for the life of the instance).
4. `planQuiz({ scope: {clauses}, pool, registry: pool.registry, seed, rounds: 10, difficulty })`.
5. Write `quiz_plans` (the full plan, answers included).
6. Take round 1, insert its `rounds` row (without the correct flag) and its `round_secrets` row.
7. Set the room to `round_active`, `current_round = 1`, and write the server's pool count to `rooms.pool_size`.
8. Return the round-1 payload.

### 5.2 `submit-answer`

**In:** `{ room_id, round_number, guessed_answer }` with the caller's JWT.
**Out:** `{ correct, points, stage }`.

1. Check the caller is a member of the room.
2. Check the round is open: `closed_at is null and now() <= deadline_at`. Otherwise refuse.
3. Read the round's `answer_value` from `round_secrets` (service role).
4. Score it with the engine's `answerRound` / `scoreRound`.
5. Insert the `answers` row with the service role. The unique constraint makes a retry idempotent — a second attempt for the same round returns the first answer's result rather than writing again.
6. Return the score.

The membership's running totals are **not** updated here — `advance_room` folds them in when the round closes, so a score does not telegraph itself to the room mid-round (see §4.3.1).

**Both inputs to the score are measured by the server, not reported by the client.** The stage is the number of `reveal_at` timestamps at or before `received_at` (at least 1) — the same computation the client makes locally, but from the server's clock. The elapsed time is `received_at - started_at`. A player who claims to have answered at stage 1 gets the stage the server says they answered at. The cost is that a slow network can cost a player a stage or a fraction of the time factor; the benefit is that no client can forge a 7,500-point answer.

### 5.3 `sync_room_state`

An RPC, not an Edge Function — it needs nothing the client cannot read, and a function would only add a round trip to the network for no gain.

**In:** `{ room_id }` with the caller's JWT. **Out:** everything a reconnecting client needs — status, the current round, the schedule, which stages are revealed now, the player's own prior answer, the answered count and the leaderboard — and nothing about the target of an open round.

### 5.4 Shared code

`supabase/functions/_shared/` holds the Supabase client factory, the pool loader and the plan projection — the code that turns a composed round into the client-visible row. It is written so the same projection can be unit-tested in Node.

---

## 6. The client

### 6.1 New modules

- **`client/src/supabase.js`** — the Supabase client factory and the config loader.
- **`client/src/room.js`** — the room client: sign-in, the realtime subscription, the RPC calls, the poll, and the room state. This is the only module that knows Supabase exists.
- **`client/src/config.js`** — the project URL and anon key. Public by definition. `npm run supabase:sync` rewrites it from `supabase status`; the hosted project's values are written once, by hand.

### 6.2 The store

The store grows a `room` slice:

```js
state.room = {
  id, code, status, scope, players: [], leaderboard: [],
  round: null,           // the server's current round
  startedAt,             // the server's absolute started_at
  myAnswer: null,
  connected: false,
}
```

`store.currentRound()` returns `state.room.round` when a room is active and the local plan's round otherwise. `store.state.quiz.rounds.length` becomes "of 10" from `room.total_rounds` in room mode.

**Solo mode keeps its current behaviour untouched.**

### 6.3 The screens that change

| Screen | Change |
|---|---|
| **home** | two new doors: create a room, join a room |
| **lobby** | real player list, the host's start button calls `start-room`, the code is copyable |
| **round** | in room mode, the round and the schedule come from the server; the answer is posted and the score comes back from the server |
| **reveal** | in room mode, the target comes from `round_result` |
| **results** | in room mode, the leaderboard comes from the server |

The round screen's existing structure survives: the ladder, the clue cards and the options are still built once, and the 100ms timer only updates text and class names. In room mode the timer counts down to the server's `deadline_at` instead of a local 20 seconds.

### 6.4 The pool is loaded lazily

`store.init()` no longer fetches the 3.7MB pool. It is fetched the first time the player opens the vibe screen, because that is where the pool is needed — the vibe cards show how many players a scope resolves to, and the solo engine needs the players themselves. A player who joins a room by code and never browses the vibes never downloads it.

---

## 7. Failure modes

| Failure | Handling |
|---|---|
| The host leaves mid-game | The server is the clock, so rounds continue. The host role moves to the longest-tenured remaining member on the next `leave_room`. |
| Two players share a display name | `display_name` is not unique. The leaderboard disambiguates by join order: "Alex", "Alex #2". |
| An answer arrives after the round closed | Refused by the server on `closed_at is null and now() <= deadline_at`. No row is written. A packet in flight before the close but arriving after is treated as late — fair, because the server's clock is authoritative. |
| A phone sleeps or is backgrounded | On wake, `visibilitychange` reconnects, calls `sync_room_state`, and resumes rendering. It can still answer if the round is open. An answer sent before the sleep is durable server-side. No pause for one phone — a missed round scores 0. |
| A network partition | The client buffers the answer and retries on reconnect. The unique constraint makes the retry idempotent. If the round closed meanwhile the retry is refused, which is correct. |
| Realtime is degraded | The 2-second poll keeps the game playable: it returns the current round and advances the room when a round is over. The poll is the same mechanism in both cases, so there is no separate fallback path. |
| The player's network is down at the moment a round starts | They see the round when they reconnect, already partly revealed. Their score suffers. The room does not wait. |
| An Edge Function times out | The client retries the idempotent call. `submit-answer` is idempotent by constraint; `start-room` is idempotent because it refuses to run on a room that is no longer `lobby`. |
| A duplicate join | The unique constraint on `(room_id, user_id)` rejects it; the RPC returns the existing membership. |

---

## 8. Testing

| Layer | Approach |
|---|---|
| Plan projection | Node unit test over the composed plan → the client-visible row. Asserts the row carries no answer and no `correct` flag. |
| Room client helpers | Node unit test over the code parsing, the config loader and the state merge. |
| RLS | Integration test against the local stack: a member can read `rounds` and `answers`; **cannot** read `quiz_plans` or `round_secrets`; cannot read another room's rows; cannot insert an `answers` row directly. |
| The game loop | Integration test against the local stack: two users join, the host starts, round 1 is materialised with a secret, a direct answer before the deadline is refused, `submit-answer` scores it, the advance materialises round 2. |
| Two browsers | Playwright, two browser contexts in one room: both see the same round, both reveal the same clue at the same moment, one scores, the leaderboard updates, a refresh rejoins with the score intact. |

Integration tests skip when the local stack is not running, so `npm test` stays green on a machine without Docker.

---

## 9. What is deliberately not built

- **A difficulty picker.** The column exists; the value is always `medium`. Choosing is Phase 5's job.
- **Custom scopes in a room.** The host picks from the presets. Custom scopes need the builder, and the builder is Phase 5.
- **Mid-game joining, rematches, private rooms, chat, spectator mode.**
- **A SQL port of the scoring rules.** The Edge Function imports the engine's module.
- **A `game_scopes` table.** A room snapshots the scope's clauses at create time; the table arrives with Phase 5, when scopes become shareable objects.
- **Hosted deployment as part of this phase.** The local stack is the target; the hosted project is the same migrations plus `supabase functions deploy` and a Storage upload. Written as a short README, not automated.

---

## 10. Prerequisites

1. **A free Supabase project**, with **anonymous sign-ins enabled** (Authentication → Providers → Anonymous). The local Docker stack covers development; the hosted project is for play across networks.
2. **The local stack running** for development and for the integration tests: `npx supabase start` (Docker).
3. **The pool uploaded to Storage**: `npm run fixtures` regenerates `data/fixtures/pool.sample.json` from the database, and `npm run supabase:upload` uploads it to the `pool` bucket as `pool.json`.

---

## 11. The file list this phase adds

```
supabase/
  config.toml
  migrations/0001_room.sql          -- tables, RLS, functions
  functions/_shared/{pool,project,room}.ts
  functions/start-room/index.ts
  functions/submit-answer/index.ts
  functions/sync-room/index.ts
js/presets.js                        -- moved out of client/src/pool.js, shared with the server
client/src/{supabase,room,config}.js
client/src/pool.js                   -- edited: re-exports the presets
client/src/screens/{home,lobby,round,reveal,results}.js   -- edited
tests/integration/room.test.js
tests/client/room.spec.js
scripts/supabase-sync.js             -- writes client/src/config.js from `supabase status`
scripts/upload-pool.js               -- uploads data/fixtures/pool.sample.json to Storage
```

---

## 12. Divergences from the v1 spec's §7

Recorded so nobody reads §7 and thinks the code is wrong.

1. **`round_secrets` holds an `answer_value` string, and `answers` holds a `guessed_answer` string.** §7 modelled the `identify` template only. The engine now ships `stat_value` too, whose answer is a number.
2. **The `rounds` row carries the prompt, the context, the clues and the option labels.** §7's `rounds` had `clue_order` and `reveal_schedule` only, because the options were not in the table. They have to be somewhere the client can read, and they must not carry the answer.
3. **There is no `pg_cron` job.** §7 implied a server-driven clock that advances rooms on its own. The advance is driven by the client's 2-second poll instead, which also serves as the Realtime-degraded fallback. A room therefore only advances while somebody is watching — see §4.5 for why that is the better trade.

Everything else in §7 — the table list, the RLS intent, the one-round-at-a-time materialisation, the late-join refusal, the reconnect contract, the failure-mode table — holds.

### 12.1 One more divergence, found while planning

**§4.3.1: an open round's answers are not readable by members, and a score becomes visible when its round closes rather than when it is earned.**

§7 says "answers — SELECT: room members". Taken literally, the first player to answer correctly reveals the answer to the whole room, because the row carries both `guessed_answer` and `is_correct`. The spec's own promise — no client learns the answer before the round resolves — wins over the literal policy, so the read is narrowed to closed rounds, and the score aggregation moved to the moment the round closes.
