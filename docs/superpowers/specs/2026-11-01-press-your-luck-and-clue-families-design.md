# v1.3: Press-your-luck and clue families

Date: 2026-11-01
Status: design approved in conversation; written spec awaiting review
Base: `39bc8c5` (v1.2 live at `https://football-trivia-xi.vercel.app/`)
Phase: 1 of the richness work

## 1. Context

The live game is a guess-the-player quiz. v1.2 added three stat-value
rounds to every ten, but a numeric prompt is a different game: the
question stops being "who is this?" and becomes "how many?". The clues
were built to identify a player, so they help a stat question only by
accident.

This release returns the current mode to a pure guess-the-player quiz
and makes the ten rounds feel different from one another. It adds two
sources of tension:

1. **Press your luck** — one clue is free. Every further clue lowers
   the multiplier, so information costs points.
2. **Clue families** — each round draws from a different kind of clue
   ladder: career, teammates, records, profile, or a mix. Ten rounds no
   longer tell the same story ten times.

The stat recipes, the planner's `statRounds` option, numeric scoring,
and the unit UI stay in the engine, dormant. Phase 2 reuses that
machinery for a separate Football IQ mode.

This spec supersedes section 3.1 of
`2026-10-28-rematch-and-stat-rounds-design.md` (the stat-round mix).
The rematch and reliability sections of that spec remain in force.

## 2. Goals and non-goals

### Goals

- Solo and room games plan ten `identify` rounds and zero `stat_value`
  rounds. The current mode is guess-the-player only.
- One clue is visible when the round opens. The player chooses when to
  reveal the next clue, up to the round's clue count.
- The stage multiplier follows the first N entries of 5, 3, 2, 1 by the
  number of visible clues. The 20-second clock and the 1.0–1.5x speed
  bonus remain.
- The reveal shows the scoring breakdown: clue multiplier, speed
  factor, and points. The breakdown always agrees with the awarded
  points.
- A ten-round game uses five clue families, two rounds each: career
  trail, teammate trail, record book, profile, and mixed. A family that
  cannot supply a usable ladder falls back to mixed.
- The round screen shows the family label.
- Teammate clues name real club-season teammates, and every named
  teammate is excluded from the four options.
- Rooms give each player their own clue progress. Revealing a clue is
  server-authoritative and changes only that player's view.
- The answer stage in a room comes from the server's clue index, not
  from the client's clock.
- An old client in a room still sees the v1.2 timed ladder and receives
  the timed stage.

### Non-goals

- Football IQ mode or any non-guess-the-player answer type. That is
  Phase 2.
- New effects, a new scoring curve, a new round length, or a new player
  pool.
- Removing the stat recipes, the `statRounds` planner option, numeric
  scoring, or the unit UI. They stay dormant and tested.
- A "reveal all" button, clue purchases, extra lives, or per-clue
  timers.
- Changing rematch, the pointer-aware render guard, the fail-closed
  steal guard, or any other v1.2 reliability behavior.
- A shared room clue index. Progress is per player by design.

## 3. Design

### 3.1 Remove stat rounds from the current mode

- `client/src/store.js` `startQuiz` stops passing `statRounds: 3`. The
  planner default `0` applies.
- `supabase/functions/_shared/start-room.js` stops passing
  `statRounds: 3`.
- The rest of both planner calls stays as it is. `phases: ['v1.1']` may
  remain: with no stat slots it only gates recipes that are never
  selected.
- `planQuiz` keeps its `statRounds` argument, the `stat_value` recipes,
  `numericDistractors`, `answerRound`'s numeric branch, and the
  unit-labelled option and reveal UI. A caller can still request stat
  rounds; nothing in the shipped game does.
- Tests:
  - The solo mix test becomes "a solo quiz is ten identify rounds".
  - The room-level stat test is retired because the shipped room no
    longer produces stat rounds. The dormant capability stays covered
    by engine unit tests: a stat round composes four numeric options,
    carries a unit, and has no clue that repeats the answer number.
  - The planner's `statRounds: 3` test stays, because it proves the
    dormant option still works.
- The results recap currently says "N different kinds of question" from
  `summary.metricFamilies`. An all-identify quiz has one family, so that
  line would disappear. The planner summary gains
  `clueFamilies: new Set(plan.map(r => r.clueFamily)).size`, and the
  results screen shows "N kinds of clue" when it is greater than one.

### 3.2 Press-your-luck round loop

#### Engine

