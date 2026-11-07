# v1.5: The Collective Groan and question reports

Date: 2026-11-07
Status: approved 2026-11-07; implementation plan in
`../plans/2026-11-07-collective-groan-and-question-reports.md`
Base: `0815423` (v1.4.1 live)
Phase: social payoff and question-quality loop

## 1. Context

v1.4.1 fixed the clues, but a room still goes quiet between rounds. The
only social move is an effect: one steal and one side bet per player per
game. When a question lands badly, players have no way to say so, and the
team has no way to hear it.

Two small additions close that loop without touching scoring, the round
loop, or the planner:

- **The Collective Groan** — a one-tap reaction on the reveal, so the
  room can groan together.
- **Question reports** — a one-tap report on the reveal, so a bad
  question leaves evidence for review.

Both are room-only. Solo play is untouched.

This spec follows the GPT-bridge consultation of 2026-11-07, where the
Collective Groan was the cheapest inclusive social payoff and the
question-quality loop was the missing piece across all eight ideas.

## 2. Goals and non-goals

### Goals

- Let every room player react once per round after the reveal.
- Show who reacted with what, using the room's existing name
  disambiguation, with no points or effects attached.
- Let every room player report a bad question once per round, with a
  reason and an optional note.
- Keep reactions hidden until the round has closed.
- Keep reports after a rematch, even though the round rows are deleted.
- Give the team a read-only review surface with the full question
  snapshot.
- Reuse the existing 2-second room poll; add no new timer, no realtime
  subscription, and no edge function.
- Keep old clients working.

### Non-goals

- Reactions or reports in solo play.
- An admin UI, moderation queue, or host-facing report list.
- Free-text chat or custom reaction text.
- Reaction streaks, achievements, or points.
- Changing the round clock, scoring, effects, reveal, results, or
  rematch behaviour.
- Realtime push for reactions. The poll is fast enough at this scale.
- Editing or retracting a reaction or report after it is sent.

## 3. The Collective Groan

### Player flow

1. The round closes and the player's reveal shows the answer, verdict,
   IQ block, and effects as it does today.
2. Below the effects and above the running score, the reveal shows
   **"How did that feel?"** with three chips:
   - **Knew it**
   - **No chance**
   - **Fair play**
3. The player taps one. The chip locks, all three chips disable, and the
   player's name appears under their choice.
4. Everyone else's reactions arrive on the normal 2-second room poll.
   Each non-empty chip lists the names that chose it, for example
   "Knew it — Sam, Alex #2".
5. The strip stays until the player leaves the reveal. On a rematch it is
   gone with the old rounds.

The chips are buttons with `aria-pressed`. A failed reaction shows the
existing room error notice, which the reveal gains for this feature.

"Knew it" is allowed after a wrong answer. That is the joke.

The strip is shown even when nobody has reacted, so the room can see the
affordance. It is not shown while the reveal is still waiting for the
round to close.

### Rules

- One reaction per player per round. The first tap wins; a retry returns
  the stored reaction and does not change it.
- Any room member may react to a closed round, whether they answered it,
  stole it, or watched. Reactions are a social signal, not a score.
- Values are the allowlisted keys `knew_it`, `no_chance`, `fair_play`.
  The labels are the client's business.
- Reactions never touch points, effects, the leaderboard, or the result
  payload.
- Reactions are ephemeral: they cascade-delete with their round on a
  rematch.

### Data

```sql
create table public.round_reactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,
  reaction text not null check (reaction in ('knew_it', 'no_chance', 'fair_play')),
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);
create index round_reactions_round_idx on public.round_reactions (round_id);

alter table public.round_reactions enable row level security;
```

Row-level security is enabled with **no client policies**. Clients read
through `sync_room_state` and write through `react_to_round`, both
`security definer`. The anon and authenticated roles cannot select or
insert the table directly.

### RPC: `react_to_round`

```
react_to_round(p_room_id uuid, p_round_number int, p_reaction text)
  returns jsonb
```

- Requires a signed-in user who is a member of the room.
- Requires the round to belong to the room.
- Rejects while the round is still open: `closed_at is null` and
  `now() <= deadline_at` raises `the round is still open`.
- Rejects a value outside the allowlist with `unknown reaction`.
- Stores the caller's display name from the membership, so a player who
  leaves the room keeps their name under the reaction.
