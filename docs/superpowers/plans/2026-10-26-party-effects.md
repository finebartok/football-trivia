# Party Effects v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a blind steal and a one-per-game side bet in party rooms, resolved atomically with the round close and without leaking another player's answer mid-round.

**Architecture:** One new `room_effects` table, one new `use_room_effect` RPC, and three replaced database functions (`advance_room`, `round_result`, `sync_room_state`). Effects resolve inside `advance_room` before the score roll-up. The browser gains a pure `applyEffects` fold, a `room.useEffect` call, a round-screen strip and picker, and a reveal effects card. No new edge function; only `submit-answer` gains a guard.

**Tech Stack:** Postgres/PL/pgSQL, Supabase RLS and Realtime, a Deno edge function, vanilla ES modules, Node's built-in test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-party-effects-design.md`

## Global Constraints

- One steal and one side bet per player per room, enforced by `unique (room_id, actor_id, kind)`.
- A steal forfeits the thief's own answer and copies a **player**, never an answer the thief can see.
- The thief gets half the target's points, rounded down; the target keeps full points.
- No chains: a steal of a stealer gets 0; mutual steals both get 0.
- A side bet is silent to its target mid-round and pays +500 only when the target is correct and the bettor answered or stole that round.
- No answer, correctness, points, stage, response time, or answered status for another player before the round closes.
- `round_result` and `sync_room_state` stay `security definer`; the table's RLS is the second line of defence.
- No new runtime dependencies, no build step, no new edge function.
- Text is the feedback. Sound and colour are never the only signal; reduced motion is unaffected.
- `dist/` is published as-is; new client files under `client/` ship through the existing publish script.
- The live site is `https://football-trivia-xi.vercel.app/`; the Supabase project ref is `rexwrapjdqikblkdohnl`.

## Review Focus

- A player with a steal placeholder taps an option before the UI routes to the reveal: `submit-answer` must return 409 with `you are copying a player this round`, and the round screen must show a sentence, not a 500.
- A round closes while a placement RPC is in flight: the `for no key update` lock must serialize them; the effect either lands and resolves or is refused as too late, never half-landed.
- A `round_result` request races the round advance: a stale result must not overwrite the current round's answer, and a just-fetched reveal must not be wiped by the next poll.
- A target leaves, does not answer, or used their own steal: the thief gets 0, the victim story is neutral, and no query crashes.
- Two taps or a lost response: the same-round retry is an idempotent success and must not spend the effect twice or write a second placeholder.
- Realtime is down: the two-second poll still delivers the victim warning and the pending-bet line.
- A side bet on a successful stealer: the bet pays because the target's final answer is correct, even though the target never answered themselves.

---

## File Structure

- Create `supabase/migrations/20261026000100_room_effects.sql` — table, RLS, realtime publication, placement RPC, effect resolution, and the replaced result/state functions.
- Modify `supabase/functions/_shared/submit-answer.js` — reject a player who has a steal for the round, before the answer lookup and in the `23505` retry branch.
- Modify `client/src/room-state.js` — `applyEffects`, and preserve `lastResult` across a round change.
- Modify `client/src/room.js` — `myEffects`, `useEffect`, `room_effects` subscription, result folding, friendly errors.
- Modify `client/src/screens/round.js` — effects strip, target picker, victim warning, error notice.
- Modify `client/src/screens/reveal.js` — waiting effect lines, Effects card, thief verdict override.
- Modify `client/src/screens/results.js` — drop the room's "of X possible" line.
- Modify `client/styles/screens/round.css` and `client/styles/screens/reveal.css` — the new text-first surfaces.
- Create `tests/integration/effects.test.js` — RLS, placement, resolution, result and state tests.
- Modify `tests/shared/room-state.test.js` — `applyEffects` and `lastResult` preservation.
- Modify `tests/client/room.spec.js` — steal, picker, side bet, and no-strip tests.
- No new client modules; the picker lives in `round.js`, the state fold in `room-state.js`.

---

### Task 1: Effects table, RLS, realtime, and placement RPC

**Files:**
- Create: `supabase/migrations/20261026000100_room_effects.sql`
- Create: `tests/integration/effects.test.js`

**Interfaces:**
- Consumes: `public.is_room_member(uuid)`, `public.rooms`, `public.rounds`, `public.room_memberships`, `public.answers`.
- Produces: `public.room_effects` with columns `(id, room_id, round_id, actor_id, target_id, kind, bonus_points, created_at, resolved_at)`; `public.use_room_effect(p_room_id uuid, p_round_number int, p_kind text, p_target_user_id uuid) returns jsonb` returning `{ kind, target_user_id, round_number, already }`.

- [ ] **Step 1: Write the failing integration tests for the table and placement**

Create `tests/integration/effects.test.js` with the shared helper and the Task 1 tests:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A room with one open round, made directly on the server. */
async function setupRoom({ players = 2, deadlineMs = 60000 } = {}) {
  const host = await playerClient();
  const { data: room, error } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  assert.equal(error, null, error?.message);
  const made = [{ ...host, name: 'Alex' }];

  const names = ['Sam', 'Robin'];
  for (let i = 1; i < players; i++) {
    const p = await playerClient();
    const joined = await p.client.rpc('join_room', {
      p_code: room.code, p_display_name: names[i - 1],
    });
    assert.equal(joined.error, null, joined.error?.message);
    made.push({ ...p, name: names[i - 1] });
  }

  const server = serverClient();
  const { data: round } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'identify',
    prompt: 'Who is this?',
    context: null,
    clues: [],
    options: [],
    reveal_schedule: [{ stage: 1, revealAtMs: 500 }],
    started_at: new Date(Date.now() - 1000).toISOString(),
    deadline_at: new Date(Date.now() + deadlineMs).toISOString(),
  }).select().single();
  await server.from('round_secrets').insert({
    round_id: round.id, answer_value: 'Lionel Messi',
  });
  await server.from('rooms').update({
    status: 'round_active', current_round: 1,
  }).eq('id', room.id);

  return { room, round, players: made, server };
}

async function useEffect(player, roomId, roundNumber, kind, targetId) {
  return player.client.rpc('use_room_effect', {
    p_room_id: roomId,
    p_round_number: roundNumber,
    p_kind: kind,
    p_target_user_id: targetId,
  });
}

