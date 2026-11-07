# The Collective Groan and Question Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship The Collective Groan reaction strip and the room question-report loop, without changing scoring, the round clock, the planner, solo play, or any edge function.

**Architecture:** One migration adds `round_reactions` and `round_reports`, two security-definer write RPCs, a service-role review view, and a replacement `sync_room_state` that piggybacks reactions on the existing two-second poll. The client folds the new payload keys into the room state, renders a three-chip strip on the closed-round reveal, and opens a native `<dialog>` report form mounted on `document.body` so the poll cannot steal focus. Reactions cascade with their round; reports freeze the question in a JSON snapshot and survive a rematch.

**Tech Stack:** Plain ES modules, Node's test runner, Supabase Postgres + PostgREST, Playwright, no new dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-11-07-collective-groan-and-question-reports-design.md`

## Global Constraints

- One migration only: `20261107000100_reactions_and_reports.sql`. No engine change and no edge-function change.
- Reactions are room-only, named, one per player per round, first tap wins, no points, no effect interaction.
- Reports are room-only, one per player per round, reasons `ambiguous` / `two_answers` / `looks_wrong` / `other`, optional note capped at 280 characters after trimming.
- Reactions are shown only for a closed round. The server checks `closed_at is not null or now() > deadline_at` before a reaction or report.
- Reactions cascade-delete with their round. Reports keep a frozen snapshot and lose only `round_id` on a rematch.
- No new timer, realtime subscription, or edge function. Reactions ride the existing `sync_room_state` poll.
- The `sync_room_state` replacement must use the latest signature and body from `supabase/migrations/20261101000100_press_your_luck.sql`: `sync_room_state(p_room_id uuid, p_on_demand boolean default false)`, and it must keep `response_time_ms` in `my_answer`.
- The review view `question_reports` is service-role only: revoke `public`, `anon`, and `authenticated`; grant `service_role`.
- The report dialog is a native `<dialog>` mounted on `document.body`, outside the re-rendered `#app` root.
- Apply the production migration **before** pushing the client. Do not run `npm run supabase:deploy`; no function changed.
- Commit after every task. Do not squash tasks.
- `client/src/config.js` is committed pointing at production. Local runs write local values with `npm run supabase:sync`; restore the committed file before committing.
- No fabricated football data. The snapshot copies whatever the round already holds.

## Test Environment

The local stack is required for integration and Playwright work.

```bash
npm run supabase:start          # once per machine
npm run supabase:reset          # applies every migration; clears the Storage pool
npm run supabase:upload         # puts the player pool back
npm run supabase:serve          # leave running in another terminal, port 54399
npm run supabase:sync           # writes the local Supabase values into client/src/config.js
```

Restart `npm run supabase:serve` after any change under `supabase/functions/` or `js/engine/`. This plan changes neither.

Before a commit that touches `client/src/config.js`, restore the hosted values:

```bash
git checkout -- client/src/config.js
```

If `.env.local` is present and the hosted config should be regenerated instead:

```bash
set -a
. ./.env.local
set +a
npm run supabase:sync
git diff --exit-code client/src/config.js
```

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261107000100_reactions_and_reports.sql` | Tables, RLS, `react_to_round`, `report_round`, `question_reports`, replacement `sync_room_state`. |
| `tests/integration/reactions.test.js` | Server rules: close gating, idempotency, snapshot, rematch survival, service-role-only view. |
| `client/src/room-state.js` | `applyReactions`, `reactionName`, and lobby clearing of reaction/report state. |
| `client/src/room.js` | `reactionsRound` / `reactions` / `reportedRound`, payload folding, `react()`, `reportQuestion()`, friendly errors. |
| `client/src/screens/reveal.js` | Reaction strip, report link, native report dialog, room error notice. |
| `client/styles/screens/reveal.css` | Reaction-chip, report-link, and dialog styles. |
| `tests/shared/room-state.test.js` | Pure folding, lobby reset, and fallback-name tests. |
| `tests/client/room.spec.js` | Two-player reactions, next-round strip persistence, report dialog survival, report row check. |

## Review Focus

1. A reaction before the round closes must be refused, and `sync_room_state` must return an empty reaction list while the round is open. Task 1 tests: `a reaction is refused while the round is open and stored after the deadline` and `sync shows reactions only after the round closes`.
2. A player who leaves the room must keep their name under a reaction. Task 1 test: `a reaction keeps its name after the player leaves the room`; Task 2 test: `a reaction name follows the live room and falls back to the stored name`.
3. The reveal's reaction strip and report link must key off the fetched result (`result`), not `showResult`. `applyRound` nulls `answeredRound` when the next round starts but keeps `lastResult`, so a `showResult` gate would make reactions vanish while the player is still reading the closed round. Task 3 test: `the reaction strip stays on the closed round when the next round starts`.
4. The report dialog must survive the two-second redraw with its note intact. Task 4 test: the six-second wait, then `#report-note` still has its value.
5. A rematch must delete reactions, keep reports, null the old report's `round_id`, and accept a new report in the fresh game. Task 1 test: `a report survives a rematch and a fresh report is accepted`.
6. A failed report must keep the dialog open with its reason and note, and show the error inside the dialog. The dialog owns that error; `room.reportQuestion()` returns `{ ok, message }` and does not write `state.error` for report failures.
7. `sync_room_state` must stay backward compatible: same signature, same `my_answer` keys, additive `reactions_round` / `reactions` keys. The existing "reveal does not hammer the server" test stays green.

---

### Task 1: Database migration, RPCs, view, and sync payload

**Files:**
- Create: `supabase/migrations/20261107000100_reactions_and_reports.sql`
- Create: `tests/integration/reactions.test.js`
- Read: `supabase/migrations/20261101000100_press_your_luck.sql` (the latest `sync_room_state`)
- Read: `supabase/migrations/20261101000200_game_mode.sql` (`current_round`, `round_result`, `create_room`)

**Interfaces:**
- Consumes: `public.is_room_member(uuid)`, `public.rounds`, `public.round_secrets`, `public.rooms`, `public.room_memberships`, `public.answers`.
- Produces: `public.react_to_round(uuid, int, text) returns jsonb`, `public.report_round(uuid, int, text, text) returns jsonb`, `public.question_reports` view, and two new `sync_room_state` keys: `reactions_round` (int or null) and `reactions` (array of `{ user_id, display_name, reaction }`).

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/reactions.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

const CLUES = [{ id: 'club-goals', label: 'The season', value: '2015/16' }];
const OPTIONS = [
  { label: 'Sevilla', value: 'sevilla' },
  { label: 'Valencia', value: 'valencia' },
];
const REVEAL = {
  format: 'club',
  club: 'Sevilla',
  season: '2015/16',
  player: { name: 'Joaquín' },
  league: 'La Liga',
  goals: 3,
};