- `composeRound` already takes `stages`; the planner keeps its existing
  clue-count curve (three clues early, four later for medium). The
  multiplier ladder is the first N entries of `5, 3, 2, 1`. A three-clue
  round therefore tops out at x2 after the last reveal; a four-clue
  round reaches x1.
- The engine still emits `revealSchedule`. The new client ignores it;
  old room clients still use it.
- The first clue is clue index `0`. The visible count is
  `clueIndex + 1`. The stage is the visible count.
- `STAGE_MULTIPLIERS` and `scoreRound` do not change.

#### Solo

- The round screen keeps `clueIndex` in module state, reset when the
  round key changes (the same pattern as `revealedBefore` and
  `lastRoundKey`).
- At round start, `clueIndex = 0`: the first clue is visible, the rest
  are locked.
- "Reveal next clue" increments `clueIndex`, plays the existing reveal
  sound and haptic, and shows the next value. It is disabled while the
  round is expired.
- Answering sends `stage = clueIndex + 1` and `elapsedMs = now -
  startedAt` to `answerRound`.
- The answer entry stores the returned `multiplier` and `timeFactor`
  alongside `stage`, `points`, `correct`, `chosen`, and `answer`.
- The reveal reads those stored values for the breakdown.

#### Rooms

- The server is the source of truth. The client never sends a stage; it
  sends `on_demand: true` and the server derives the stage from the
  player's clue index. See 3.4.
- The round screen uses `round.clue_index + 1` as the visible count and
  `round.clue_total` as the ladder length.
- "Reveal next clue" calls `room.revealClue()`, disables while the call
  is in flight, and updates from the response. A refusal shows the room
  error.
- The answer call sends `on_demand: true`; the response's `stage` is the
  server's stage.

#### Shared UI

- The clue ladder has one step per clue, labelled with its multiplier.
  The first step is marked done at round start; the current step is
  highlighted.
- The "Reveal next clue" button sits under the ladder and names the
  next multiplier: `Reveal next clue (x3)`. When every clue is visible,
  the button is replaced by "All clues revealed."
- The clock keeps ticking for the whole 20 seconds. Waiting to reveal
  costs speed, so information and speed pull against each other.
- The existing last-five-seconds tick sound and urgent timer styling
  stay.

#### Scoring breakdown

- Points are `1000 x multiplier x timeFactor`, exactly as `scoreRound`
  computes them.
- Solo: `answerRound` returns `multiplier` and `timeFactor`; the reveal
  shows them.
- Room: the Phase 1 `round_result` adds `response_time_ms` to
  `my_answer` (the current function returns only `correct`, `points`,
  `stage`, and `guessed_answer`). `sync_room_state` adds the same field
  for the fallback path. The reveal recomputes the multiplier from
  `STAGE_MULTIPLIERS[stage]` and the time factor with `scoreRound`, so
  the displayed breakdown cannot drift from the awarded points.
- The reveal line reads like `x5 clue stage . 1.32x speed`. A wrong
  answer shows the same breakdown with 0 points.
- A steal that copied a target's answer shows the copied stage and
  speed, because the server copies the target's `stage_locked` and
  `response_time_ms`. A steal that copied nothing shows the existing
  effect story and no breakdown.

### 3.3 Clue families

#### Families and ladders

Each family is an ordered clue ladder. `composeRound` fills from the
family ladder first, then from the generic ladder if the family is
short, deduplicating by clue id, and takes the first N clues in ladder
order. It does not apply the mixed ladder's hard/profile/home reordering
to a family ladder: the family already puts the easy surface clue last.

| id | label | ladder | fallback |
|---|---|---|---|
| `career_trail` | Career trail | stage, trail, record, home | mixed |
| `teammate_trail` | Teammate trail | teammate, teammate, trail, profile/home | mixed |
| `record_book` | Record book | record 1, record 2, record 3, home/profile | mixed |
| `profile` | Profile | role, birth year, home, height | mixed |
| `mixed` | Mixed bag | stage, trail, record, profile/home | — |

- **Career trail** is the current default ladder, promoted to a named
  family.
- **Teammate trail** builds a club-season index from the pool:
  `clubId|season -> players`. For the subject, it collects distinct
  teammates across the subject's club-seasons. It picks up to three,
  seeded, preferring different clubs and seasons. Each clue reads
  `Played with **{name}** at **{club}** in **{season}**.` The subject is
  never a teammate clue. If the subject has fewer than two teammates in
  the pool, the family falls back to mixed.