async function addAnswer(server, room, round, player, {
  correct = true, points = 7500, guessed = 'Lionel Messi', ms = 1000,
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

/** Move the deadline into the past without touching the placement window. */
async function expireRound(server, round) {
  const { error } = await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', round.id);
  assert.equal(error, null, error?.message);
}

/** Ask the server to advance; it closes the round when the clock says so. */
async function closeRound(player, roomId) {
  const { data, error } = await player.client.rpc('current_round', { p_room_id: roomId });
  assert.equal(error, null, error?.message);
  return data;
}

test('a player cannot write an effect row', { skip }, async () => {
  const { room, round, players } = await setupRoom();
  const [alex, sam] = players;
  const { error } = await alex.client.from('room_effects').insert({
    room_id: room.id,
    round_id: round.id,
    actor_id: alex.userId,
    target_id: sam.userId,
    kind: 'steal',
  });
  assert.ok(error, 'effects are written by the server, not by the client');
});

test('the actor and the steal victim can read an effect, a third player cannot', { skip }, async () => {
  const { room, players } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  const { error } = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(error, null, error?.message);

  const { data: actorRows } = await sam.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(actorRows.length, 1, 'the actor sees their own effect');

  const { data: victimRows } = await alex.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(victimRows.length, 1, 'the victim sees the steal');

  const { data: thirdRows } = await robin.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(thirdRows.length, 0, 'an uninvolved player sees nothing');

  // Reading is allowed for the victim; writing is not, even on their own row.
  const { data: before } = await server.from('room_effects')
    .select('bonus_points').eq('id', actorRows[0].id).single();
  await alex.client.from('room_effects')
    .update({ bonus_points: 999 }).eq('id', actorRows[0].id);
  const { data: after } = await server.from('room_effects')
    .select('bonus_points').eq('id', actorRows[0].id).single();
  assert.equal(after.bonus_points, before.bonus_points, 'a player cannot update an effect');
});

test('the target of a side bet cannot read it mid-round', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;

  const { error } = await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  assert.equal(error, null, error?.message);

  const { data: targetRows } = await alex.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(targetRows.length, 0, 'a side bet is silent to its target');
});

test('a steal is refused after the actor has answered', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await addAnswer(server, room, round, alex);

  const { error } = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.match(error.message, /already answered this round/);
});

test('an effect needs another member as its target', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;

  const self = await useEffect(alex, room.id, 1, 'steal', alex.userId);
  assert.match(self.error.message, /cannot use an effect on yourself/);

  const stranger = await playerClient();
  const other = await useEffect(alex, room.id, 1, 'steal', stranger.userId);
  assert.match(other.error.message, /not in the room/);
});

test('an effect is only placed in the open current round', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const wrong = await useEffect(alex, room.id, 2, 'steal', sam.userId);
  assert.match(wrong.error.message, /round is not open/);

  await server.from('rounds')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', round.id);
  const closed = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.match(closed.error.message, /too late/);
});

test('an effect after the deadline is too late', { skip }, async () => {
  const { room, players } = await setupRoom({ deadlineMs: -1000 });
  const [alex, sam] = players;
  const { error } = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.match(error.message, /too late/);
});

test('a steal writes one placeholder answer and is idempotent in the same round', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const first = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(first.error, null, first.error?.message);
  assert.equal(first.data.already, false);

  const retry = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(retry.error, null, retry.error?.message);
  assert.equal(retry.data.already, true);

  const { data: effects } = await server
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(effects.length, 1, 'one effect row');

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id).eq('user_id', sam.userId);
  assert.equal(answers.length, 1, 'one placeholder');
  assert.equal(answers[0].guessed_answer, '');
  assert.equal(answers[0].points_earned, 0);
});

test('a same-round retry after the round closed returns the first effect', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const first = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(first.error, null, first.error?.message);

  await expireRound(server, round);
  await closeRound(alex, room.id);

  // The response may have been lost after the close. The retry still
  // returns the effect it spent rather than an error.
  const retry = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(retry.error, null, retry.error?.message);
  assert.equal(retry.data.already, true);
  assert.equal(retry.data.target_user_id, alex.userId);
});

