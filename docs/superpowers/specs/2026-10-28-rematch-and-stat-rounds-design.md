# v1.2: Rematch, deeper questions, and reliability

Date: 2026-10-28
Status: design approved in conversation; written spec awaiting review
Base: `e552c62` (v1.1 party effects merged to `main`)

## 1. Context

The v1.1 game is a server-authoritative, room-based football trivia game.
Every round is currently a "Who is this?" identity question, and a room
ends after ten rounds with no way to play again without creating a new
room and sharing a new code.

The engine already contains three v1.1 stat-value recipes and a numeric
template, but they are gated off, and both solo and room games plan
identity rounds only. The party-effects mod is template-agnostic and must
keep working when stat rounds are enabled.

This release adds:

1. **Deeper questions** — three stat-value rounds in a ten-round game,
   mixed with seven identity rounds.
2. **Rematch** — the host restarts the same room, with the same players
   and code, after the final leaderboard.
3. **Reliability** — the known local CORS fix, a fail-closed steal guard,
   and a fix for a click lost when the two-second room redraw replaces a
   button under the player's finger.

## 2. Goals and non-goals

### Goals

- A ten-round game contains exactly three stat-value rounds when the
  player pool can supply them, and seven identity rounds.
- Stat rounds use the existing four-option UI, with unit-labelled numeric
  options; no free-text or numeric input is added.
- Solo and room games use the same mix.
- The host can return a final room to its lobby and start a fresh game
  without changing the code or asking players to rejoin.
- Scores, answered counts, and effect uses reset with the rematch.
- A steal on a stat round copies the target's numeric answer and pays
  half the target's points, exactly as it does for an identity round.
- A press that begins before a room redraw still registers after it.
- `hasSteal` refuses an answer when it cannot verify the steal state.
- The local functions runner no longer duplicates CORS headers.

### Non-goals

- New effects, effect economy, shields, counters, or repeat uses.
- New question templates beyond the existing `stat_value` and `identify`.
- `scarcity_goals` (its pool data is not derived yet).
- Spectators, chat, mid-game joining, or cross-game history.
- Preserving past game results after a rematch.
- A new game mode.

## 3. Design

### 3.1 Question mix

#### Planner interface

`planQuiz` gains an optional `statRounds` argument:

```js
planQuiz({ scope, pool, registry, seed, rounds, difficulty, phases, statRounds })
```

- `statRounds` is an integer, default `0`, clamped to `0..rounds`.
- `0` keeps today's behaviour exactly: every round is identity, and all
  existing callers and tests remain valid.
- `phases` continues to gate the recipes; stat recipes are not offered
  unless `phases` includes `v1.1`.

#### Slot selection

Before the round loop, choose `statRounds` distinct round indices from
`0..rounds-1` using the seeded RNG. The choice is deterministic for a
given seed and `statRounds`.

For each round index:

- If it is a stat slot, consider only recipes with `template:
  'stat_value'`.
- Otherwise consider only recipes with `template: 'identify'`.
- Apply the existing rules inside that group: no consecutive repeat of
  the same metric when another recipe exists, and no repeated subject.
- If the chosen group has no candidate for that round, fall back to the
  other group for that round. If neither has a candidate, stop planning;
  the quiz is shorter, as today.
- A fallback can reduce the number of stat rounds below `statRounds`; it
  never increases it.

The summary continues to report `metricFamilies`, so a mixed quiz shows
"3 different kinds of question" on the solo results screen.

#### Callers

- `client/src/store.js` (`startQuiz`) passes `phases: ['v1.1']` and
  `statRounds: 3`.
- `supabase/functions/_shared/start-room.js` passes the same values to
  `planQuiz`.
- `generateQuiz` forwards the new arguments for callers that use the
  wrapper.
- No database schema change is needed: `rounds.template`,
  `rounds.options`, `round_secrets.unit`, and `round_result.unit` already
  exist.

#### UI

No new input is needed. For a stat round the engine already produces:

- a prompt such as "How many goals did X score at the 2022 World Cup?",
- four numeric options with unit labels ("3 goals", "8 goals", ...),
- `answer` as the numeric truth and `unit` as the unit.

The round screen already renders `round.options`; the reveal already
renders `withUnit(result.answer, result.unit)`; the room result already
returns `answer` and `unit`. The client only needs to display what the
engine sends.

The existing clues remain. `composeRound` already drops any hint that
would reveal the numeric answer, so a stat round does not leak its answer
through the clue ladder.

#### Effects compatibility

The steal target picker and side bet are unchanged. For a stat round:

- A steal copies the target's chosen option value, stage, and response
  time, and the server scores that value against the round's numeric
  answer.
- Half points are computed from the target's scored points exactly as for
  an identity round.
- A side bet pays when the target's selected answer is correct.