- Inserts with `on conflict (round_id, user_id) do nothing`.
- Returns `{ ok: true, reaction: <stored value> }`, so a duplicate tap
  gets the first choice back.

### Sync payload

`sync_room_state` gains two keys:

- `reactions_round`: the caller's `my_answered_round`. A steal writes a
  placeholder `answers` row, so a thief is already covered.
- `reactions`: an array of
  `{ user_id, display_name, reaction }`, ordered by `created_at`, for
  `reactions_round` only. `display_name` is the current membership name,
  falling back to the name stored with the reaction. The array is empty
  while that round is open.

The existing `my_answered_round`, `my_answer`, and `my_effects` keys keep
their current meaning. Old clients ignore the new keys.

The payload is at most one small row per player, so the poll does not
grow in any meaningful way.

## 4. Question reports

### Player flow

1. At the bottom of the room reveal, below the running score and above
   the next button, a quiet link reads
   **"Something off with this question?"**
2. Tapping it opens a native modal dialog with four reason chips:
   - **Ambiguous**
   - **Two right answers**
   - **Answer looks wrong**
   - **Other**
   and an optional note field, capped at 280 characters.
3. Send stores the report and closes the dialog. The reveal then shows
   "Thanks — flagged." for that round and stops offering the link.
4. If the send fails, the dialog stays open with the chosen reason and
   note intact, and shows the error inside the dialog.
5. Nothing is shown to the other players.

The dialog is a native `<dialog>` mounted on `document.body`, outside
the reveal's re-rendered root. The room poll redraws the screen every two
seconds; a form inside that tree would lose focus mid-sentence. The
dialog is not re-rendered by the poll. On close it is removed.

The link is not shown while the reveal is waiting for the round to
close, or in solo play.

### Rules

- One report per player per round. A retry is a no-op.
- Reasons are the allowlisted keys `ambiguous`, `two_answers`,
  `looks_wrong`, `other`. The labels are the client's business.
- The note is trimmed; empty becomes null. More than 280 characters is
  rejected rather than silently truncated.
- Reports are write-only for clients. There is no player-facing read
  path.
- Reports survive a rematch. The round row is deleted, so `round_id`
  becomes null; the frozen question snapshot remains.

### Data

```sql
create table public.round_reports (
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
create unique index round_reports_once
  on public.round_reports (round_id, user_id)
  where round_id is not null;
create index round_reports_created_idx
  on public.round_reports (created_at desc);

alter table public.round_reports enable row level security;
```

Again: RLS enabled, no client policies. The partial unique index keys on
`round_id`, so the old game's reports do not collide with a rematch's
round one after the old `round_id` is nulled.

### Snapshot

`report_round` freezes the question at report time. It builds the
snapshot server-side from the round, its secret, and the room:

```json
{
  "game_mode": "football_iq",
  "format": "club",
  "clue_family": null,
  "prompt": "Which club did ... play for in 2015/16?",
  "context": "La Liga",
  "clues": [{ "id": "club-goals", "label": "The season", "value": "..." }],
  "options": [{ "label": "Sevilla", "value": "..." }],
  "answer": "Sevilla",
  "unit": null,
  "reveal": { "...": "format-specific reveal payload" },
  "scope_id": "wc-2022",
  "scope_name": "World Cup 2022",
  "scope_clauses": []
}
```

`format` is `rounds.template`; `reveal` is `round_secrets.reveal` when
present. The snapshot is plain data, never rendered as HTML anywhere.

### RPC: `report_round`

```
report_round(p_room_id uuid, p_round_number int, p_reason text, p_note text)
  returns jsonb
```

- Requires a signed-in member of the room and a round that belongs to
  it.
- Rejects an open round, an unknown reason, and an over-long note.
- Stores the room, round id, round number, reporter, reason, note, and
  the snapshot.
- Inserts with `on conflict do nothing`.
- Returns `{ ok: true }` even when a report already exists, so the
  client can treat a retry as success.

### Review surface

A `question_reports` view, newest first:

```sql
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
```

The view is for the dashboard or service role only. The team can group
repeats with a query like:

```sql
select format, prompt, count(*) as reports, array_agg(reason order by reason) as reasons
from public.question_reports
group by format, prompt
having count(*) > 1
order by reports desc;
```