test('each effect is once per game, in a later round too', { skip }, async () => {
  const { room, players, server } = await setupRoom();
  const [alex, sam] = players;

  const first = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.equal(first.error, null, first.error?.message);

  await server.from('rounds').insert({
    room_id: room.id,
    round_number: 2,
    template: 'identify',
    prompt: 'Who is this?',
    context: null,
    clues: [],
    options: [],
    reveal_schedule: [],
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
  });
  await server.from('rooms').update({ current_round: 2 }).eq('id', room.id);

  const later = await useEffect(alex, room.id, 2, 'steal', sam.userId);
  assert.match(later.error.message, /already used that effect this game/);

  const bet = await useEffect(alex, room.id, 2, 'side_bet', sam.userId);
  assert.equal(bet.error, null, bet.error?.message);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
npm run supabase:reset
node --test tests/integration/effects.test.js
```

Expected: the first test fails with a `room_effects` relation/function missing error. The suite skips if the stack is not up; start it with `npm run supabase:start` first.

- [ ] **Step 3: Create the migration with the table, RLS, publication and RPC**

Create `supabase/migrations/20261026000100_room_effects.sql`:

```sql
-- Party effects: one blind steal and one side bet per player per game.
--
-- This table holds relationships and bonuses, never answers. A steal's
-- copied answer lives in public.answers, written at round close.

create table if not exists public.room_effects (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  target_id uuid not null references auth.users(id),
  kind text not null check (kind in ('steal','side_bet')),
  bonus_points int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint room_effects_one_per_kind unique (room_id, actor_id, kind),
  constraint room_effects_not_self check (actor_id <> target_id)
);
create index if not exists room_effects_round_idx on public.room_effects (round_id);
create index if not exists room_effects_target_idx on public.room_effects (target_id, round_id);

alter table public.room_effects enable row level security;

drop policy if exists room_effects_select on public.room_effects;
create policy room_effects_select on public.room_effects for select
  using (
    public.is_room_member(room_id)
    and (
      actor_id = auth.uid()
      or (kind = 'steal' and target_id = auth.uid())
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_effects'
  ) then
    alter publication supabase_realtime add table public.room_effects;
  end if;
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
    select greatest(1, count(*)::int) into v_stage
    from jsonb_array_elements(v_round.reveal_schedule) s
    where v_elapsed >= coalesce((s->>'revealAtMs')::int, 0);

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
```

- [ ] **Step 4: Reset the database and run the tests**

Run:

```bash
npm run supabase:reset
node --test tests/integration/effects.test.js
```

Expected: PASS for every Task 1 test. The later tests in the file do not exist yet.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261026000100_room_effects.sql tests/integration/effects.test.js
git commit -m "feat: add room effects table and placement RPC"
```

---

### Task 2: Resolve effects at round close and expose them in result/state

**Files:**
- Modify: `supabase/migrations/20261026000100_room_effects.sql`
- Modify: `tests/integration/effects.test.js`

**Interfaces:**
- Consumes: the Task 1 `room_effects` table and `use_room_effect`.
- Produces: `advance_room` resolves steals and side bets before scoring; `round_result(p_room_id, p_round_number)` returns `{ ..., my_answer: { correct, points, stage, guessed_answer }, effects: [...] }`; `sync_room_state(p_room_id)` returns `{ ..., my_effects: [...] }`.

- [ ] **Step 1: Add the failing resolution, result and state tests**

Append to `tests/integration/effects.test.js`:

```js
test('a correct steal copies the answer for half points and the target keeps full', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const steal = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(steal.error, null, steal.error?.message);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const thief = answers.find((a) => a.user_id === sam.userId);
  const target = answers.find((a) => a.user_id === alex.userId);
  assert.equal(thief.guessed_answer, 'Lionel Messi');
  assert.equal(thief.is_correct, true);
  assert.equal(thief.points_earned, 3750);
  assert.equal(thief.stage_locked, target.stage_locked);
  assert.equal(thief.response_time_ms, target.response_time_ms);
  assert.equal(target.points_earned, 7500, 'the target keeps the full score');

  const { data: board } = await server.from('room_memberships')
    .select('user_id, total_score, correct_count').eq('room_id', room.id);
  const samRow = board.find((m) => m.user_id === sam.userId);
  assert.equal(samRow.total_score, 3750);
  assert.equal(samRow.correct_count, 1);
});

test('a wrong steal copies the wrong guess and scores nothing', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, {
    correct: false, guessed: 'Definitely Not The Answer',
  });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const thief = answers.find((a) => a.user_id === sam.userId);
  assert.equal(thief.guessed_answer, 'Definitely Not The Answer');
  assert.equal(thief.is_correct, false);
  assert.equal(thief.points_earned, 0);
});

test('a steal of a player who did not answer scores nothing', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const { data: thief } = await server.from('answers')
    .select('*').eq('round_id', round.id).eq('user_id', sam.userId).single();
  assert.equal(thief.guessed_answer, '');
  assert.equal(thief.is_correct, false);
  assert.equal(thief.points_earned, 0);
});

test('no chains: a steal of a stealer copies nothing', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(robin, room.id, 1, 'steal', sam.userId);
  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const samAnswer = answers.find((a) => a.user_id === sam.userId);
  const robinAnswer = answers.find((a) => a.user_id === robin.userId);
  assert.equal(samAnswer.points_earned, 3750, 'Sam copies Alex');
  assert.equal(robinAnswer.points_earned, 0, 'Robin cannot copy a stealer');
});

test('mutual steals both fail', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(alex, room.id, 1, 'steal', sam.userId);
  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  assert.ok(answers.every((a) => a.points_earned === 0), 'both placeholders stay zero');
});

test('two thieves on one correct victim each get half', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await useEffect(robin, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const samAnswer = answers.find((a) => a.user_id === sam.userId);
  const robinAnswer = answers.find((a) => a.user_id === robin.userId);
  const target = answers.find((a) => a.user_id === alex.userId);
  assert.equal(samAnswer.points_earned, 3750);
  assert.equal(robinAnswer.points_earned, 3750);
  assert.equal(target.points_earned, 7500);
});

test('a steal placeholder lets the round close when everyone else has answered', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex);
  await closeRound(alex, room.id);

  const { data: closed } = await server
    .from('rounds').select('closed_at').eq('id', round.id).single();
  assert.ok(closed.closed_at, 'the placeholder counted as Sam having played');
});

test('a side bet pays +500 when the target is correct and the bettor answered', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await addAnswer(server, room, round, sam, { correct: true, points: 5000 });
  await closeRound(alex, room.id);

  const { data: effect } = await server.from('room_effects')
    .select('*').eq('room_id', room.id).eq('actor_id', sam.userId).eq('kind', 'side_bet').single();
  assert.equal(effect.bonus_points, 500);
  assert.ok(effect.resolved_at);

  const { data: samRow } = await server.from('room_memberships')
    .select('total_score').eq('room_id', room.id).eq('user_id', sam.userId).single();
  assert.equal(samRow.total_score, 5500, 'own points plus the side bet');
});

test('a side bet pays nothing when the target is wrong or the bettor did not play', { skip }, async () => {
  const wrong = await setupRoom();
  const [alexWrong, samWrong] = wrong.players;
  await useEffect(samWrong, wrong.room.id, 1, 'side_bet', alexWrong.userId);
  await addAnswer(wrong.server, wrong.room, wrong.round, alexWrong, {
    correct: false, guessed: 'Wrong',
  });
  await addAnswer(wrong.server, wrong.room, wrong.round, samWrong, { correct: true, points: 5000 });
  await closeRound(alexWrong, wrong.room.id);
  const { data: wrongEffect } = await wrong.server.from('room_effects')
    .select('bonus_points').eq('room_id', wrong.room.id).single();
  assert.equal(wrongEffect.bonus_points, 0);

  const idle = await setupRoom();
  const [alexIdle, samIdle] = idle.players;
  await useEffect(samIdle, idle.room.id, 1, 'side_bet', alexIdle.userId);
  await addAnswer(idle.server, idle.room, idle.round, alexIdle, { correct: true, points: 7500 });
  await expireRound(idle.server, idle.round);
  await closeRound(alexIdle, idle.room.id);
  const { data: idleEffect } = await idle.server.from('room_effects')
    .select('bonus_points').eq('room_id', idle.room.id).single();
  assert.equal(idleEffect.bonus_points, 0, 'no answer or steal means no bet');
});

test('a side bet on a successful stealer pays', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  await addAnswer(server, room, round, sam, { correct: true, points: 3000 });
  await useEffect(alex, room.id, 1, 'steal', robin.userId);
  await addAnswer(server, room, round, robin, { correct: true, points: 7500 });
  await closeRound(sam, room.id);

  const { data: alexAnswer } = await server.from('answers')
    .select('*').eq('round_id', round.id).eq('user_id', alex.userId).single();
  assert.equal(alexAnswer.points_earned, 3750, 'the stealer copied correctly');

  const { data: bet } = await server.from('room_effects')
    .select('bonus_points').eq('room_id', room.id)
    .eq('actor_id', sam.userId).eq('kind', 'side_bet').single();
  assert.equal(bet.bonus_points, 500);
});

test('a side bet pays when the bettor stole instead of answering', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  // Sam has no normal answer, only a steal placeholder. The bet still
  // counts, because Sam played the round.
  await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  await useEffect(sam, room.id, 1, 'steal', robin.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await addAnswer(server, room, round, robin, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: bet } = await server.from('room_effects')
    .select('bonus_points').eq('room_id', room.id)
    .eq('actor_id', sam.userId).eq('kind', 'side_bet').single();
  assert.equal(bet.bonus_points, 500);
});

test('the result resolves effects and returns the copied answer', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await expireRound(server, round);

  // The deadline has passed. round_result itself must close and resolve.
  const { data, error } = await sam.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(error, null, error?.message);
  assert.equal(data.my_answer.guessed_answer, 'Lionel Messi');
  assert.equal(data.my_answer.points, 3750);
  assert.equal(data.my_answer.correct, true);

  const steal = data.effects.find((e) => e.kind === 'steal' && e.actor_id === sam.userId);
  assert.equal(steal.target_correct, true);
  assert.equal(steal.target_answered, true);
  assert.equal(steal.target_stole, false);
  assert.equal(steal.actor_points, 3750);
  assert.equal(steal.resolved, true);
});

test('the result exposes no effects while the round is open', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;
  const { data, error } = await alex.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(error, null, error?.message);
  assert.equal(data.pending, true);
  assert.equal(data.effects, undefined);
});

test('the victim sees a pending steal and a third player does not', { skip }, async () => {
  const { room, players } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);

  const { data: victimState } = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  const row = victimState.my_effects.find((e) => e.kind === 'steal');
  assert.equal(row.role, 'target');
  assert.equal(row.other_id, sam.userId);
  assert.equal(row.resolved, false);

  const { data: thirdState } = await robin.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(thirdState.my_effects.length, 0);
});

test('two thieves on one victim both appear, and a side bet stays with its bettor', { skip }, async () => {
  const { room, players } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await useEffect(robin, room.id, 1, 'side_bet', alex.userId);
  await useEffect(robin, room.id, 1, 'steal', alex.userId);

  const { data: victimState } = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(victimState.my_effects.filter((e) => e.kind === 'steal').length, 2);
  assert.equal(victimState.my_effects.some((e) => e.kind === 'side_bet'), false,
    'a side bet is silent to its target');

  const { data: bettorState } = await robin.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(bettorState.my_effects.filter((e) => e.kind === 'steal').length, 1, 'the actor sees their own steal');
  assert.equal(bettorState.my_effects.filter((e) => e.kind === 'side_bet').length, 1);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
node --test tests/integration/effects.test.js
```

Expected: the Task 1 tests still pass; the new tests fail because `advance_room` does not resolve effects and `round_result` does not return `effects`/normalised `my_answer`.

- [ ] **Step 3: Append the replaced database functions to the migration**

Append to `supabase/migrations/20261026000100_room_effects.sql`. Start from the existing bodies; the effect block is the new part.

```sql
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

  -- A steal copies the target's answer into the thief's placeholder. The
  -- no-chain rule reads the target's effect row, not their resolved
  -- answer, so the result does not depend on resolution order.
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

  -- A side bet sees the thief's copied answer above, because steals are
  -- resolved first.
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

  -- Side-bet bonuses sit on top of the normal roll-up. They do not touch
  -- correct_count or the tie-break timing.
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

  -- A result must never be served before its effects and scores resolve,
  -- even when the caller is the first one to ask after the deadline.
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
    'leaderboard', v_leaderboard,
    'my_answer', v_mine,
    'effects', v_effects
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
  v_answered_round int;
  v_mine jsonb;
  v_effects jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_state := public.current_round(p_room_id);

  select max(r.round_number) into v_answered_round
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where a.room_id = p_room_id and a.user_id = auth.uid();

  select jsonb_build_object(
      'correct', a.is_correct,
      'points', a.points_earned,
      'stage', a.stage_locked,
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
```

- [ ] **Step 4: Reset and run the integration tests**

Run:

```bash
npm run supabase:reset
node --test tests/integration/effects.test.js
```

Expected: PASS. The steal resolution, no-chain, mutual, multi-thief, side-bet, result and state tests all pass.

- [ ] **Step 5: Run the existing room integration suite**

Run:

```bash
node --test tests/integration/room.test.js
```

Expected: PASS (or skip when the stack is down). The existing `advance_room`, `round_result` and `sync_room_state` behaviour is unchanged.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261026000100_room_effects.sql tests/integration/effects.test.js
git commit -m "feat: resolve party effects at round close"
```

---

### Task 3: Guard `submit-answer` against a thief

**Files:**
- Modify: `supabase/functions/_shared/submit-answer.js`
- Modify: `tests/integration/effects.test.js`

**Interfaces:**
- Consumes: `public.room_effects`.
- Produces: `submit-answer` returns HTTP 409 `{ error: 'you are copying a player this round' }` for a player with a steal in that round.

- [ ] **Step 1: Write the failing guard test**

Append to `tests/integration/effects.test.js`:

```js
test('a thief cannot submit an answer', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);

  const res = await callFunction('submit-answer', {
    room_id: room.id,
    round_number: 1,
    guessed_answer: 'Lionel Messi',
  }, sam.accessToken);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'you are copying a player this round');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Start the local functions runner in a second terminal first:

```bash
npm run supabase:serve
```

Then run:

```bash
node --test tests/integration/effects.test.js
```

Expected: the guard test fails because `submit-answer` returns 200 and the placeholder retry instead of 409.

Stop the runner (`Ctrl+C`) before editing: `serve-functions.js` imports the handler at boot, so it does not pick up the change.

- [ ] **Step 3: Add the guard**

In `supabase/functions/_shared/submit-answer.js`, add a helper above `handleSubmitAnswer`:

```js
async function hasSteal(admin, roundId, userId) {
  const { data } = await admin
    .from('room_effects')
    .select('id')
    .eq('round_id', roundId)
    .eq('actor_id', userId)
    .eq('kind', 'steal')
    .maybeSingle();
  return Boolean(data);
}
```

Then, after the round-clock check and before the existing answer lookup:

```js
    // A player who is copying somebody has no answer of their own. This
    // is a refusal, not a retry: the placeholder is not their answer.
    if (await hasSteal(admin, round.id, userId)) {
      return json({ error: 'you are copying a player this round' }, 409);
    }
```

In the `23505` retry branch, before returning `theirs`, add the same check:

```js
      if (insertError.code === '23505') {
        if (await hasSteal(admin, round.id, userId)) {
          return json({ error: 'you are copying a player this round' }, 409);
        }
        const { data: theirs } = await admin
          .from('answers')
          .select('*')
          .eq('round_id', round.id)
          .eq('user_id', userId)
          .maybeSingle();
        if (theirs) {
          return json({
            correct: theirs.is_correct,
            points: theirs.points_earned,
            stage: theirs.stage_locked,
            already: true,
          });
        }
      }
```

- [ ] **Step 4: Run the guard test and the room suite**

Start the runner again so it loads the changed handler:

```bash
npm run supabase:serve
```

Then run:

```bash
node --test tests/integration/effects.test.js
node --test tests/integration/room.test.js
```

Expected: PASS. The guard test gets 409 and the existing answer tests still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/submit-answer.js tests/integration/effects.test.js
git commit -m "fix: refuse an answer from a player who is copying"
```

---

### Task 4: Pure client state for effects and the result race

**Files:**
- Modify: `client/src/room-state.js`
- Modify: `tests/shared/room-state.test.js`

**Interfaces:**
- Produces: `applyEffects(state, effects) -> state`; `applyRound` preserves a `lastResult` whose `round_number` matches the old `answeredRound`.
- Consumes: the effect shape from `sync_room_state.my_effects`.

- [ ] **Step 1: Write the failing unit tests**

Add `applyEffects` to the existing import at the top of `tests/shared/room-state.test.js`:

```js
import { applyRound, applyMembers, applyLeaderboard, applyEffects } from '../../client/src/room-state.js';
```

Then append:

```js
test('effects replace the player effect list', () => {
  const state = {
    myEffects: [{ round_number: 1, kind: 'steal', role: 'actor' }],
  };
  applyEffects(state, [
    { round_number: 1, kind: 'steal', role: 'actor', other_id: 'a' },
    { round_number: 2, kind: 'side_bet', role: 'target', other_id: 'b' },
  ]);
  assert.equal(state.myEffects.length, 2);
  assert.equal(state.myEffects[1].kind, 'side_bet');
});

test('an empty effect list clears the used buttons', () => {
  const state = { myEffects: [{ round_number: 1, kind: 'steal' }] };
  applyEffects(state, []);
  assert.deepEqual(state.myEffects, []);
});

test('a new round keeps the effects already used', () => {
  const state = {
    round: { round_number: 1 },
    myEffects: [{ round_number: 1, kind: 'steal', role: 'actor' }],
  };
  applyRound(state, { current_round: 2, round: { round_number: 2 } });
  assert.equal(state.myEffects.length, 1);
});

test('a new round preserves the result it just fetched', () => {
  const state = {
    round: { round_number: 1 },
    myAnswer: { correct: true, points: 7500 },
    answeredRound: 1,
    lastResult: { round_number: 1, answer: 'Lionel Messi' },
    fetchingResult: true,
  };
  applyRound(state, { current_round: 2, round: { round_number: 2 } });
  assert.deepEqual(state.lastResult, { round_number: 1, answer: 'Lionel Messi' });
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.fetchingResult, false);
});

test('a new round drops a result for a different round', () => {
  const state = {
    round: { round_number: 1 },
    answeredRound: 1,
    lastResult: { round_number: 0, answer: 'Old' },
  };
  applyRound(state, { current_round: 2, round: { round_number: 2 } });
  assert.equal(state.lastResult, null);
});
```

Also strengthen the existing tests: the same-round redraw test keeps its `lastResult`, so add `assert.deepEqual(state.lastResult, { answer: 'Lionel Messi' });`; the "a new round forgets the last answer" test drops a result with no `round_number`, so add `assert.equal(state.lastResult, null);`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
node --test tests/shared/room-state.test.js
```

Expected: FAIL with `applyEffects` is not exported, and the preservation test sees `lastResult` as null.

- [ ] **Step 3: Implement `applyEffects` and the preservation rule**

In `client/src/room-state.js`, add:

```js
/** Fold the caller's effects in, in the server's order. */
export function applyEffects(state, effects) {
  state.myEffects = [...(effects ?? [])];
  return state;
}
```

Change the round-change branch in `applyRound` to:

```js
  if (next && state.round && next.round_number !== state.round.round_number) {
    // The reveal may have just fetched the result for the round that is
    // being closed. Keep it: the round change is the same poll that
    // closes the round, and wiping it would show a blank reveal. The
    // old answeredRound is read first because it is nulled below.
    const revealing = state.answeredRound;
    const keep = state.lastResult?.round_number === revealing ? state.lastResult : null;
    state.myAnswer = null;
    state.answeredRound = null;
    state.lastResult = keep;
    state.fetchingResult = false;
  }
```

Do not clear `myEffects` anywhere in `applyRound`.

- [ ] **Step 4: Run the unit tests**

Run:

```bash
node --test tests/shared/room-state.test.js
```

Expected: PASS, including the existing "a new round forgets the last answer" test (its `lastResult` has no `round_number`, so it is dropped).

- [ ] **Step 5: Commit**

```bash
git add client/src/room-state.js tests/shared/room-state.test.js
git commit -m "feat: fold room effects into the client state"
```

---

### Task 5: Room client API, round-screen strip and picker

**Files:**
- Modify: `client/src/room.js`
- Modify: `client/src/screens/round.js`
- Modify: `client/styles/screens/round.css`
- Modify: `tests/client/room.spec.js`

**Interfaces:**
- Consumes: `applyEffects` from Task 4; `use_room_effect` from Task 1; `my_effects` from Task 2.
- Produces: `room.useEffect(kind, targetUserId)`; `room.state.myEffects`; the round screen elements `#effects`, `#btn-steal`, `#btn-side-bet`, `#btn-effect-confirm`, `#steal-warning`.

- [ ] **Step 1: Write the failing Playwright tests**

Append to `tests/client/room.spec.js`:

```js
test('a steal warns the victim and copies their answer', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  await host.locator('#btn-steal').click();
  await host.locator('.picker__row').filter({ hasText: 'Sam' }).click();
  await host.locator('#btn-effect-confirm').click();

  // A thief has no answer to give: the reveal waits.
  await expect(host).toHaveURL(/#reveal/);

  // The victim knows the thief by name while the round is still open.
  await expect(guest.locator('#steal-warning')).toContainText('Host is copying your answer.');

  await guest.locator('.option').first().click();
  await expect(guest).toHaveURL(/#reveal/);

  // The Effects card and the copied-player verdict arrive in Task 6.
  expect([...hostErrors, ...guestErrors]).toEqual([]);
});

test('the target picker shows presence, not answered status, and survives a redraw', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  await host.locator('#btn-steal').click();
  await expect(host.locator('.picker__row')).toHaveCount(1);
  await expect(host.locator('.picker__row')).toContainText('Sam');
  await expect(host.locator('.picker__row')).toContainText(/online|away/);
  await expect(host.locator('.picker__row')).not.toContainText(/answered/i);

  await host.locator('.picker__row').click();
  await host.waitForTimeout(3000);

  // The two-second redraw did not close it or lose the selection.
  await expect(host.locator('.picker')).toBeVisible();
  await expect(host.locator('.picker__row.is-picked')).toHaveCount(1);
});

test('a side bet shows its pending line and pays or loses at the reveal', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await host.locator('#btn-side-bet').click();
  await host.locator('.picker__row').filter({ hasText: 'Sam' }).click();
  await host.locator('#btn-effect-confirm').click();

  await expect(host.locator('#effects')).toContainText('Side bet on Sam');

  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  // The Effects card is asserted in Task 6.
});

test('the effects strip is absent when alone in a room', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(3).click();
  await host.locator('#btn-create-room').click();
  await expect(host).toHaveURL(/#room-lobby/);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(host.locator('#btn-steal')).toHaveCount(0);
});

test('the effects strip is absent in solo play', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(3).click();
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(host.locator('#btn-steal')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
npx playwright test tests/client/room.spec.js -g "steal|picker|side bet|effects strip"
```

Expected: FAIL because `#btn-steal` does not exist.

- [ ] **Step 3: Add `myEffects`, `useEffect`, the subscription and friendly errors to `client/src/room.js`**

Import `applyEffects`:

```js
import { applyRound, applyMembers, applyLeaderboard, applyEffects } from './room-state.js';
```

Add `myEffects: []` to `state` after `lastResult`:

```js
  lastResult: null,
  myEffects: [],
```

In `applyPayload`:

```js
  if (payload.my_effects) applyEffects(state, payload.my_effects);
```

In `subscribe`, add the `room_effects` listener:

```js
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_effects', filter: `room_id=eq.${roomId}` }, () => sync())
```

Add the method before `result`:

```js
  /** Spend the one steal or the one side bet. */
  async useEffect(kind, targetUserId) {
    const supabase = await ensure();
    if (!supabase || !state.roomId || !state.round) return null;
    const { data, error } = await supabase.rpc('use_room_effect', {
      p_room_id: state.roomId,
      p_round_number: state.round.round_number,
      p_kind: kind,
      p_target_user_id: targetUserId,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.error = null;
    // The server's round, not the possibly stale local one. The round
    // screen routes on this and the reveal asks for this round.
    if (kind === 'steal') state.answeredRound = data.round_number;
    await sync();
    notify();
    return data;
  },
```

Change `result` to guard the round, fold the normalised answer, and ignore a stale result:

```js
  async result(roundNumber) {
    const supabase = client;
    if (!supabase || !state.roomId) return null;
    if (roundNumber !== state.answeredRound) return null;
    const { data, error } = await supabase.rpc('round_result', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
    });
    if (error) {
      if (!String(error.message ?? '').includes('still open')) {
        state.error = friendly(error.message);
      }
      notify();
      return null;
    }
    if (data?.pending) {
      notify();
      return null;
    }
    // The room may have advanced while this request was in flight. A
    // result for another round must not overwrite the current answer.
    if (roundNumber !== state.answeredRound) return null;
    state.lastResult = data;
    if (data.my_answer) state.myAnswer = data.my_answer;
    applyLeaderboard(state, data.leaderboard);
    notify();
    return data;
  },
```

In `leave`, add:

```js
    state.myEffects = [];
    state.lastResultAskedAt = null;
```

In `friendly`, add the exact mappings before the generic fallback:

```js
  if (m.includes('already used that effect')) return 'You already used that effect this game.';
  if (m.includes('already answered')) return 'You already answered this round.';
  if (m.includes('copying a player')) return "You're copying a player this round. No answer of your own.";
  if (m.includes('not in the room')) return 'That player is no longer in the room.';
  if (m.includes('not a member of that room')) return "You're not in that room.";
  if (m.includes('effect on yourself')) return "You can't use an effect on yourself.";
  if (m.includes('game is not running')) return 'That game is not running.';
  if (m.includes('round is not open')) return 'That round is over.';
```

Keep the existing `too late` mapping; it already returns `Too late - that round is over.`

- [ ] **Step 4: Add the strip, picker and warning to `client/src/screens/round.js`**

Change the store import to include `notify` (a local picker close must redraw the screen immediately), and import `labelFor`:

```js
import { store, notify } from '../store.js';
import { labelFor } from '../room-state.js';
```

Add module state near the other module-level values:

```js
// The picker survives the two-second redraw. It resets when the round
// changes, and the selected target is kept across a redraw.
let picker = null;
let pickedTarget = null;
let pickerRound = null;
```

Inside `render`, after the `roundKey`/`lastRoundKey` block, reset the picker on a round change:

```js
  const roundNumber = inRoom ? roomState.round.round_number : null;
  if (pickerRound !== roundNumber) {
    picker = null;
    pickedTarget = null;
    pickerRound = roundNumber;
  }
```

After the `now` definition and before the timer element, build the effects data and UI:

```js
  const mine = inRoom ? (roomState.myEffects ?? []) : [];
  const stealUsed = mine.some((e) => e.role === 'actor' && e.kind === 'steal');
  const betUsed = mine.some((e) => e.role === 'actor' && e.kind === 'side_bet');
  const pendingBet = mine.find((e) => e.role === 'actor' && e.kind === 'side_bet' && !e.resolved);
  const thieves = mine.filter((e) => e.role === 'target' && e.kind === 'steal'
    && e.round_number === roundNumber);
  const others = inRoom
    ? (roomState.members ?? []).filter((m) => m.user_id !== roomState.me)
    : [];

  const namesFor = (ids) => {
    const names = ids.map((id) => labelFor(roomState, id));
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };

  const warningEl = thieves.length
    ? el('p', { className: 'effects__warning', attrs: { id: 'steal-warning' } }, [
      el('strong', { text: `${namesFor(thieves.map((e) => e.other_id))} ${thieves.length === 1 ? 'is' : 'are'} copying your answer.` }),
      el('span', { text: ' Answering wrong burns them — but you lose the points too.' }),
    ])
    : null;

  const effectsHost = el('div', { className: 'effects', attrs: { id: 'effects' } });
  const showEffects = inRoom && others.length > 0;

  const paintEffects = () => {
    const errorEl = inRoom && roomState.error
      ? el('p', { className: 'notice notice--warn', attrs: { id: 'room-error' } }, roomState.error)
      : null;

    if (!showEffects) {
      mount(effectsHost, [errorEl]);
      return;
    }

    const expiredNow = now() >= deadline;

    if (picker) {
      if (pickedTarget && !others.some((m) => m.user_id === pickedTarget)) {
        pickedTarget = null;
      }
      const targetName = pickedTarget ? labelFor(roomState, pickedTarget) : '';
      const heading = picker === 'steal' ? "Copy a friend's answer" : 'Bet on a friend';
      const rows = others.map((m) => el('button', {
        className: `picker__row ${pickedTarget === m.user_id ? 'is-picked' : ''}`,
        attrs: { type: 'button' },
        on: {
          click: () => {
            pickedTarget = m.user_id;
            paintEffects();
          },
        },
      }, [
        el('span', { className: 'picker__name', text: labelFor(roomState, m.user_id) }),
        el('span', { className: 'picker__state', text: m.online ? 'online' : 'away' }),
      ]));

      const confirm = el('button', {
        className: 'btn btn--primary',
        text: picker === 'steal'
          ? (targetName ? `Copy ${targetName}'s answer` : 'Pick a friend')
          : (targetName ? `Bet on ${targetName}` : 'Pick a friend'),
        attrs: { type: 'button', id: 'btn-effect-confirm' },
      });
      confirm.disabled = !pickedTarget || expiredNow;
      confirm.addEventListener('click', async () => {
        if (!pickedTarget || expiredNow) return;
        confirm.disabled = true;
        const data = await room.useEffect(picker, pickedTarget);
        if (!data) {
          confirm.disabled = false;
          return;
        }
        picker = null;
        pickedTarget = null;
        if (data.kind === 'steal') {
          location.hash = '#reveal';
          return;
        }
        // The sync redraw happened while the picker was still open, so
        // close it with a fresh render rather than patching a host that
        // was replaced by that redraw.
        notify();
      });

      const cost = picker === 'steal'
        ? "You won't answer this round. If they haven't answered, they can burn you. One steal per game."
        : "+500 if they are right and you answer or steal this round. They won't know until the reveal. One side bet per game.";

      mount(effectsHost, [
        errorEl,
        warningEl,
        el('div', { className: 'picker', attrs: { id: 'effect-picker' } }, [
          el('p', { className: 'picker__heading', text: heading }),
          ...rows,
          el('p', { className: 'muted-note', text: cost }),
          confirm,
          el('button', {
            className: 'btn btn--secondary',
            text: 'Cancel',
            attrs: { type: 'button', id: 'btn-effect-cancel' },
            on: {
              click: () => {
                picker = null;
                pickedTarget = null;
                paintEffects();
              },
            },
          }),
        ]),
      ]);
      return;
    }

    const stealButton = el('button', {
      className: 'btn btn--effect',
      text: stealUsed ? 'Steal used' : 'Steal a friend',
      attrs: { type: 'button', id: 'btn-steal' },
      on: {
        click: () => {
          if (stealUsed || now() >= deadline) return;
          picker = 'steal';
          pickedTarget = null;
          paintEffects();
        },
      },
    });
    const betButton = el('button', {
      className: 'btn btn--effect',
      text: betUsed ? 'Side bet used' : 'Side bet',
      attrs: { type: 'button', id: 'btn-side-bet' },
      on: {
        click: () => {
          if (betUsed || now() >= deadline) return;
          picker = 'side_bet';
          pickedTarget = null;
          paintEffects();
        },
      },
    });
    stealButton.disabled = stealUsed || expiredNow;
    betButton.disabled = betUsed || expiredNow;

    mount(effectsHost, [
      errorEl,
      warningEl,
      el('p', { className: 'effects__title', text: 'EFFECTS — ONCE PER GAME' }),
      el('div', { className: 'effects__row' }, [stealButton, betButton]),
      pendingBet
        ? el('p', { className: 'effects__pending', text: `Side bet on ${labelFor(roomState, pendingBet.other_id)}: +500 if they are right.` })
        : null,
    ]);
  };