One integration test must exercise a steal on a stat round.

### 3.2 Rematch

#### Semantics

After a room reaches `final`, the host can restart the same room:

- Same room row, code, scope, difficulty, and members.
- Status returns to `lobby`.
- `current_round` returns to `0` and `finished_at` to `null`.
- All rounds, answers, round secrets, effects, and the quiz plan are
  deleted.
- Every membership's `total_score`, `correct_count`, and
  `total_response_ms` return to `0`.
- `is_host` and `joined_seq` are preserved.
- The next `start-room` writes a fresh quiz, with a new random seed, using
  the same scope and difficulty. Players can join the lobby again after
  the reset.

The rematch does not auto-start the game. The room returns to the lobby
and the host uses the normal Start button, so players have a moment to
come back.

#### Server API

Add an additive migration `20261028000100_rematch.sql` with:

```sql
public.reset_room(p_room_id uuid) returns jsonb
```

- `security definer`, `set search_path = public`.
- Requires `auth.uid()`.
- Locks the room row `for update`.
- Refuses when the caller is not a member or not the current host
  (`room_memberships.is_host`), when the room does not exist, or when the
  room's status is not `final`.
- Deletes `quiz_plans` and `rounds` for the room. `answers`,
  `round_secrets`, and `room_effects` cascade from `rounds`.
- Zeroes the membership score columns.
- Sets `rooms.status = 'lobby'`, `current_round = 0`, `finished_at = null`.
- Returns `{ "ok": true }`.

Host transfer already happens in `leave_room`, so a room whose original
creator left can still be reset by the current host.

A duplicate tap is safe: the second call sees `lobby`, not `final`, and is
refused. The client disables the button while the call is in flight and
shows a text error if the server refuses.

#### Client flow

- `room.rematch()` calls `reset_room`, then `sync()`, and returns whether
  the reset succeeded.
- The room results screen shows a primary `Play again` button
  (`#btn-rematch`) only to the current host. Guests see "Waiting for the
  host to start again."
- When any client sees the room status change to `lobby`, the results
  screen redirects to `#room-lobby`.
- The poll slows to five seconds when a room reaches `final`, so a client
  still notices a host change or a rematch there. When a sync sees `lobby`
  after `final`, the poll returns to two seconds so a client that missed
  the realtime update still follows the rematch.
- The lobby is unchanged: the code, members, and Start button are already
  there. Effect uses are available again because their round rows were
  deleted.

#### Edge cases

- Non-final room: refused; no button is shown outside `final`.
- Non-host: refused; the button is not rendered for guests.
- Host leaves after the final: `leave_room` transfers the host; the new
  host sees the button after the next sync.
- Player offline during the reset: on their next sync they see `lobby`
  and are redirected to the lobby.
- A player who reloads during the reset: `sync_room_state` returns
  `lobby`, and the client restores the room from local storage as usual.
- Rematch with one player alone: allowed if that player is the host; a
  solo room is a valid room.

### 3.3 Reliability

#### Local CORS

Apply the saved local-only patch to `scripts/serve-functions.js`:

- use lowercase CORS header names, because the handler's `Response`
  headers iterate lowercased and a mixed-case twin reaches the wire twice;
- allow `x-client-info` and `x-supabase-api-version`, which the browser
  client sends.

This is development-only; it does not change the hosted gateway.

#### Fail-closed steal guard

`hasSteal` currently ignores its query error and returns `false`, which
would let a player who is copying submit an answer if the query failed.
Change it to fail closed: a query error means "assume a steal exists" and
the handler refuses the answer with the existing 409 message.

Move the helper into `supabase/functions/_shared/effects.js`, which has no
engine or vendor imports, so a unit test can pass a fake admin that
returns an error without preparing the generated vendor tree. `submit-answer`
imports it from there.

#### Redraw click loss

The room polls every two seconds and each poll calls `notify()`, which
rebuilds the whole screen. A press that begins just before a redraw can
lose its `click` because the button is replaced between `pointerdown` and
`pointerup`.

Fix this in `client/src/main.js`, at the render boundary:

- Track whether a primary pointer is down on the app.
- While it is down, a store-driven `render()` is deferred and coalesced
  into one pending render.
- On `pointerup` or `pointercancel`, flush the pending render after the
  browser has dispatched the click (a zero-delay task, so the click
  handler runs against the live element first).
- Hash changes and the initial render are not deferred.

This protects every screen's buttons, not just the picker confirm. The
two-second sync remains, so the victim warning and presence still update.

#### Deploy documentation

Add the rematch and stat-round checks to the post-deploy list in
`docs/DEPLOY.md`:

- a room reaches a stat round, answers it, and reveals the unit;
- the host rematches and round 1 of the new game starts in the same room;
- a steal still copies and pays.