/** A room with one directly-inserted round, as the effects tests do. */
async function setupRoom({ players = 2, deadlineMs = 60000, totalRounds = 10 } = {}) {
  const host = await playerClient();
  const { data: room, error } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    p_scope_clauses: [],
    p_display_name: 'Alex',
    p_scope_name: 'World Cup 2022',
    p_game_mode: 'football_iq',
  });
  assert.equal(error, null, error?.message);

  const made = [{ ...host, name: 'Alex' }];
  const names = ['Sam', 'Robin'];
  for (let i = 1; i < players; i++) {
    const p = await playerClient();
    const joined = await p.client.rpc('join_room', {
      p_code: room.code,
      p_display_name: names[i - 1],
    });
    assert.equal(joined.error, null, joined.error?.message);
    made.push({ ...p, name: names[i - 1] });
  }

  const server = serverClient();
  if (totalRounds !== 10) {
    const { error: roundsError } = await server.from('rooms')
      .update({ total_rounds: totalRounds })
      .eq('id', room.id);
    assert.equal(roundsError, null, roundsError?.message);
  }

  const { data: round, error: roundError } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'club',
    prompt: 'Which club did Joaquín join in 2015/16?',
    context: 'La Liga',
    clues: CLUES,
    options: OPTIONS,
    reveal_schedule: [{ stage: 1, revealAtMs: 500 }],
    clue_family: null,
    started_at: new Date(Date.now() - 1000).toISOString(),
    deadline_at: new Date(Date.now() + deadlineMs).toISOString(),
  }).select().single();
  assert.equal(roundError, null, roundError?.message);

  const { error: secretError } = await server.from('round_secrets').insert({
    round_id: round.id,
    answer_value: 'Sevilla',
    unit: null,
    reveal: REVEAL,
  });
  assert.equal(secretError, null, secretError?.message);

  const { error: roomError } = await server.from('rooms').update({
    status: 'round_active',
    current_round: 1,
  }).eq('id', room.id);
  assert.equal(roomError, null, roomError?.message);

  return { room, round, players: made, server, host };
}

async function addAnswer(server, room, round, player, {
  correct = true,
  points = 7500,
  guessed = 'Sevilla',
  ms = 1000,
} = {}) {
  const { error } = await server.from('answers').insert({
    room_id: room.id,
    round_id: round.id,
    user_id: player.userId,
    guessed_answer: guessed,
    is_correct: correct,
    stage_locked: 1,
    response_time_ms: ms,
    points_earned: correct ? points : 0,
  });
  assert.equal(error, null, error?.message);
}

async function expireRound(server, round) {
  const { error } = await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', round.id);
  assert.equal(error, null, error?.message);
}

/** Ask the server to advance; it closes the round when the clock says so. */
async function closeRound(player, roomId) {
  const { data, error } = await player.client.rpc('current_round', {
    p_room_id: roomId,
  });
  assert.equal(error, null, error?.message);
  return data;
}

function react(player, roomId, roundNumber, reaction) {
  return player.client.rpc('react_to_round', {
    p_room_id: roomId,
    p_round_number: roundNumber,
    p_reaction: reaction,
  });
}

function report(player, roomId, roundNumber, reason, note = null) {
  return player.client.rpc('report_round', {
    p_room_id: roomId,
    p_round_number: roundNumber,
    p_reason: reason,
    p_note: note,
  });
}

test('a reaction is refused while the round is open and stored after the deadline', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await addAnswer(server, room, round, alex);

  const early = await react(alex, room.id, 1, 'knew_it');
  assert.match(early.error.message, /the round is still open/);

  await expireRound(server, round);
  const late = await react(alex, room.id, 1, 'knew_it');
  assert.equal(late.error, null, late.error?.message);
  assert.equal(late.data.ok, true);
  assert.equal(late.data.reaction, 'knew_it');

  const { data: rows } = await server.from('round_reactions')
    .select('*')
    .eq('round_id', round.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, alex.userId);
  assert.equal(rows[0].display_name, 'Alex');
  assert.equal(rows[0].reaction, 'knew_it');
});

test('a duplicate reaction returns the first choice and does not change it', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await expireRound(server, round);

  const first = await react(alex, room.id, 1, 'fair_play');
  assert.equal(first.error, null, first.error?.message);

  const second = await react(alex, room.id, 1, 'no_chance');
  assert.equal(second.error, null, second.error?.message);
  assert.equal(second.data.reaction, 'fair_play');

  const { data: rows } = await server.from('round_reactions')
    .select('reaction')
    .eq('round_id', round.id);
  assert.deepEqual(rows, [{ reaction: 'fair_play' }]);
});

test('a non-member and an unknown reaction are refused', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await expireRound(server, round);

  const stranger = await playerClient();
  const outsider = await react(stranger, room.id, 1, 'knew_it');
  assert.match(outsider.error.message, /not a member of that room/);

  const unknown = await react(alex, room.id, 1, 'bored');
  assert.match(unknown.error.message, /unknown reaction/);
});

test('sync shows reactions only after the round closes and only to a player who revealed it', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await addAnswer(server, room, round, alex);

  const open = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(open.error, null, open.error?.message);
  assert.equal(open.data.reactions_round, 1);
  assert.deepEqual(open.data.reactions, []);

  await expireRound(server, round);
  await closeRound(alex, room.id);

  const first = await react(alex, room.id, 1, 'knew_it');
  assert.equal(first.error, null, first.error?.message);
  const second = await react(sam, room.id, 1, 'no_chance');
  assert.equal(second.error, null, second.error?.message);

  const closed = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(closed.error, null, closed.error?.message);
  assert.equal(closed.data.reactions_round, 1);
  assert.deepEqual(
    closed.data.reactions.map((r) => [r.display_name, r.reaction]).sort(),
    [['Alex', 'knew_it'], ['Sam', 'no_chance']],
  );

  const watcher = await sam.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(watcher.error, null, watcher.error?.message);
  assert.equal(watcher.data.reactions_round, null);
  assert.deepEqual(watcher.data.reactions, []);
});

test('a thief with a placeholder answer still gets reactions for that round', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const steal = await sam.client.rpc('use_room_effect', {
    p_room_id: room.id,
    p_round_number: 1,
    p_kind: 'steal',
    p_target_user_id: alex.userId,
  });
  assert.equal(steal.error, null, steal.error?.message);

  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const seen = await sam.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(seen.error, null, seen.error?.message);
  assert.equal(seen.data.reactions_round, 1);

  const reacted = await react(alex, room.id, 1, 'fair_play');
  assert.equal(reacted.error, null, reacted.error?.message);

  const after = await sam.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(after.error, null, after.error?.message);
  assert.deepEqual(after.data.reactions.map((r) => r.display_name), ['Alex']);
});