```

In the `paint` function, after the `optionEls` loop, update the effect buttons without rebuilding them:

```js
    for (const id of ['btn-steal', 'btn-side-bet', 'btn-effect-confirm']) {
      const b = effectsHost.querySelector(`#${id}`);
      if (!b) continue;
      if (id === 'btn-steal') b.disabled = expired || stealUsed;
      else if (id === 'btn-side-bet') b.disabled = expired || betUsed;
      else b.disabled = expired || !pickedTarget;
    }
```

Call `paintEffects()` before `paint()`:

```js
  paintEffects();
  paint();
```

In the `mount(root, [...])`, insert the effects host between the clues and the options:

```js
    ladderEl,
    clueHost,
    effectsHost,
    optionsHost,
```

- [ ] **Step 5: Add the effects styles**

Append to `client/styles/screens/round.css`:

```css
/* Party effects. The strip is text-first: the buttons say what they do,
   and the warning is a sentence, not a colour. */
.effects { margin: 0 12px 8px; }
.effects__title {
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 6px;
}
.effects__row { display: flex; gap: 8px; }
.btn--effect { font-size: 14px; padding: 8px 10px; }
.effects__warning {
  background: var(--highlight);
  border: var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  font-size: 12.5px;
  margin: 0 0 8px;
}
.effects__pending { font-size: 12px; color: var(--muted); margin: 6px 0 0; }
.picker {
  background: var(--surface);
  border: var(--border);
  border-radius: var(--radius-lg);
  padding: 10px;
}
.picker__heading { font-weight: 700; margin: 0 0 6px; }
.picker__row {
  display: flex;
  justify-content: space-between;
  width: 100%;
  background: var(--surface);
  border: var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  margin: 0 0 6px;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--ink);
}
.picker__row.is-picked { outline: 2px solid var(--gold); outline-offset: 1px; }
.picker__state { color: var(--muted); font-size: 12px; }
.picker .muted-note { margin: 4px 0 8px; }
.picker .btn { margin-top: 6px; }
```

- [ ] **Step 6: Run the client tests**

Run:

```bash
npx playwright test tests/client/room.spec.js -g "steal|picker|side bet|effects strip"
```

Expected: PASS. If the local stack is not running, start it with `npm run supabase:start` and serve functions with `npm run supabase:serve` in another terminal.

- [ ] **Step 7: Commit**

```bash
git add client/src/room.js client/src/screens/round.js client/styles/screens/round.css tests/client/room.spec.js
git commit -m "feat: add the round-screen effects strip and picker"
```

---

### Task 6: Reveal effects, waiting lines and thief verdict

**Files:**
- Modify: `client/src/screens/reveal.js`
- Modify: `client/styles/screens/reveal.css`
- Modify: `tests/client/room.spec.js`

**Interfaces:**
- Consumes: `result.effects`, `result.my_answer`, `roomState.myEffects` from Tasks 2-5.
- Produces: `#effects-result`, the waiting effect lines, and the "You copied Sam" verdict override.