## 4. Data and API changes

| Change | Type | Notes |
|---|---|---|
| `public.reset_room(uuid)` | new SQL function | additive migration; host-only, final-only |
| `planQuiz.statRounds` | engine argument | default `0`; no schema change |
| `start-room` | edge function body | passes `phases` and `statRounds` |
| `client/src/store.js` | client | solo quiz passes the mix |
| `room.rematch()` | client API | calls `reset_room`, then syncs |
| `#btn-rematch` | results UI | host-only |
| render guard | `client/src/main.js` | pointer-aware deferral |
| CORS headers | local dev script | lowercase + two allowed headers |
| `hasSteal` | `_shared/effects.js` | moved out of `submit-answer`; fail closed |

No new tables, columns, indexes, policies, or realtime publications are
needed. The migration only adds `reset_room`.

## 5. Testing

### Unit

- Planner: a ten-round quiz with `statRounds: 3` has exactly three
  `stat_value` rounds and seven `identify` rounds when data allows.
- Planner: the same seed produces the same quiz; different seeds can
  produce a different slot placement.
- Planner: `statRounds: 0` (and an omitted argument) keeps identity-only
  output.
- Planner: a pool without stat data falls back to identity and never
  throws.
- Engine: a composed stat round has four options, a numeric `answer`, a
  `unit`, and no clue that repeats the answer number.
- Functions: `hasSteal` returns `true` when the admin query returns an
  error.
- Client state: no change expected; existing tests stay green.

### Integration (local Supabase)

- A room started through `start-room` has the configured mix, and a stat
  round's options carry their unit labels while `round_result` carries
  `unit`.
- A steal on a stat round: the target answers correctly, the thief
  receives the copied numeric answer and half the target's points; the
  target keeps full points.
- `reset_room`:
  - the host can reset a `final` room;
  - a non-host is refused;
  - a `lobby` or `round_active` room is refused;
  - rounds, answers, secrets, effects, and the quiz plan are gone;
  - membership scores are zero and the room is `lobby` with
    `current_round = 0`;
  - the next `start-room` writes a new plan and round 1.
- Existing effects and room integration tests remain green.

### Playwright

- A stat round appears in a room, shows numeric unit-labelled options,
  accepts an answer, and the reveal shows the value with its unit.
- Rematch: use a one-round room (the service role sets `total_rounds = 1`
  before start), play the round to `final`, host clicks Play again, both
  players land in the lobby, the host starts, and round 1 of the new game
  is on screen with zero scores and both effect buttons available.
- Click race: press an option with `mouse.down()`, trigger a room sync,
  release, and assert the answer registered.
- No console or page errors in either browser.

### Gate

`npm test` and the room Playwright suite, excluding the two known base
failures (`a player who refreshes mid-round keeps their score` and
`the home screen can create a room`). Live checks after deploy.

## 6. Rollout

1. Apply the additive migration to the local stack and run the tests.
2. Deploy the migration and the `start-room` function to the hosted
   project; upload the pool only if it changed (it does not).
3. Publish the client, push `main`, let Vercel deploy.
4. Live check with two browsers: stat round, rematch, steal.
5. No Netlify leg is required; the token is absent and Netlify is not the
   primary host.

Backward compatibility: the live client already knows how to render
options and units, so deploying the server mix before the client is safe.
`reset_room` is unused until the new client ships. An old client that is
sitting on a final leaderboard when another client resets the room does
not redirect to the lobby; it shows the stale leaderboard until the next
navigation. That window is limited to the deploy, and no data is lost.

## 7. Risks and decisions

- **Stat rounds change the game's feel.** Capped at three of ten. If a
  live sample feels too quiz-like, the cap can be lowered to two without
  a schema change.
- **Numeric distractors may be too easy or too hard.** They are drawn
  from real values in the same pool and window. Tune the distractor
  choice later only if the live sample shows a problem.
- **Rematch deletes history.** Accepted: there is no history UI and the
  room is the unit of play. Preserving games would need a game table and
  would weaken the one-effect-per-game constraint.
- **The two-second redraw remains.** The pointer guard fixes lost
  presses; it does not remove all redraws. A later state-diffing change
  can reduce flicker if it matters.
- **Host-only rematch.** Consistent with start. A ready-up flow is a
  later feature, not v1.2.

## 8. Acceptance criteria

- A ten-round game has three stat-value rounds and seven identity rounds
  when the pool supports them.
- Stat rounds answer, score, reveal, steal, and side-bet correctly.
- A final room can be restarted by its host; the code and players stay;
  scores and effect uses reset; guests follow to the lobby.
- A non-host or a non-final room cannot be reset.
- `hasSteal` fails closed; the local runner has one set of CORS headers.
- A press that spans a room redraw still registers.
- All tests pass, and the live two-player check passes.