- **Record book** refactors `recordHint` into `recordHints`, returning
  every eligible comparison sorted by rank, ties, then metric priority.
  It uses up to three distinct metrics and skips the stage's metric. If
  fewer than two are available, it falls back to mixed.
- **Profile** splits `profileHint` into separate role, birth-year, home,
  and height clues. Height is used only when `heightCm` is present. At
  least two profile clues must be available, otherwise the family falls
  back to mixed.
- **Mixed** is the current `buildHints` order, unchanged.

The effective family is the requested family when at least two of its
own clues made the ladder; otherwise it is `mixed`. The round carries
the effective id, so the label is always honest.

#### Planner assignment

- The planner assigns a family to every `identify` slot before
  composing. For ten rounds the schedule is two of each family, shuffled
  with the seeded RNG. For other round counts, it cycles the five
  families in a seeded order and takes one per round.
- The existing no-consecutive-metric and no-repeated-subject rules still
  apply. The family does not change subject selection; a family with too
  little data for the chosen subject falls back to mixed.
- The plan can therefore have fewer than two of a family and more than
  two mixed rounds. The summary reports the effective counts.

#### Options

- `nameDistractors` gains an `excludeIds` argument. `composeRound`
  collects every `teammateId` from the selected clues and passes it, so
  a named teammate is never one of the four options. The subject is
  already excluded.
- The pool floor of 20 players leaves enough names after the exclusions;
  the existing padding remains a last resort.

#### Labels and UI

- Add `role`, `born`, `height`, and `teammate` to the hint labels. The
  existing `profile` and `home` labels stay.
- Export `CLUE_FAMILY_LABELS` from the engine. The round screen maps
  `round.clueFamily` (solo) or `round.clue_family` (room) to the chip
  text.
- The chip sits next to `Round X of N` in the round meta row.

### 3.4 Room clue progress

#### Schema

Additive migration `20261101000100_press_your_luck.sql`:

```sql
alter table public.rounds add column if not exists clue_family text;

create table if not exists public.round_progress (
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clue_index int not null default 0 check (clue_index >= 0),
  updated_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

alter table public.round_progress enable row level security;

create policy round_progress_select on public.round_progress for select
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.rounds r
      where r.id = round_id and public.is_room_member(r.room_id)
    )
  );
```

- A member may `select` only their own rows, and only while they are a
  member of the round's room. There is no client insert or update
  policy; all writes go through `reveal_clue`.
- `round_progress` is not added to the realtime publication. The
  two-second poll is enough, and the reveal response updates the caller
  immediately.
- Rows cascade when a round is deleted, including a rematch.

#### `reveal_clue`

```sql
public.reveal_clue(
  p_room_id uuid,
  p_round_number int,
  p_clue_index int
) returns jsonb
```

- Requires `auth.uid()` and room membership.
- Refuses unless the room is `round_active`, the round is the current
  round, it is not closed, and `now() <= deadline_at`.
- `clue_total` is `jsonb_array_length(round.clues)`.
- Reads the caller's progress row; no row means index `0`.
- If `p_clue_index` is not the current index, this is a stale or
  double tap: return the current state without advancing.
- If the current index is already `clue_total - 1`, return it unchanged.
- Otherwise upsert `clue_index = current + 1` and return
  `{ round_number, clue_index, clue_total, clues }`, where `clues` is
  the full ladder with values present up to the new index and `null`
  above it. The client replaces its ladder from this response.
- The RPC does not update `last_seen_at`; the poll does.

#### `current_round` and `sync_room_state`

- Drop the old one-argument `current_round(uuid)` and
  `sync_room_state(uuid)` functions, then create each with a second
  argument `p_on_demand boolean default false`. Both the old one-arg
  call and the new two-arg call resolve to the new function.
- `sync_room_state` forwards the flag to `current_round`.
- `current_round` reads the caller's `round_progress` row and clamps the
  index to `0 .. clue_total - 1`.
- With `p_on_demand = true`, the round payload keeps every clue's `id`,
  `label`, and `iconKey`, sets `value` to `null` above the caller's
  index, omits `reveal_schedule`, and adds `clue_index`, `clue_total`,
  and `clue_family`.
- With `p_on_demand = false`, the payload is the v1.2 shape: all clue
  values and the full `reveal_schedule`. It also carries `clue_index =
  0`, `clue_total`, and `clue_family`; an old client ignores the extra
  fields.
- A round row carries `clue_family` for both shapes.

#### `submit-answer`

- Accept `on_demand` in the body, default `false`.
- With `on_demand: true`, the stage is
  `clamp(progress.clue_index + 1, 1, clue_total)`. No progress row means
  stage `1`. The reveal schedule is not consulted.