- [ ] **Step 1: Write the failing reveal assertions**

The steal and side-bet tests in Task 5 stop at the reveal. Extend them with the reveal assertions, and add one test for the victim's story.

In the Task 5 steal test, before its final error assertion:

```js
  await expect(host.locator('#effects-result')).toContainText('You copied Sam', { timeout: 20000 });
```

In the Task 5 side-bet test, after its final reveal URL assertion:

```js
  await expect(host.locator('#effects-result')).toContainText(/You bet on Sam: (\+\d[\d,]*|no bonus)/, { timeout: 20000 });
```

Then add:

```js
test('the victim sees who copied them and keeps their points at the reveal', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await host.locator('#btn-steal').click();
  await host.locator('.picker__row').filter({ hasText: 'Sam' }).click();
  await host.locator('#btn-effect-confirm').click();
  await expect(host).toHaveURL(/#reveal/);

  await guest.locator('.option').first().click();
  await expect(guest).toHaveURL(/#reveal/);
  await expect(guest.locator('#effects-result')).toContainText(/Host copied your (answer|wrong answer)/, { timeout: 20000 });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run:

```bash
npx playwright test tests/client/room.spec.js -g "victim sees who copied"
```

Expected: FAIL because the reveal has no Effects card and no `#effects-result`.