test('a reaction keeps its name after the player leaves the room', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const made = await react(sam, room.id, 1, 'no_chance');
  assert.equal(made.error, null, made.error?.message);

  const left = await sam.client.rpc('leave_room', { p_room_id: room.id });
  assert.equal(left.error, null, left.error?.message);

  const seen = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(seen.error, null, seen.error?.message);
  assert.deepEqual(seen.data.reactions.map((r) => r.display_name), ['Sam']);
});

test('a report stores the reason, trimmed note and the frozen question', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const made = await report(alex, room.id, 1, 'ambiguous', '  Too many Messis  ');
  assert.equal(made.error, null, made.error?.message);

  const { data: rows, error } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(error, null, error?.message);
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.round_id, round.id);
  assert.equal(row.round_number, 1);
  assert.equal(row.user_id, alex.userId);
  assert.equal(row.reason, 'ambiguous');
  assert.equal(row.note, 'Too many Messis');
  assert.equal(row.question.game_mode, 'football_iq');
  assert.equal(row.question.format, 'club');
  assert.equal(row.question.clue_family, null);
  assert.equal(row.question.prompt, 'Which club did Joaquín join in 2015/16?');
  assert.equal(row.question.context, 'La Liga');
  assert.deepEqual(row.question.clues, CLUES);
  assert.deepEqual(row.question.options, OPTIONS);
  assert.equal(row.question.answer, 'Sevilla');
  assert.equal(row.question.unit, null);
  assert.deepEqual(row.question.reveal, REVEAL);
  assert.equal(row.question.scope_id, 'wc-2022');
  assert.equal(row.question.scope_name, 'World Cup 2022');
  assert.deepEqual(row.question.scope_clauses, []);
});

test('a report rejects bad input and a duplicate is a no-op', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await expireRound(server, round);

  const unknown = await report(alex, room.id, 1, 'boring');
  assert.match(unknown.error.message, /unknown reason/);

  const long = await report(alex, room.id, 1, 'other', 'x'.repeat(281));
  assert.match(long.error.message, /note is too long/);

  const empty = await report(alex, room.id, 1, 'other', '   ');
  assert.equal(empty.error, null, empty.error?.message);

  const first = await report(sam, room.id, 1, 'two_answers', 'both are right');
  assert.equal(first.error, null, first.error?.message);
  const duplicate = await report(sam, room.id, 1, 'looks_wrong', 'changed my mind');
  assert.equal(duplicate.error, null, duplicate.error?.message);

  const { data: rows } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(rows.length, 2);

  const alexRow = rows.find((r) => r.user_id === alex.userId);
  const samRow = rows.find((r) => r.user_id === sam.userId);
  assert.equal(alexRow.note, null);
  assert.equal(samRow.reason, 'two_answers');
  assert.equal(samRow.note, 'both are right');
});

test('a report survives a rematch and a fresh report is accepted', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ totalRounds: 1 });
  const [alex] = players;
  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const made = await report(alex, room.id, 1, 'looks_wrong', 'the answer is wrong');
  assert.equal(made.error, null, made.error?.message);

  const reset = await alex.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);

  const { data: kept } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].round_id, null);
  assert.equal(kept[0].question.prompt, 'Which club did Joaquín join in 2015/16?');

  const { data: nextRound, error: nextError } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'club',
    prompt: 'A new question?',
    context: null,
    clues: [],
    options: [],
    reveal_schedule: [],
    clue_family: null,
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() - 1000).toISOString(),
  }).select().single();
  assert.equal(nextError, null, nextError?.message);

  const { error: secretError } = await server.from('round_secrets').insert({
    round_id: nextRound.id,
    answer_value: 'Sevilla',
  });
  assert.equal(secretError, null, secretError?.message);

  const { error: roomError } = await server.from('rooms').update({
    status: 'round_active',
    current_round: 1,
  }).eq('id', room.id);
  assert.equal(roomError, null, roomError?.message);

  const fresh = await report(alex, room.id, 1, 'other', 'new game');
  assert.equal(fresh.error, null, fresh.error?.message);

  const { data: both } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(both.length, 2);
  assert.equal(both.filter((r) => r.round_id === nextRound.id).length, 1);
});