- With `on_demand: false`, keep the v1.2 stage: the number of scheduled
  reveals whose `revealAtMs` has passed. This is the old-client
  compatibility path.
- The rest of the scoring, the duplicate-answer retry, and the steal
  refusal are unchanged.

#### `use_room_effect`

- When a steal writes the thief's placeholder answer, its stage is the
  thief's own `clue_index + 1` when a progress row exists, otherwise the
  existing timed stage. The placeholder is overwritten with the target's
  stage, response time, and half points when the target answers. An
  unresolved steal still shows the existing "nothing to copy" story.

#### `advance_room` and `round_result`

- `advance_room` inserts `clue_family` from
  `v_next->'client'->>'clue_family'` for every new round. Replace the
  current definition so later rounds carry the family too.
- `round_result` returns `clue_family` and `clue_total` in addition to
  the existing fields, and adds `response_time_ms` to `my_answer`. The
  reveal uses the stage and response time for the breakdown.
  `sync_room_state` adds the same field to its `my_answer`.
- `start-room` inserts `clue_family` for round one and includes it in
  its `roundPayload`.

#### Projection

- `projectRound` adds `clue_family: round.clueFamily` to the client
  payload. The secret is unchanged.
- `quiz_plans.plan` carries the family with each round; no other schema
  change is needed.

#### Client room

- `room.state.round` gains `clue_index`, `clue_total`, and
  `clue_family`.
- `room.revealClue()` calls `reveal_clue` with the current round number
  and the current `clue_index`. On success it updates the round's
  `clue_index`, `clue_total`, and `clues`, then notifies. It does not
  wait for a sync.
- `room.sync()` and `room.restore()` call `sync_room_state` with
  `p_on_demand: true`. `room.answer()` sends `on_demand: true`.
- `applyRound` keeps the larger `clue_index` when the incoming payload
  is the same round, so a poll that races a reveal cannot move the
  ladder backwards. Within a round, progress only increases.
- The round screen's timed `revealedStages` helper is replaced by the
  server's `clue_index + 1` in rooms and the local index in solo. The
  timer still drives the countdown, expiry, and tick sounds.

### 3.5 Data and API changes

| Change | Type | Notes |
|---|---|---|
| `rounds.clue_family` | column | nullable; identify rounds carry the effective family |
| `round_progress` | table | per-player clue index; cascade from rounds; select-own RLS |
| `reveal_clue(uuid,int,int)` | RPC | advances the caller's clue index; returns visible clues |
| `current_round(uuid,boolean)` | RPC | on-demand flag; returns index, total, family, truncated values |
| `sync_room_state(uuid,boolean)` | RPC | forwards the on-demand flag |
| `submit-answer` | edge function | `on_demand` flag; stage from progress |
| `use_room_effect` | RPC | steal placeholder stage from progress |
| `advance_room` | RPC | inserts `clue_family` |
| `round_result` | RPC | returns `clue_family`, `clue_total`; `my_answer` gains `response_time_ms` (also in `sync_room_state`) |
| `planQuiz` | engine | assigns clue families; `statRounds` stays, default 0 |
| `composeRound` | engine | `clueFamily`, family ladders, teammate exclusions |
| `buildHints` / `recordHints` | engine | family ladders and multiple record clues |
| `start-room` | edge function | stops requesting stat rounds; projects `clue_family` |
| `store.startQuiz` | client | stops requesting stat rounds |
| `room.revealClue` | client | new API |
| `round.js` | client | on-demand reveal, family chip, server stage |
| `reveal.js` | client | scoring breakdown |
| `results.js` | client | clue-family recap |

### 3.6 Testing

#### Unit

- Planner: a ten-round quiz with no `statRounds` has ten `identify`
  rounds and zero `stat_value` rounds.
- Planner: a ten-round quiz has two rounds of each clue family when the
  data allows, and the same seed produces the same family order.
- Planner: `statRounds: 3` still produces three stat rounds. The dormant
  option is not broken.
- Career trail: the ladder starts with the stage, then the trail, then a
  record.
- Teammate trail: every named teammate shares a club-season with the
  subject, the subject is never named, and no named teammate appears in
  the four options.
- Record book: at least two distinct record metrics are used when the
  pool supports them.
- Profile: role, birth year, home, and height are separate clues; a
  missing field is skipped.
- Mixed fallback: a family with too little data produces a round whose
  effective family is `mixed`, and the label follows.