## 5. Edge cases and failure modes

- **Thief reveal.** A steal writes a placeholder `answers` row, so
  `my_answered_round` already covers the thief. No special case.
- **Player never answered.** That player never reaches the reveal, so no
  reactions or reports. Existing behaviour; not changed.
- **Late reveal.** The reveal stays open after the server starts the next
  round. Reactions remain valid for the closed round and are keyed by
  `reactions_round`, so the strip does not jump to the new round's empty
  list.
- **Final round.** The room poll slows to 5 seconds after the final
  round. Reactions can arrive up to 5 seconds late on that one screen.
  Accepted at friend-group scale; no extra timer.
- **Rematch.** Reactions cascade-delete with the rounds. Reports keep
  their snapshot and lose `round_id`. The lobby reset clears the client's
  reaction state.
- **Duplicate names.** The client renders names with the existing
  `labelFor` helper, so "Alex #2" stays consistent. If a member left
  before the poll, the reaction's stored `display_name` is the fallback.
- **Spam.** One row per player per round per table. No extra rate limit.
- **Bad note input.** Stored as plain text, length-capped in SQL and in
  the client, never rendered as HTML in this release.
- **Old clients.** New payload keys are additive and new tables are
  unreachable, so an old client is unaffected. The new client must ship
  after the migration.
- **Server error.** A failed reaction shows the reveal's room error
  notice and the player can retry. A failed report keeps the dialog open
  with the chosen reason and note intact and shows the error inside it.
- **Rematch while the dialog is open.** The report RPC fails because the
  round is gone. The dialog shows the error; cancelling it returns to
  the lobby on the next render.

## 6. Testing

### Integration (`tests/integration/reactions.test.js`)

- A reaction before the round closes is rejected; after it closes it is
  stored.
- A duplicate reaction with a different value returns the first value.
- A non-member and an unknown value are rejected.
- `sync_room_state` returns no reactions while the round is open and the
  expected rows after it closes.
- A thief's placeholder answer row still gives them `reactions_round`
  for that round, so they see the same strip.
- A report stores the reason, trimmed note, and a snapshot containing the
  prompt, clues, options, answer, format, mode, and scope.
- An empty note stores null; a 281-character note is rejected; an unknown
  reason is rejected; a duplicate report is a no-op.
- After `reset_room`, the report's `round_id` is null, the snapshot is
  intact, and a new report in the rematch is accepted.
- The anon client reads no rows from `round_reactions` or
  `round_reports`, and is denied on `question_reports`.

### Shared unit (`tests/shared/room-state.test.js`)

- Folding reactions stores the round and rows.
- A lobby reset clears reactions and the reaction round.
- A payload without reaction keys leaves the previous state alone.

### Client (Playwright, `tests/client/room.spec.js`)

- Two players answer one round; both react; each sees both names under
  the right chips; the chips lock.
- A report is sent through the dialog and the row is verified with the
  service client; the link becomes "Thanks — flagged."
- The existing "reveal does not hammer the server" test stays green.

### Full suites

- `npm test`
- `npx playwright test tests/client/room.spec.js`
- The room integration suites against the local stack.

## 7. Rollout and compatibility

- One migration, `20261107000100_reactions_and_reports.sql`: tables,
  policies, RPCs, view, and the `sync_room_state` replacement.
- No engine change and no edge-function change. Reactions and reports
  use direct RPCs.
- Apply the migration to production **before** pushing the client, so
  the RPCs and the new sync key exist when Vercel publishes.
- Old clients keep working against the new database.
- Local verification: `npm run supabase:reset`, start the function
  server for the room suites, sync the client config for Playwright, and
  restore `client/src/config.js` afterwards.
- Live check: a two-player room, one round; both react; one report;
  confirm the row and snapshot through the service role, then confirm
  the view is not readable with the anon key.

## 8. Done when

- A room reveal offers three reactions, one per player per round, with
  names and no scoring effect.
- Reactions never appear before the round closes.
- A room reveal offers the report link, stores one report per player per
  round with a full snapshot, and shows the thanks state.
- A rematch removes reactions but keeps every report.
- `question_reports` is readable by the service role and not by players.
- The room poll carries reactions without a new timer or subscription.
- Solo play, scoring, effects, the reveal, results, and rematch behave as
  before.