- [ ] **Step 3: Add the waiting effect lines and the Effects card to `client/src/screens/reveal.js`**

Add the helper functions above `renderRoom`:

```js
/** "Alex", "Alex and Robin", "Alex, Robin and Sam". */
function namesFor(roomState, ids) {
  const names = ids.map((id) => labelFor(roomState, id));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Why the player is waiting, from their own effect rows. */
function waitingEffectLines(roomState, roundNumber) {
  const effects = (roomState.myEffects ?? [])
    .filter((e) => e.round_number === roundNumber);
  const thief = effects.find((e) => e.role === 'actor' && e.kind === 'steal');
  const victims = effects.filter((e) => e.role === 'target' && e.kind === 'steal');
  const bet = effects.find((e) => e.role === 'actor' && e.kind === 'side_bet');
  const usedSteal = effects.some((e) => e.role === 'actor' && e.kind === 'steal');
  const lines = [];

  if (thief) {
    lines.push(el('p', { className: 'muted-note', text: `You're copying ${labelFor(roomState, thief.other_id)}. The result appears when the round closes.` }));
  }
  if (victims.length) {
    const names = namesFor(roomState, victims.map((e) => e.other_id));
    lines.push(el('p', {
      className: 'muted-note',
      text: usedSteal
        ? `${names} ${victims.length === 1 ? 'is' : 'are'} copying you, but you used your steal — there is nothing to copy.`
        : `${names} ${victims.length === 1 ? 'is' : 'are'} copying your answer. Your answer is locked.`,
    }));
  }
  if (bet) {
    lines.push(el('p', { className: 'muted-note', text: `Side bet on ${labelFor(roomState, bet.other_id)}: +500 if they are right.` }));
  }
  return lines;
}