- Scoring: stage 1 is x5, stage 2 is x3, stage 3 is x2, stage 4 is x1;
  the time factor stays in `1.0 .. 1.5`; the breakdown recomputed from
  stage and response time equals the awarded points.

#### Integration (local Supabase)

- A room started through `start-room` has ten identify rounds and zero
  stat rounds.
- `current_round(p_on_demand := true)` returns one visible clue value,
  `null` for the rest, `clue_index = 0`, `clue_total`, and
  `clue_family`.
- `reveal_clue` advances only the caller. A second member still has
  `clue_index = 0`.
- A stale `p_clue_index` does not advance; a call after the deadline is
  refused; a call when the round has advanced is refused.
- `submit-answer` with `on_demand: true` scores the caller's clue index:
  answer immediately is stage 1, reveal twice then answer is stage 3.
- Old-client shape: `current_round()` without the flag returns all clue
  values and `reveal_schedule`; `submit-answer` without `on_demand` uses
  the elapsed stage.
- `round_result` returns `clue_family`, `clue_total`, and
  `my_answer.stage` and `my_answer.response_time_ms`.
- A rematch deletes progress rows by cascade and the next game starts at
  `clue_index = 0`.
- A steal on an on-demand round copies the target's stage and half
  points.

#### Playwright

- Solo: one clue is visible at round start; "Reveal next clue" shows the
  second and changes the next multiplier from x5 to x3; answering shows
  the breakdown; the family chip is visible.
- Solo: answering immediately locks stage 1 and awards the x5 bracket.
- Room, two browsers: player A reveals a clue and sees the new value;
  player B still sees it locked. A answers at the lower multiplier and
  B at the higher one; both reveals show the right stage.
- Room: the round advances after both players answer; no console or page
  errors.
- The existing rematch, effects, and click-race tests stay green.

#### Gate

`npm test` and the room Playwright suite, excluding the two known base
failures (`a player who refreshes mid-round keeps their score` and
`the home screen can create a room`). Live checks after deploy.

### 3.7 Rollout

1. Apply the additive migration to the local stack and run the tests.
2. Deploy the migration and the `start-room` and `submit-answer`
   functions. The server must go first: the new client calls the
   two-argument RPCs.
3. Publish the client, push `main`, and let Vercel deploy.
4. Live check with two browsers: reveal, different stages, breakdown,
   family chip, steal, rematch.
5. No pool upload is needed; the data shape is unchanged.

Backward compatibility: an old client calls the one-argument
`sync_room_state` and omits `on_demand` from `submit-answer`. The
defaults give it the v1.2 timed ladder and the timed stage. A new client
against an old server is not supported; the deploy order avoids that
window. Solo play does not depend on the server.

### 3.8 Risks and decisions

- **Press-your-luck can slow the game.** A player may read every clue
  every round. The speed bonus and the 20-second clock keep pressure;
  if the live sample shows everyone waiting, shorten the clock or make
  the first reveal cheaper. No change is made now.
- **Teammate clues can be too easy or too obscure.** They name a real
  club-season teammate and exclude that teammate from the options. A
  superstar teammate gives away the era, not the player. Tune teammate
  selection later if the live sample is poor.
- **Record book depends on pool coverage.** The existing 0.8 coverage
  floor protects it; fewer than two records falls back to mixed.
- **Per-player progress adds a table and an RPC.** Accepted: a shared
  index would let one player spend another player's multiplier. The
  table is small and cascades with the round.
- **Old clients get the timed ladder.** They are compatible but do not
  get the new feature. This is a deploy-window concern, not a data
  concern.
- **The stat recipes stay dormant.** They remain covered by engine
  tests. Phase 2 reuses the numeric machinery for ranges.

### 3.9 Acceptance criteria

- Solo and room games plan ten identify rounds and zero stat-value
  rounds.
- One clue is visible at start; each reveal lowers the multiplier along
  the first N entries of 5 -> 3 -> 2 -> 1; the 20-second clock and speed
  bonus still apply.
- The reveal shows the stage multiplier, speed factor, and points, and
  they agree.
- A ten-round game uses two rounds from each of the five clue families
  when the data allows; the family label is visible; a family with too
  little data falls back to mixed.
- Teammate clues name real club-season teammates and never offer a
  named teammate as an option.
- In a room, each player has their own clue index; a reveal affects only
  that player; the server scores the stage.
- An old client in a room still sees the timed ladder and receives the
  timed stage.
- Rematch, effects, and the v1.2 reliability behavior still work.
- All tests pass and the two-browser live check passes.