test('clients cannot read the tables or the review view directly', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await expireRound(server, round);
  await react(alex, room.id, 1, 'knew_it');
  await report(alex, room.id, 1, 'ambiguous', 'nope');

  const reactions = await alex.client.from('round_reactions').select('*');
  assert.equal(reactions.error, null);
  assert.deepEqual(reactions.data, []);

  const reports = await alex.client.from('round_reports').select('*');
  assert.equal(reports.error, null);
  assert.deepEqual(reports.data, []);

  const view = await alex.client.from('question_reports').select('*');
  assert.ok(view.error, 'the review view is not readable by a player');

  const serviceView = await server.from('question_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(serviceView.error, null, serviceView.error?.message);
  assert.equal(serviceView.data.length, 1);
  assert.equal(serviceView.data[0].reason, 'ambiguous');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npm run supabase:reset
node --test tests/integration/reactions.test.js
```

Expected: FAIL. The first call to `react_to_round` fails because the function does not exist yet (`Could not find the function public.react_to_round`).

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/20261107000100_reactions_and_reports.sql`:

```sql
-- The Collective Groan and question reports.
--
-- Reactions are social and ephemeral: one per player per round, shown
-- only after the round closes, deleted with the round on a rematch.
--
-- Reports are evidence: the question is frozen at report time, so a
-- rematch can delete the round and keep the report. Both tables are
-- written through security-definer RPCs and read only through
-- sync_room_state or the service role. No client policy exists.

create table if not exists public.round_reactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,
  reaction text not null check (reaction in ('knew_it', 'no_chance', 'fair_play')),
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);
create index if not exists round_reactions_round_idx
  on public.round_reactions (round_id);

alter table public.round_reactions enable row level security;

create table if not exists public.round_reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete set null,
  user_id uuid not null references auth.users(id),
  round_number int not null,
  reason text not null check (reason in ('ambiguous', 'two_answers', 'looks_wrong', 'other')),
  note text check (note is null or char_length(note) <= 280),
  question jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists round_reports_once
  on public.round_reports (round_id, user_id)
  where round_id is not null;
create index if not exists round_reports_created_idx
  on public.round_reports (created_at desc);

alter table public.round_reports enable row level security;

create or replace function public.react_to_round(
  p_room_id uuid,
  p_round_number int,
  p_reaction text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds;
  v_existing public.round_reactions;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  if p_reaction is null or p_reaction not in ('knew_it', 'no_chance', 'fair_play') then
    raise exception 'unknown reaction' using errcode = '22023';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;

  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    raise exception 'the round is still open' using errcode = '22023';
  end if;

  select * into v_existing
  from public.round_reactions
  where round_id = v_round.id and user_id = auth.uid();

  if v_existing.id is null then
    select m.display_name into v_name
    from public.room_memberships m
    where m.room_id = p_room_id and m.user_id = auth.uid();

    insert into public.round_reactions (
      room_id, round_id, user_id, display_name, reaction
    ) values (
      p_room_id, v_round.id, auth.uid(), coalesce(v_name, 'Player'), p_reaction
    )
    on conflict (round_id, user_id) do nothing;

    select * into v_existing
    from public.round_reactions
    where round_id = v_round.id and user_id = auth.uid();
  end if;

  return jsonb_build_object(
    'ok', true,
    'round_number', p_round_number,
    'reaction', v_existing.reaction
  );
end;
$$;

create or replace function public.report_round(
  p_room_id uuid,
  p_round_number int,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds;
  v_secret public.round_secrets;
  v_room public.rooms;
  v_note text;
  v_question jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  if p_reason is null or p_reason not in ('ambiguous', 'two_answers', 'looks_wrong', 'other') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 280 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;

  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    raise exception 'the round is still open' using errcode = '22023';
  end if;

  select * into v_secret from public.round_secrets where round_id = v_round.id;
  select * into v_room from public.rooms where id = p_room_id;

  v_question := jsonb_build_object(
    'game_mode', v_room.game_mode,
    'format', v_round.template,
    'clue_family', v_round.clue_family,
    'prompt', v_round.prompt,
    'context', v_round.context,
    'clues', v_round.clues,
    'options', v_round.options,
    'answer', v_secret.answer_value,
    'unit', v_secret.unit,
    'reveal', v_secret.reveal,
    'scope_id', v_room.scope_id,
    'scope_name', v_room.scope_name,
    'scope_clauses', v_room.scope_clauses
  );

  insert into public.round_reports (
    room_id, round_id, user_id, round_number, reason, note, question
  ) values (
    p_room_id, v_round.id, auth.uid(), p_round_number, p_reason, v_note, v_question
  )
  on conflict (round_id, user_id) where round_id is not null do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace view public.question_reports as
select
  r.created_at,
  r.room_id,
  r.round_number,
  r.user_id,
  r.reason,
  r.note,
  r.question->>'game_mode' as game_mode,
  r.question->>'format' as format,
  r.question->>'clue_family' as clue_family,
  r.question->>'scope_name' as scope_name,
  r.question->>'scope_id' as scope_id,
  r.question->>'prompt' as prompt,
  r.question->>'context' as context,
  r.question->>'answer' as answer,
  r.question->>'unit' as unit,
  r.question->'clues' as clues,
  r.question->'options' as options,
  r.question->'reveal' as reveal
from public.round_reports r
order by r.created_at desc;

revoke all on public.question_reports from public, anon, authenticated;
grant select on public.question_reports to service_role;

-- The latest definition is in 20261101000100_press_your_luck.sql. This
-- replacement keeps its signature and every existing key, and adds the
-- reaction keys.
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
  v_reactions jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', x.user_id,
      'display_name', coalesce(m.display_name, x.display_name),
      'reaction', x.reaction
    ) order by x.created_at, x.id), '[]'::jsonb)
  into v_reactions
  from public.round_reactions x
  join public.rounds r on r.id = x.round_id
  left join public.room_memberships m
    on m.room_id = x.room_id and m.user_id = x.user_id
  where x.room_id = p_room_id
    and r.round_number = v_answered_round
    and (r.closed_at is not null or now() > r.deadline_at);

  return v_state || jsonb_build_object(
    'my_answered_round', v_answered_round,
    'my_answer', v_mine,
    'my_effects', v_effects,
    'reactions_round', v_answered_round,
    'reactions', v_reactions,
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

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Reset the database and run the new tests**

```bash
npm run supabase:reset
node --test tests/integration/reactions.test.js
```

Expected: PASS, every test either passes or skips only when the stack is down (it is up).

- [ ] **Step 5: Run the existing DB-only room suites**

```bash
node --test tests/integration/effects.test.js
```

Expected: PASS. The effects suite uses the same direct room setup and must keep its behaviour. The `room` and `rematch` suites use the edge functions and run in Task 5.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261107000100_reactions_and_reports.sql \
        tests/integration/reactions.test.js \
        docs/superpowers/specs/2026-11-07-collective-groan-and-question-reports-design.md \
        docs/superpowers/plans/2026-11-07-collective-groan-and-question-reports.md
git commit -m "feat(db): add round reactions and question reports"
```

Expected: one commit with the migration, the integration test, the approved spec, and this plan.

---

### Task 2: Pure room state and client API

**Files:**
- Modify: `client/src/room-state.js` (add `applyReactions`, `reactionName`, lobby resets)
- Modify: `client/src/room.js` (state fields, payload folding, `react`, `reportQuestion`, friendly errors)
- Modify: `tests/shared/room-state.test.js` (new tests)

**Interfaces:**
- Consumes: the `sync_room_state` payload keys from Task 1.
- Produces:
  - `applyReactions(state, payload)` where `payload` may have `reactions_round` and `reactions`. Missing keys leave the state alone; present keys replace it.
  - `reactionName(state, reaction)` returns the live `labelFor` name, or the stored `display_name` when the player is no longer in the room.
  - `room.react(roundNumber, reaction)` returns the RPC data or `null`.
  - `room.reportQuestion(roundNumber, reason, note)` returns `{ ok: true }` or `{ ok: false, message }`.

- [ ] **Step 1: Write the failing shared tests**

In `tests/shared/room-state.test.js`, replace the import line with:

```js
import {
  applyRound,
  applyMembers,
  applyLeaderboard,
  applyEffects,
  applyReactions,
  labelFor,
  reactionName,
} from '../../client/src/room-state.js';
```

Append these tests at the end of the file:

```js
test('reactions are folded in with the round they belong to', () => {
  const state = {};
  applyReactions(state, {
    reactions_round: 3,
    reactions: [{ user_id: 'a', display_name: 'Alex', reaction: 'knew_it' }],
  });
  assert.equal(state.reactionsRound, 3);
  assert.equal(state.reactions.length, 1);
  assert.equal(state.reactions[0].reaction, 'knew_it');
});

test('a lobby reset clears reactions and the reaction round', () => {
  const state = {
    round: { round_number: 1 },
    reactionsRound: 1,
    reactions: [{ user_id: 'a', reaction: 'knew_it' }],
    reportedRound: 1,
  };
  applyRound(state, {
    status: 'lobby',
    current_round: 0,
    total_rounds: 10,
    round: null,
  });
  assert.equal(state.reactionsRound, null);
  assert.deepEqual(state.reactions, []);
  assert.equal(state.reportedRound, null);
});

test('a new game round one clears a stale report state', () => {
  const state = {
    round: { id: 'old', round_number: 10 },
    answeredRound: 10,
    reportedRound: 10,
    lastResult: { round_number: 10 },
  };
  applyRound(state, {
    current_round: 1,
    round: { id: 'new', round_number: 1 },
  });
  assert.equal(state.reportedRound, null);
});

test('a payload without reaction keys leaves the reactions alone', () => {
  const state = {
    reactionsRound: 2,
    reactions: [{ user_id: 'a', reaction: 'fair_play' }],
  };
  applyReactions(state, { my_answered_round: 2 });
  assert.equal(state.reactionsRound, 2);
  assert.equal(state.reactions[0].reaction, 'fair_play');
});

test('a reaction name follows the live room and falls back to the stored name', () => {
  const state = {
    members: [
      { user_id: 'a', joined_seq: 1, display_name: 'Alex' },
      { user_id: 'b', joined_seq: 2, display_name: 'Alex' },
    ],
    leaderboard: [],
  };
  assert.equal(
    reactionName(state, { user_id: 'b', display_name: 'Alex', reaction: 'knew_it' }),
    'Alex #2',
  );
  assert.equal(
    reactionName(state, { user_id: 'gone', display_name: 'Sam', reaction: 'no_chance' }),
    'Sam',
  );
});
```

- [ ] **Step 2: Run the shared tests and confirm they fail**

```bash
node --test tests/shared/room-state.test.js
```

Expected: FAIL. `applyReactions` and `reactionName` are not exported.

- [ ] **Step 3: Implement the pure state**

In `client/src/room-state.js`, add these lines to the lobby reset block inside `applyRound`:

```js
    state.reactionsRound = null;
    state.reactions = [];
    state.reportedRound = null;
```

In the next-round transition inside `applyRound` (the `if (next && state.round && !sameRound)` block), clear a report from the old game when the new payload is round one:

```js
    state.myAnswer = null;
    state.answeredRound = null;
    state.lastResult = keep;
    state.fetchingResult = false;
    if (next.round_number === 1) state.reportedRound = null;
```

Add after `applyEffects`:

```js
/**
 * Fold the caller's reactions in. The room poll carries the reaction
 * round even when the list is empty, so a present key is authoritative.
 * A payload without the keys (an older server) leaves the state alone.
 */
export function applyReactions(state, payload) {
  if (payload?.reactions_round !== undefined) {
    state.reactionsRound = payload.reactions_round ?? null;
  }
  if (payload?.reactions !== undefined) {
    state.reactions = [...(payload.reactions ?? [])];
  }
  return state;
}
```

Add after `labelFor`:

```js
/**
 * What to call a player under a reaction.
 *
 * The live label keeps duplicate names consistent ("Alex #2"). A player
 * who left the room is gone from members and the leaderboard, so the
 * name stored on the reaction is the only one left.
 */
export function reactionName(state, reaction) {
  const known = [...(state.members ?? []), ...(state.leaderboard ?? [])]
    .some((m) => m.user_id === reaction.user_id);
  return known ? labelFor(state, reaction.user_id) : (reaction.display_name ?? 'Player');
}
```

- [ ] **Step 4: Add the room client state and API**

In `client/src/room.js`, update the import:

```js
import {
  applyRound,
  applyMembers,
  applyLeaderboard,
  applyEffects,
  applyReactions,
} from './room-state.js';
```

Add to the `state` object after `myEffects`:

```js
  reactionsRound: null,
  reactions: [],
  reportedRound: null,
```

In `applyPayload`, add after the effects line:

```js
  applyReactions(state, payload);
```

In `leave()`, add beside the other resets:

```js
    state.reactionsRound = null;
    state.reactions = [];
    state.reportedRound = null;
```

In `create()`, after `state.gameMode = ...`, add:

```js
    state.reactionsRound = null;
    state.reactions = [];
    state.reportedRound = null;
```

In `join()`, after `state.gameMode = ...`, add the same three lines.

Add these methods after `useEffect` and before `result`:

```js
  /**
   * One reaction per player per round. The server keeps the first tap;
   * a retry returns the stored choice. The local row makes the chip lock
   * immediately, before the next poll confirms it.
   */
  async react(roundNumber, reaction) {
    const supabase = await ensure();
    if (!supabase || !state.roomId) return null;
    const { data, error } = await supabase.rpc('react_to_round', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
      p_reaction: reaction,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.error = null;
    const stored = data?.reaction ?? reaction;
    const current = state.reactionsRound === roundNumber ? state.reactions : [];
    const me = state.members.find((m) => m.user_id === state.me);
    state.reactions = [
      ...current.filter((r) => r.user_id !== state.me),
      {
        user_id: state.me,
        display_name: me?.display_name ?? 'You',
        reaction: stored,
      },
    ];
    state.reactionsRound = roundNumber;
    notify();
    return data;
  },

  /**
   * One report per player per round. The dialog owns the error so it can
   * stay open with the player's reason and note intact; this method does
   * not write state.error for a failed report.
   */
  async reportQuestion(roundNumber, reason, note = '') {
    const supabase = await ensure();
    if (!supabase || !state.roomId) {
      return { ok: false, message: 'Multiplayer is unavailable right now.' };
    }
    const { error } = await supabase.rpc('report_round', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
      p_reason: reason,
      p_note: note ?? '',
    });
    if (error) return { ok: false, message: friendly(error.message) };
    state.reportedRound = roundNumber;
    state.error = null;
    notify();
    return { ok: true };
  },
```

Add these mappings to `friendly`, before the generic fallback:

```js
  if (m.includes('the round is still open')) return 'The result is not ready yet.';
  if (m.includes('unknown reaction')) return 'That reaction is not one we know.';
  if (m.includes('unknown reason')) return 'Pick a reason for the report.';
  if (m.includes('note is too long')) return 'That note is too long.';
  if (m.includes('no such round')) return 'That round is gone.';
```

- [ ] **Step 5: Run the shared tests**

```bash
node --test tests/shared/room-state.test.js
node --test tests/shared/*.test.js
```

Expected: PASS. The existing `applyRound` tests still pass; the new reaction tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/room-state.js client/src/room.js tests/shared/room-state.test.js
git commit -m "feat(client): track room reactions and question reports"
```

---

### Task 3: Reaction strip and Playwright

**Files:**
- Modify: `client/src/screens/reveal.js` (import `reactionName`, reaction strip, room error notice)
- Modify: `client/styles/screens/reveal.css` (reaction styles)
- Modify: `tests/client/room.spec.js` (two reaction tests)

**Interfaces:**
- Consumes: `roomState.reactionsRound`, `roomState.reactions`, `roomState.me`, `room.react()`, `reactionName()`.
- Produces: `#reactions` with three `[data-reaction]` buttons; each chip has `aria-pressed` and disables after the player's first tap.

- [ ] **Step 1: Write the failing Playwright tests**

Append these tests to `tests/client/room.spec.js`, after the existing room reveal tests:

```js
test('two players react to a closed round and both see both names', async ({ browser }) => {
  const { host, guest } = await roomWithOneRound(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);

  await expect(host.locator('#reactions')).toBeVisible({ timeout: 30000 });
  await expect(guest.locator('#reactions')).toBeVisible({ timeout: 30000 });

  await host.locator('[data-reaction="knew_it"]').click();
  await expect(host.locator('[data-reaction="knew_it"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(host.locator('[data-reaction="no_chance"]')).toBeDisabled();

  await guest.locator('[data-reaction="no_chance"]').click();
  await expect(guest.locator('[data-reaction="no_chance"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(guest.locator('[data-reaction="fair_play"]')).toBeDisabled();

  // The next polls carry the names across the room.
  await expect(host.locator('[data-reaction="no_chance"]')).toContainText('Sam', { timeout: 20000 });
  await expect(guest.locator('[data-reaction="knew_it"]')).toContainText('Host', { timeout: 20000 });

  expect(hostErrors).toEqual([]);
  expect(guestErrors).toEqual([]);
});

test('the reaction strip stays on the closed round when the next round starts', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);

  await expect(host.locator('#reactions')).toBeVisible({ timeout: 30000 });
  await host.locator('[data-reaction="knew_it"]').click();
  await expect(host.locator('[data-reaction="knew_it"]')).toHaveAttribute('aria-pressed', 'true');

  // Force a sync and let the room move on to round two. The reveal is
  // still showing round one, and its reactions must not disappear when
  // answeredRound is cleared for the new round.
  await expect.poll(async () => host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    await room.sync();
    return room.state.currentRound;
  }), { timeout: 30000 }).toBeGreaterThan(1);

  await expect(host.locator('.topbar')).toContainText('Round 1');
  await expect(host.locator('#reactions')).toBeVisible();
  await expect(host.locator('[data-reaction="knew_it"]')).toHaveAttribute('aria-pressed', 'true');

  // The player can still go on to the new round.
  await host.locator('#btn-next').click();
  await expect(host).toHaveURL(/#round/);
});
```

- [ ] **Step 2: Run the reaction tests and confirm they fail**

```bash
npx playwright test tests/client/room.spec.js -g "react"
```

Expected: FAIL. The reveal has no `#reactions` element.

- [ ] **Step 3: Implement the reaction strip**

In `client/src/screens/reveal.js`, update the room-state import:

```js
import { labelFor, reactionName } from '../room-state.js';
```

Add these constants and helper after `namesFor` (or before `renderRoom`):

```js
const REACTIONS = [
  { key: 'knew_it', label: 'Knew it' },
  { key: 'no_chance', label: 'No chance' },
  { key: 'fair_play', label: 'Fair play' },
];

/** The Collective Groan: one tap, and the room sees who felt what. */
function reactionStrip(roomState, roundNumber) {
  const rows = roomState.reactionsRound === roundNumber
    ? (roomState.reactions ?? [])
    : [];
  const mine = rows.find((r) => r.user_id === roomState.me);

  const chips = REACTIONS.map(({ key, label }) => {
    const names = rows
      .filter((r) => r.reaction === key)
      .map((r) => reactionName(roomState, r));
    const attrs = {
      type: 'button',
      'data-reaction': key,
      'aria-pressed': String(mine?.reaction === key),
    };
    if (mine) attrs.disabled = '';
    return el('button', {
      className: 'reaction-chip',
      attrs,
      on: {
        click: async () => {
          if (mine) return;
          sounds.click();
          await room.react(roundNumber, key);
        },
      },
    }, [
      el('span', { className: 'reaction-chip__label', text: label }),
      names.length
        ? el('span', { className: 'reaction-chip__names', text: names.join(', ') })
        : null,
    ]);
  });

  return el('section', { className: 'card reactions', attrs: { id: 'reactions' } }, [
    el('h2', { className: 'section-title', text: 'How did that feel?' }),
    el('div', { className: 'reaction-chips' }, chips),
  ]);
}
```

In `renderRoom`, after `const me = board.find(...)`, add:

```js
  // The result is the proof the round closed. Do not use showResult:
  // applyRound clears answeredRound when the next round starts, but it
  // keeps lastResult so the player can finish reading the closed round.
  const closedRound = Boolean(result);
```

In the `mount(root, [...])` array, add the room error notice after the topbar:

```js
    roomState.error
      ? el('p', {
        className: 'notice notice--warn',
        attrs: { id: 'room-error' },
      }, roomState.error)
      : null,
```

Add the reaction strip between `effectsCard` and the running score:

```js
    closedRound ? reactionStrip(roomState, roundNumber) : null,
```

The full order inside `mount` is: topbar, reveal card, verdict, IQ block, effects card, reaction strip, running score, report line (Task 4), next button.

- [ ] **Step 4: Add the reaction styles**

Append to `client/styles/screens/reveal.css`:

```css
/* The Collective Groan */
.reactions { text-align: center; }
.reactions .section-title { margin-bottom: 10px; }
.reaction-chips { display: flex; gap: 8px; }
.reaction-chip {
  flex: 1;
  min-width: 0;
  padding: 10px 8px;
  border: var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.reaction-chip:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.reaction-chip[aria-pressed="true"] { background: var(--highlight); box-shadow: var(--shadow); }
.reaction-chip:disabled { cursor: default; opacity: .72; }
.reaction-chip[aria-pressed="true"]:disabled { opacity: 1; }
.reaction-chip__names {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.reaction-chip[aria-pressed="true"] .reaction-chip__names { color: var(--ink); }
```

- [ ] **Step 5: Run the reaction tests and the existing poll test**

```bash
npx playwright test tests/client/room.spec.js -g "react"
npx playwright test tests/client/room.spec.js -g "does not hammer"
```

Expected: PASS. The strip renders only with the fetched result; the reveal still calls `round_result` on the same cadence.

- [ ] **Step 6: Commit**

```bash
git add client/src/screens/reveal.js client/styles/screens/reveal.css tests/client/room.spec.js
git commit -m "feat(client): add the collective groan reaction strip"
```

---

### Task 4: Report dialog and Playwright

**Files:**
- Modify: `client/src/screens/reveal.js` (report link, native dialog, cleanup)
- Modify: `client/styles/screens/reveal.css` (report link and dialog styles)
- Modify: `tests/client/room.spec.js` (report test)

**Interfaces:**
- Consumes: `room.reportQuestion()`, `roomState.reportedRound`, `roomState.members`.
- Produces: `#btn-report-question`, `#report-dialog`, `[data-reason]` buttons, `#report-note`, `#btn-send-report`, `#btn-cancel-report`, `#report-thanks`.

- [ ] **Step 1: Write the failing Playwright test**

Append to `tests/client/room.spec.js`:

```js
test('a player reports a bad question and the row keeps the question snapshot', async ({ browser }) => {
  const { host, guest, code } = await roomWithTwoPlayers(browser);
  const errors = watchErrors(host);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);

  await expect(host.locator('#btn-report-question')).toBeVisible({ timeout: 30000 });
  await host.locator('#btn-report-question').click();
  await expect(host.locator('#report-dialog')).toBeVisible();

  await host.locator('[data-reason="ambiguous"]').click();
  await host.locator('#report-note').fill('Too many Messis');

  // The room poll redraws the reveal every two seconds. The dialog is
  // mounted outside #app, so the note must still be there.
  await host.waitForTimeout(6000);
  await expect(host.locator('#report-dialog')).toBeVisible();
  await expect(host.locator('#report-note')).toHaveValue('Too many Messis');

  await host.locator('#btn-send-report').click();
  await expect(host.locator('#report-dialog')).toHaveCount(0);
  await expect(host.locator('#report-thanks')).toContainText('Thanks — flagged.');

  const server = serverClient();
  const { data: roomRow, error: roomError } = await server.from('rooms')
    .select('id')
    .eq('code', code)
    .single();
  if (roomError) throw roomError;

  const { data: reports, error } = await server.from('round_reports')
    .select('*')
    .eq('room_id', roomRow.id);
  expect(error).toBeNull();
  expect(reports).toHaveLength(1);
  expect(reports[0].reason).toBe('ambiguous');
  expect(reports[0].note).toBe('Too many Messis');
  expect(reports[0].question.prompt).toBeTruthy();
  expect(reports[0].question.answer).toBeTruthy();
  expect(reports[0].question.scope_id).toBeTruthy();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the report test and confirm it fails**

```bash
npx playwright test tests/client/room.spec.js -g "reports a bad question"
```

Expected: FAIL. The reveal has no `#btn-report-question`.

- [ ] **Step 3: Implement the report link and dialog**

In `client/src/screens/reveal.js`, add these constants and helpers after the reaction strip helper:

```js
const REPORT_REASONS = [
  { key: 'ambiguous', label: 'Ambiguous' },
  { key: 'two_answers', label: 'Two right answers' },
  { key: 'looks_wrong', label: 'Answer looks wrong' },
  { key: 'other', label: 'Other' },
];

// The dialog lives outside the reveal root so the two-second poll cannot
// replace the field the player is typing in.
let reportDialog = null;

/** The report link, or the thanks note once this round is reported. */
function reportLine(roomState, roundNumber) {
  if (roomState.reportedRound === roundNumber) {
    return el('p', {
      className: 'report-thanks',
      attrs: { id: 'report-thanks' },
      text: 'Thanks — flagged.',
    });
  }

  return el('p', { className: 'report-line' }, [
    el('button', {
      className: 'report-link',
      attrs: { type: 'button', id: 'btn-report-question' },
      text: 'Something off with this question?',
      on: { click: () => openReportDialog(roundNumber) },
    }),
  ]);
}

function openReportDialog(roundNumber) {
  if (reportDialog) {
    if (!reportDialog.open) reportDialog.showModal();
    return;
  }

  let reason = null;
  let sending = false;

  const error = el('p', {
    className: 'report-dialog__error',
    attrs: { role: 'alert' },
  });

  const reasonButtons = REPORT_REASONS.map(({ key, label }) => el('button', {
    className: 'report-dialog__reason',
    attrs: { type: 'button', 'data-reason': key, 'aria-pressed': 'false' },
    text: label,
    on: {
      click: () => {
        reason = key;
        for (const each of reasonButtons) {
          each.setAttribute('aria-pressed', String(each.dataset.reason === key));
        }
        send.disabled = false;
      },
    },
  }));

  const note = el('textarea', {
    className: 'report-dialog__note',
    attrs: {
      id: 'report-note',
      rows: '3',
      maxlength: '280',
      placeholder: 'What was off? (optional)',
    },
  });

  const send = el('button', {
    className: 'btn btn--primary',
    attrs: { type: 'submit', id: 'btn-send-report' },
    text: 'Send report',
  });
  send.disabled = true;

  const cancel = el('button', {
    className: 'btn btn--secondary',
    attrs: { type: 'button', id: 'btn-cancel-report' },
    text: 'Cancel',
    on: { click: () => dialog.close() },
  });

  const form = el('form', { className: 'report-dialog__form' }, [
    el('h2', {
      className: 'section-title',
      attrs: { id: 'report-title' },
      text: 'Something off with this question?',
    }),
    el('p', {
      className: 'muted-note',
      text: 'One report per player per round. Only the team sees it.',
    }),
    el('div', { className: 'report-dialog__reasons' }, reasonButtons),
    el('label', {
      className: 'report-dialog__label',
      attrs: { for: 'report-note' },
      text: 'Note (optional)',
    }),
    note,
    error,
    el('div', { className: 'report-dialog__actions' }, [cancel, send]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!reason || sending) return;
    sending = true;
    send.disabled = true;
    error.textContent = '';
    const result = await room.reportQuestion(roundNumber, reason, note.value);
    sending = false;
    if (!result?.ok) {
      error.textContent = result?.message ?? 'Something went wrong. Try again.';
      send.disabled = false;
      return;
    }
    dialog.close();
  });

  const dialog = el('dialog', {
    className: 'report-dialog',
    attrs: { id: 'report-dialog', 'aria-labelledby': 'report-title' },
  }, [form]);

  const onHashChange = () => {
    if (dialog.open) dialog.close();
  };

  dialog.addEventListener('close', () => {
    dialog.remove();
    reportDialog = null;
    window.removeEventListener('hashchange', onHashChange);
  });
  window.addEventListener('hashchange', onHashChange);

  document.body.appendChild(dialog);
  reportDialog = dialog;
  dialog.showModal();
  reasonButtons[0]?.focus();
}
```

In `renderRoom`, add the report line below the running score card and above `next`:

```js
    closedRound ? reportLine(roomState, roundNumber) : null,
```

The full order inside `mount` is: topbar, error notice, reveal card, verdict, IQ block, effects card, reaction strip, running score, report line, next button.

- [ ] **Step 4: Add the report styles**

Append to `client/styles/screens/reveal.css`:

```css
/* The report link and its dialog */
.report-line { margin: 0 12px 10px; text-align: center; }
.report-link {
  border: 0;
  background: none;
  color: var(--muted);
  font-family: var(--font-body);
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  padding: 8px;
}
.report-thanks {
  margin: 0 12px 10px;
  text-align: center;
  color: var(--win);
  font-size: 12px;
  font-weight: 700;
}
.report-dialog {
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: 16px;
  border: var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-lg);
}
.report-dialog::backdrop { background: rgba(0, 0, 0, .45); }
.report-dialog__reasons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 12px 0;
}
.report-dialog__reason {
  padding: 10px 8px;
  border: var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.report-dialog__reason[aria-pressed="true"] {
  background: var(--highlight);
  box-shadow: var(--shadow);
}
.report-dialog__label {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 4px;
}
.report-dialog__note {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px 10px;
  border: var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 13px;
}
.report-dialog__error {
  min-height: 1.2em;
  margin: 6px 0 0;
  color: var(--red);
  font-size: 12px;
}
.report-dialog__actions { display: flex; gap: 8px; margin-top: 10px; }
.report-dialog__actions .btn { flex: 1; }
```

- [ ] **Step 5: Run the report test and the whole room suite**

```bash
npx playwright test tests/client/room.spec.js
```

Expected: PASS. All room tests, including the existing effects and rematch flows, are green.

- [ ] **Step 6: Commit**

```bash
git add client/src/screens/reveal.js client/styles/screens/reveal.css tests/client/room.spec.js
git commit -m "feat(client): add the question report dialog"
```

---

### Task 5: Full regression and hosted rollout

**Files:**
- No source changes. This task runs the suites, applies the production migration, pushes the client, and checks live.

**Interfaces:**
- Consumes: the four completed tasks and the existing npm scripts.
- Produces: `20261107000100_reactions_and_reports.sql` applied to the production project and a `main` branch served by Vercel.

- [ ] **Step 1: Run the full Node suite against the local stack**

If the stack is not up:

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:upload
```

Start the function server in another shell:

```bash
npm run supabase:serve
```

Expected: `prepared 3 paths in supabase/functions/_shared/vendor/` and the runner listening on `54399`.

Run:

```bash
npm test
```

Expected: PASS, including `tests/integration/reactions.test.js`, `tests/integration/effects.test.js`, `tests/integration/room.test.js`, and `tests/integration/rematch.test.js`.

- [ ] **Step 2: Run the client suites**

```bash
npm run supabase:sync
npx playwright test tests/client/room.spec.js
```

Expected: PASS. The existing "the reveal does not hammer the server" test is green.

Run the rest of the client suite:

```bash
npx playwright test
```

Expected: PASS. If an unrelated test fails, record its name and the exact error; do not change room code to make it pass.

- [ ] **Step 3: Restore the committed client config and check the branch**

```bash
git checkout -- client/src/config.js
git status --short
git diff --stat
```

Expected: both commands print nothing. `client/src/config.js` is back to the committed production config, and every task is committed.

- [ ] **Step 4: Confirm the migration is the only pending database change**

```bash
set -a
. ./.env.local
set +a
npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" --yes
npx supabase migration list
```

Expected: `20261107000100` is listed as local and not remote; every earlier migration is on both sides. Do not run `npm run supabase:deploy`; no edge function changed.

- [ ] **Step 5: Apply the production migration before pushing the client**

```bash
npx supabase db push --password "$SUPABASE_DB_PASSWORD" --yes
```

Expected: the CLI applies `20261107000100_reactions_and_reports.sql` and reports success. Old clients keep working because `sync_room_state` keeps its signature and all existing keys.

- [ ] **Step 6: Push the client**

```bash
git push origin main
```

Expected: Vercel publishes `dist/`. Wait for the deployment to finish before the live check.

- [ ] **Step 7: Run the live check with two accounts**

Open `https://football-trivia-xi.vercel.app/` in two separate browser profiles.

1. Create a room in one profile, join it from the other.
2. Start the game and answer round one from both profiles.
3. Wait for the reveal. Both profiles show **How did that feel?** with **Knew it**, **No chance**, **Fair play**.
4. Tap a different reaction on each profile. Within a few polls, each profile shows the other player's name under the right chip. The chips stay locked.
5. On one profile, open **Something off with this question?**, choose **Ambiguous**, add a short note, wait at least five seconds, and confirm the note is still in the field. Send it. The dialog closes and the reveal shows **Thanks — flagged.**
6. Confirm the other profile shows no report and no thanks state.
7. As the service role, read the report:

```sql
select created_at, room_id, round_number, reason, note,
       question->>'prompt' as prompt,
       question->>'answer' as answer,
       question->>'scope_id' as scope_id
from public.round_reports
order by created_at desc
limit 5;
```

Expected: one row with the reason, note, prompt, answer, and scope, plus a `question` snapshot containing the clues, options, format, game mode, and reveal.

8. Confirm the view is not readable with the anon key:

```bash
curl -s "$SUPABASE_URL/rest/v1/question_reports?select=*" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

Expected: a permission-denied error, not report rows.

9. Confirm a rematch removes reactions but keeps reports. This is covered locally by `a report survives a rematch and a fresh report is accepted`; the live check can use the SQL reset on a finished room if one is available, but do not force a ten-round game just for this.

- [ ] **Step 8: Record the deployment**

```bash
git status --short
git log --oneline -6
```

Expected: a clean worktree and the four implementation commits (Tasks 1-4) visible.

---

## Self-Review Notes

- **Spec coverage.** Every spec goal has a test: close gating, one per player per round, names after leave, no scoring, snapshot, rematch survival, service-role-only view, and no new poller. Non-goals are untouched: no solo path, no admin UI, no chat, no realtime, no retraction.
- **The result gate.** The reaction strip and report link use `Boolean(result)`, not `showResult`. `applyRound` clears `answeredRound` when the next round starts but keeps `lastResult`, so `showResult` would hide the strip while the player is still reading the closed round. Task 3's second Playwright test pins this.
- **Latest sync body.** The migration replaces the `sync_room_state` from `20261101000100_press_your_luck.sql`, not the older `20261026000100_room_effects.sql` version. It keeps `p_on_demand`, `response_time_ms` in `my_answer`, and every existing key.
- **Report conflict target.** The partial unique index requires the inference predicate: `on conflict (round_id, user_id) where round_id is not null do nothing`.
- **Dialog ownership.** The dialog is created on open, appended to `document.body`, and removed on `close`. The two-second poll re-renders `#app`, never the dialog. A failed send returns `{ ok: false, message }` from `room.reportQuestion()` and leaves the dialog, reason, and note in place.
- **Stale report state.** `create()`, `join()`, `leave()`, the `applyRound` lobby reset, and the new-game round-one transition all clear `reportedRound`; otherwise a new room's round one could show a stale "Thanks — flagged." The transition covers a player who was offline for the whole lobby and reconnects after the rematch has started.
- **Refresh behaviour.** A page refresh loses the in-memory `reportedRound`, so the link reappears for a round already reported. The server's `on conflict do nothing` makes the retry harmless. The spec accepts this; no extra read path is added.
- **No placeholders.** Every step has a command, a file, and either exact code or an exact assertion. No TBD or "similar to above".
- **Name consistency.** SQL allowlists match the client keys exactly: `knew_it` / `no_chance` / `fair_play` and `ambiguous` / `two_answers` / `looks_wrong` / `other`. RPC argument names match the client object keys. Payload keys match `applyReactions`.
- **Rollout order.** The production migration is applied before `git push`; no function deploy is part of the release.