/** The reveal story for one effect. */
function effectStory(roomState, e, answer) {
  const me = roomState.me;
  const actor = labelFor(roomState, e.actor_id);
  const target = labelFor(roomState, e.target_id);

  if (e.kind === 'side_bet') {
    const bonus = e.bonus_points > 0 ? `+${pointsLabel(e.bonus_points)}` : 'no bonus';
    return e.actor_id === me
      ? `You bet on ${target}: ${bonus}.`
      : `${actor} bet on ${target}: ${bonus}.`;
  }

  if (e.actor_id === me) {
    if (e.target_stole) return `You copied ${target}, but ${target} used their own steal — nothing to copy.`;
    if (!e.target_answered) return `${target} didn't answer — nothing to copy.`;
    if (e.target_correct) return `You copied ${target}'s answer. ${target} was right — you earned ${pointsLabel(e.actor_points)}.`;
    return `You copied ${target}'s answer. ${target} was wrong — you got nothing.`;
  }

  if (e.target_id === me) {
    if (e.target_stole) return `${actor} copied you, but you used your steal — there was nothing to copy.`;
    if (!e.target_answered) return `${actor} tried to copy you, but you didn't answer.`;
    if (e.target_correct) return `${actor} copied your answer. You still earned ${pointsLabel(answer?.points ?? 0)}.`;
    return `${actor} copied your wrong answer — you both got nothing.`;
  }

  if (e.target_stole) return `${actor} copied ${target}, but ${target} used their own steal — nothing to copy.`;
  if (!e.target_answered) return `${actor} copied ${target} — nothing to copy.`;
  if (e.target_correct) return `${actor} copied ${target}. ${actor} earned ${pointsLabel(e.actor_points)}.`;
  return `${actor} copied ${target}'s wrong answer — neither scored.`;
}
```

Change the top of `renderRoom`:

```js
function renderRoom(root, roomState) {
  const answeredRound = roomState.answeredRound;
  const result = roomState.lastResult;
  const showResult = Boolean(result && result.round_number === answeredRound);

  if (!showResult && answeredRound) {
    // The answer only exists once the round has closed. Ask for it, and
    // ask again no more often than the poll.
    const now = Date.now();
    if (!roomState.lastResultAskedAt || now - roomState.lastResultAskedAt > 2000) {
      roomState.lastResultAskedAt = now;
      room.result(answeredRound);
    }
    mount(root, [
      el('header', { className: 'topbar' }, [
        el('span', { className: 'wordmark', text: '⚽ Football Trivia' }),
      ]),
      el('section', { className: 'card', attrs: { id: 'reveal-waiting' } }, [
        el('h1', { className: 'page-title', text: 'Waiting for the round to close' }),
        el('p', { className: 'muted-note', text: 'The answer is shown once everyone has answered or the time is up.' }),
        ...waitingEffectLines(roomState, answeredRound),
      ]),
    ]);
    return;
  }

  const answer = result?.my_answer ?? roomState.myAnswer;
  const roundNumber = result?.round_number ?? answeredRound ?? roomState.currentRound;
```

Replace the old `const result = roomState.lastResult; const answer = roomState.myAnswer; const roundNumber = ...` lines. Keep the rest of the function; `result` is now the matching result.

After the `roomKey` sound block and before `mount`, compute the effects:

```js
  const effects = result?.effects ?? [];
  const mySteal = effects.find((e) => e.kind === 'steal' && e.actor_id === roomState.me);
  const ordered = [...effects].sort((a, b) => {
    const aMine = a.actor_id === roomState.me || a.target_id === roomState.me ? 0 : 1;
    const bMine = b.actor_id === roomState.me || b.target_id === roomState.me ? 0 : 1;
    return aMine - bMine;
  });
  const effectsCard = effects.length
    ? el('section', { className: 'card', attrs: { id: 'effects-result' } }, [
      el('h2', { className: 'section-title', text: 'Effects' }),
      ...ordered.map((e) => el('p', { className: 'effect-line', text: effectStory(roomState, e, answer) })),
    ])
    : null;

  let verdictHeadline;
  if (mySteal) {
    const target = labelFor(roomState, mySteal.target_id);
    verdictHeadline = (mySteal.target_stole || !mySteal.target_answered)
      ? 'Nothing to copy'
      : `You copied ${target} — ${mySteal.target_correct ? 'correct' : 'wrong'}`;
  } else {
    verdictHeadline = answer?.correct ? 'You got it' : `It was ${answerText}`;
  }
```

Replace the verdict section's strong text:

```js
    el('section', { className: `card verdict ${answer?.correct ? 'is-good' : 'is-bad'}` }, [
      el('strong', { text: verdictHeadline }),
      el('span', { className: 'verdict__points', text: pointsLabel(answer?.points ?? 0, { signed: true }) }),
    ]),

    effectsCard,

    el('section', { className: 'card' }, [
```

The `effectsCard` goes after the verdict and before the running score.

- [ ] **Step 4: Add the reveal styles**

Append to `client/styles/screens/reveal.css`:

```css
.effect-line {
  font-size: 13px;
  line-height: 1.45;
  padding: 6px 0;
  border-bottom: var(--border);
  margin: 0;
}
.effect-line:last-child { border-bottom: 0; }
```

- [ ] **Step 5: Run the reveal tests and the room suite**

Run:

```bash
npx playwright test tests/client/room.spec.js
```

Expected: PASS for the room suite. The known unrelated generated-slice/meta 404 failures are outside this spec file.

- [ ] **Step 6: Commit**

```bash
git add client/src/screens/reveal.js client/styles/screens/reveal.css tests/client/room.spec.js
git commit -m "feat: show party effects at the reveal"
```

---

### Task 7: Drop the room's "of X possible" line

**Files:**
- Modify: `client/src/screens/results.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: the room results screen no longer claims a maximum that side-bet bonuses can exceed.

- [ ] **Step 1: Remove the line and the now-unused maximum**

In `renderRoom` of `client/src/screens/results.js`, remove:

```js
  const max = roomState.totalRounds * 7500;
```

and remove this element from the hero:

```js
      el('p', { className: 'muted-note', text: `of ${pointsLabel(max)} possible` }),
```

Leave the solo results screen's `const max = quiz.rounds.length * 7500;` and its "Points possible" row alone.

- [ ] **Step 2: Verify the room path no longer references a maximum**

Run:

```bash
rg -n "possible|const max" client/src/screens/results.js
```

Expected: only the solo `const max` and the solo "Points possible" row remain; neither is in `renderRoom`.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/results.js
git commit -m "fix: stop claiming a room maximum score"
```

---

### Task 8: Full verification and hosted rollout

**Files:**
- No code changes; verification only.

**Interfaces:**
- Consumes: every task above.
- Produces: a deployed build and a live two-account check.

- [ ] **Step 1: Run the full Node suite**

Run:

```bash
npm test
```

Expected: all tests pass; integration tests skip when the local stack is down. With the stack up, the existing 273-test suite plus the new effects tests pass.

- [ ] **Step 2: Run the room Playwright suite**

Run:

```bash
npx playwright test tests/client/room.spec.js
```

Expected: PASS. Do not use the full Playwright suite as the gate: the repo has known unrelated generated-slice/meta 404 failures.

- [ ] **Step 3: Confirm the migration is safe to apply to the hosted project**

Check that the migration only adds `room_effects`, its policy, its publication entry, and replaces the three functions with the latest bodies. Run a local diff against the previous function definitions if needed:

```bash
rg -n "scope_icon|server_now|my_effects|effects'|use_room_effect" supabase/migrations/20261026000100_room_effects.sql
```

Expected: `scope_icon`, `server_now`, `my_effects`, `effects` and `use_room_effect` are all present. `advance_room` still has the host-transfer, final and abandoned branches.

- [ ] **Step 4: Deploy through the normal hosted path**

Run:

```bash
npm run deploy:hosted
```

This pushes the migration, deploys the functions (including the changed `submit-answer`), uploads the pool, syncs the client config, publishes `dist/`, and deploys the site.

- [ ] **Step 5: Verify live with two accounts**

On `https://football-trivia-xi.vercel.app/`:

1. Create a room with account A, join with account B, start the game.
2. As A, use a steal on B. Confirm A moves to the waiting reveal and B sees "A is copying your answer."
3. As B, answer. Confirm A's reveal says "You copied B" and shows the copied answer and half points.
4. In another round, as A, place a side bet on B before answering. Confirm the pending line appears and the reveal shows the +500 or no-bonus story.
5. Confirm the room results screen has no "of X possible" line.
6. Confirm no console or page errors in either browser.

- [ ] **Step 6: Commit any config change produced by the deploy**

The deploy script rewrites `client/src/config.js` to the hosted project. If it changed:

```bash
git add client/src/config.js
git commit -m "chore: point the client at the hosted project"
```

Do not commit generated secrets. The script uses the existing environment values.

---

## Self-Review Notes

- Spec coverage: table/RLS/realtime (§5.1-5.2), placement RPC (§5.3), resolution (§5.4), result (§5.5), state (§5.6), guard (§5.7), client state (§5.9), UI (§6), privacy (§7), tests (§8), rollout (§9) all map to a task.
- The only SQL scoring logic is the half-point copy and the +500 bonus, both covered by integration tests.
- The client never reads `room_effects` directly; it uses `sync_room_state.my_effects` and `round_result.effects`. The direct-select RLS tests pin the table's second line of defence.
- `advance_room` is copied from the existing body; the effect block is inserted before the score roll-up. `sync_room_state` is copied from the latest body so `scope_icon` and `server_now` survive.
- No placeholders: every code step shows the code to write, every test step shows the assertion, and every command is exact.
