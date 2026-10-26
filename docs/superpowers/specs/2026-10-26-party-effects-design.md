# Party Effects v1 — Steal + Side Bet

**Date:** 2026-10-26
**Status:** approved in conversation; written up here for review
**Builds on:** `docs/superpowers/specs/2026-10-21-multiplayer-room-design.md` (the room lifecycle, secrecy model, scoring and 2–12 player shape) and `docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` §7 (the product contract)

---

## 1. What this is

A party-room effect is a social move, not a second quiz. The first version ships **two effects**:

- **Steal** — blind-copy a friend's answer instead of answering yourself.
- **Side bet** — keep your own answer and quietly bet that a friend gets it right.

The design goal is the one the room spec already states: **the engine is under the hood**. No player receives another player's answer, and no player can forge a score. The steal copies a **player**, never an answer the thief can see.

### 1.1 What "done" means

Two players in a room can:

1. Use a steal; the victim sees a named warning; the steal resolves at the reveal.
2. Have the victim answer wrong after the warning, burning the thief at the victim's own cost.
3. Place a side bet and see it pay or lose at the reveal.
4. Use each effect once per game, not again.
5. Play a round with effects without ever seeing another player's answer, correctness, points, answered status, or stage before the round closes.

### 1.2 Non-goals

Double-or-nothing, a three-effect kit, an economy, shields/counters, repeat uses, spectators, rematches, and `stat_value`/`membership` question types are out of scope. v1 remains Guess the Player.

---

## 2. Design principles

- **Social play is the point.** The effects reward reading the table, not replacing football knowledge.
- **Blind steal.** The thief picks a player and never sees that player's choice before the reveal.
- **Server-authoritative.** The server resolves the copy, the half-points, the sabotage and the side bet.
- **One rare moment.** One steal and one side bet per player per game. No economy, no recharges.
- **No new mid-round answer information.** The only new mid-round information about another player is the steal relationship, and only the thief and the victim see it. The side bet is silent to everyone but the bettor.
- **Text is the feedback.** Sound and colour are never the only signal. Reduced motion is unaffected.
- **Minimal surface.** One new table, one new RPC, one migration, one small `submit-answer` guard. No new runtime dependencies, no build step, no new edge function.

---

## 3. The player's experience

### 3.1 Round screen

After the question appears, a compact **Effects — once per game** strip sits between the clues and the options:

- **Steal a friend**
- **Side bet**

Both are available until the player answers, uses their one steal, or the round expires. The strip disappears in solo play, and it is hidden when there is no other player to target.

Using a steal ends the actor's round screen: they have no answer to give, so the app moves to the waiting reveal. A player who wants both effects in one round must place the **side bet first**. That is the only ordering restriction, and it follows from the steal's forfeit, not from an extra rule.

Tapping either opens an inline target picker. It lists the other players with their names and **online / away** only. It never shows who has answered, what they answered, their score, or whether they have used an effect. The picker stays open across the two-second redraw through module state; its selection is kept, though the browser may replace the nodes under it.

The picker requires an explicit confirmation because the effect is scarce:

- **Steal:** "Copy Sam's answer? You won't answer this round. If Sam hasn't answered, they can burn you. One steal per game."
- **Side bet:** "Bet on Sam? +500 if Sam is right and you answer or steal this round. Sam won't know until the reveal. One side bet per game."

Once used, the button reads **Steal used** or **Side bet used** and is disabled for the rest of the game.

### 3.2 Steal

- The thief forfeits their own answer for that round. The server writes a placeholder answer so the round can still close early.
- The target gets a private, named warning while the round is still open:
  - **"Alex is copying your answer."**
  - Multiple thieves are combined: **"Alex and Robin are copying your answer."**
- If the victim has **not** answered, they can still answer normally, or deliberately answer wrong to burn the thieves. They lose their own points too. The warning says so. Not answering also leaves the thieves nothing to copy, at the same cost of a zero round; it is the passive version of the same choice.
- If the victim already answered, the answer is locked. The warning becomes: **"Alex is copying your answer. Your answer is locked."**
- At close, the server copies the target's answer:
  - target correct → thief gets **half the target's points**
  - target wrong → thief copied a wrong answer and gets 0
  - target did not answer → 0, nothing to copy
  - target used their own steal → 0, **no chains**
- The target keeps their full points. The copied answer carries the target's stage and response time.
- Mid-round, the thief never learns whether the victim saw the warning or whether the victim had answered. The reveal reports the outcome, which necessarily says whether there was an answer to copy.

### 3.3 Side bet

- The bettor keeps their own answer and scores normally.
- If the target's final result is correct **and** the bettor submitted an answer or a steal that round, the bettor gets **+500**.
- If the target is wrong, did not answer, or the bettor did not play that round, the bettor gets 0. There is no penalty.
- The bet is silent to the target and to the rest of the room while the round is open. The bettor sees their own pending bet. It becomes public at the reveal.
- A target's successful steal counts as correct for the side bet; the bettor is betting on the target's final result.
- One side bet per game.

### 3.4 Reveal

The reveal adds an **Effects** card after the verdict. Personal effects come first, then the rest of the round's effects.

- **Thief:** "You copied Sam's answer. Sam was right — you earned 3,750." / "Sam was wrong — you got nothing." / "Sam used their own steal — nothing to copy." / "Sam didn't answer — nothing to copy." The verdict headline says **"You copied Sam"** rather than "You got it".
- **Victim:** "Alex copied your answer. You still earned 7,500." / "Alex copied your wrong answer — you both got nothing." / "Alex tried to copy you, but you didn't answer."
- **Side bettor:** "You bet on Sam: +500." / "You bet on Sam: no bonus."
- **Everyone else:** the same story in the third person: "Alex copied Sam. Alex earned 3,750." / "Robin bet on Sam: no bonus."

The reveal reports the outcome, not whether the victim saw the warning. A target who answered before the warning and a target who answered after it look the same at reveal. A victim's deliberate sabotage is indistinguishable from a genuine wrong answer, because intent is unknowable: the summary says "Sam was wrong."

### 3.5 Results

The final room leaderboard already includes the side-bet bonus in `total_score`. The room results screen must **drop the "of X possible" line**, because side-bet bonuses can push a score above `rounds × 7,500`.

---

## 4. Rules in detail

### 4.1 Scarcity

Each player gets **one steal** and **one side bet per room/game**. The database enforces this with `unique (room_id, actor_id, kind)`. There is no earning, refilling, shielding or repeating.

### 4.2 Timing and eligibility

- Effects may be used only while the room is `round_active`, the round is the current round, `closed_at` is null, and the server clock is at or before `deadline_at`.
- A steal requires that the actor has **not** submitted an answer for that round.
- A side bet is placed while the actor is still on the round screen. It does not require an answer at placement, but it only pays if the actor has an answer row (own answer or steal placeholder) at resolution. Answering moves the actor to the reveal, so there is no placement window after answering.
- The target must be another current member of the room.
- The target may be online or away. The picker shows which; it never shows answered status.
- Both effects may be used in the same round. The side bet must be placed first if a steal follows, because the steal ends the actor's round screen.

### 4.3 Steal resolution

At round close, for every pending steal in that round:

1. Look up the target's answer row.
2. If the target has a steal effect in the same round, the thief gets **0** and nothing is copied. This is the no-chain rule and it is order-independent.
3. If the target has no answer row, the thief gets **0** and nothing is copied.
4. Otherwise, copy the target's `guessed_answer`, `is_correct`, `stage_locked` and `response_time_ms` onto the thief's placeholder answer. If the target was correct, set the thief's `points_earned` to **half, rounded down** (`target.points_earned / 2` with integer division; points can be odd). If the target was wrong, the thief keeps the copied wrong guess and `points_earned = 0`.
5. Mark the effect resolved.

The thief's copied correct answer counts as a correct answer for their `correct_count`. The copied answer carries the target's stage and response time, so the half-points and the tie-break timing both follow the target.

### 4.4 Side-bet resolution

After all steals in the round are resolved, for every pending side bet:

- The bonus is **500** if:
  - the bettor has an answer row in the round (a normal answer or a steal placeholder), and
  - the target's final answer row exists and `is_correct` is true.
- Otherwise the bonus is **0**.
- Mark the effect resolved.

The bonus is added to `room_memberships.total_score` after the normal answer roll-up. It does not affect `correct_count` or `total_response_ms`.

### 4.5 Chains, cycles and multiple thieves

- **No chains:** a steal only copies an answer the target submitted themselves. If the target used their own steal, the thief gets 0.
- **Mutual steals:** both targets used a steal, so both thieves get 0.
- **Chain A→B→C:** A gets 0 because B used a steal; B can still copy C and get half of C's points.
- **Multiple thieves on one victim:** each thief can copy the same normal answer and get half of the victim's points. The victim keeps full points and gets one combined warning. A wrong answer by the victim burns all of them and costs the victim their own points.

### 4.6 Failure modes

- Target answers wrong → thief copies the wrong answer, 0 points.
- Target does not answer → thief 0, nothing to copy.
- Target used a steal → thief 0, no chains.
- Victim sabotages → victim 0, every thief copying that victim 0.
- Thief disconnects → the placeholder still lets the round close; the result is waiting on return.
- Target leaves → resolve against their answer if they answered; otherwise 0. The reveal uses a neutral label if the target is no longer a member.
- Double tap → the RPC is idempotent for the same round, including a concurrent double tap caught by the unique constraint. A second use in a later round is rejected.
- Side bet with no answer → 0 bonus.
- Side bet on a successful stealer → pays, because the target's final result is correct.

### 4.7 Scoring examples

| Situation | Target | Thief |
|---|---|---|
| Target correct at stage 1, 7,500 | keeps 7,500 | gets 3,750 |
| Target correct at stage 4, 1,000 | keeps 1,000 | gets 500 |
| Target wrong | 0 | copies the wrong guess, 0 |
| Target did not answer | 0 | 0 |
| Target used a steal | target's own result | 0, nothing to copy |
| Two thieves on one correct victim | keeps full | each gets half |

| Side bet | Bettor |
|---|---|
| Target correct, bettor answered | +500 |
| Target correct, bettor stole that round | +500 |
| Target wrong | 0 |
| Target did not answer | 0 |
| Bettor did not answer or steal | 0 |

### 4.8 Balance rationale and tuning knobs

Half points is the key. If stealing gave full points, the game would become "who do I trust?" and football knowledge would stop mattering. Half points keeps the expert ahead and makes the thief pay for uncertainty. One use prevents "always steal the best player". The named warning adds real risk: the victim can burn the thief at their own cost, so a steal is a social read, not a free hedge. The side bet is free but small and once per game, so it is garnish, not a strategy.

The tuning knobs, in order of impact:

1. **Steal reward** — 1/2 is the v1 default. Lower it if steals dominate; raise it to 2/3 if they never happen.
2. **Warning visibility** — named is the v1 default. Anonymous or reveal-only makes stealing safer; removing the sabotage option does too.
3. **Scarcity** — one per game is the v1 default. More uses makes effects the meta-game.
4. **Side-bet amount** — 500 is the v1 default. It should stay small enough that it never outweighs a good answer.

Do not add shields or an economy in v1. They add a second layer of rules before the first one is proven fun.

---

## 5. Architecture and data model

### 5.1 The new table

`public.room_effects` is the source of truth for who used what, on whom, and whether it has resolved. It contains **no answers**.

```sql
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
```

`resolved_at is null` means pending. `bonus_points` is used by the side bet; steals keep it 0 because the thief's points live in `answers`.

### 5.2 RLS and realtime

```sql
alter table public.room_effects enable row level security;

create policy room_effects_select on public.room_effects for select
  using (
    public.is_room_member(room_id)
    and (
      actor_id = auth.uid()
      or (kind = 'steal' and target_id = auth.uid())
    )
  );
```

There are no insert, update or delete policies. Only the security-definer functions and the service role write this table.

`room_effects` is added to the `supabase_realtime` publication with the same "add only if missing" guard the room tables use, so the migration is safe to re-run. The client's existing subscription gains a `room_effects` listener filtered by `room_id`, so the victim's warning arrives immediately when realtime is healthy. The existing 2-second poll is the fallback.

### 5.3 The placement RPC

`public.use_room_effect(p_room_id uuid, p_round_number int, p_kind text, p_target_user_id uuid)` is a `security definer` function with `search_path = public`.

It validates, in order:

1. The caller is signed in and a member of the room.
2. `p_kind` is `steal` or `side_bet`.
3. The actor has not used this kind before. If the same kind already exists **for the requested round**, return it as an idempotent success (`already: true`), even if the round has since closed. If it exists for a different round, raise `you already used that effect this game`. This check comes before the clock so a retry whose response was lost is not punished.
4. The room is `round_active`, and the requested round is `rooms.current_round`. Otherwise raise `that game is not running` / `that round is not open`.
5. The round is not closed and `now() <= deadline_at`. Otherwise raise `too late - that round is over`.
6. The target is another current member. Otherwise raise `that player is not in the room`.
7. `p_target_user_id <> auth.uid()`. Otherwise raise `you cannot use an effect on yourself`.
8. For a steal, the actor has no answer row for the round. Otherwise raise `you already answered this round`.

It takes the room row `for no key update` before checking, the same lock `advance_room` takes. That serializes effect placement with round close: an effect either lands before the close and is resolved, or is refused because the round closed.

It inserts the effect row. For a steal, it also inserts the placeholder answer in the same transaction:

```sql
insert into public.answers (
  room_id, round_id, user_id, guessed_answer, is_correct,
  stage_locked, response_time_ms, points_earned, received_at
) values (
  p_room_id, v_round.id, auth.uid(), '', false,
  v_stage, v_elapsed, 0, now()
);
```

`v_stage` and `v_elapsed` use the same server-clock formula as `submit-answer`. The placeholder is replaced at close.

Two concurrent taps can both pass the pre-checks. The insert is wrapped so a `unique_violation` on `room_effects (room_id, actor_id, kind)` re-reads and returns the existing effect as an idempotent success. A `unique_violation` on the placeholder (`answers (round_id, user_id)`) rolls the whole function back and raises `you already answered this round`. The client cannot end up with a steal effect and no placeholder.

Validation errors use `errcode = '22023'` (bad request), except the not-signed-in/membership errors, which keep `42501`. This keeps a wrong tap a 4xx rather than a 500, the same rule the room functions already follow.

The RPC returns:

```json
{ "kind": "steal", "target_user_id": "uuid", "round_number": 3, "already": false }
```

### 5.4 Resolving effects inside `advance_room`

`advance_room` already closes the round and rolls the round's `answers.points_earned` into `room_memberships` in one transaction. Effects must resolve **in that same transaction, before the score roll-up**. Otherwise the thief's half-points would miss the roll-up, or a second transaction could double-score.

After setting `closed_at` and before the membership score update:

1. Resolve every pending steal, in any order, with the no-chain rule from §4.3. The rule reads the target's **effect row**, not the target's resolved answer, so the result is order-independent.
2. Resolve every pending side bet from §4.4. Steals are already resolved, so a side bet on a successful stealer sees the copied correct answer.
3. Run the existing answer roll-up. The thief's resolved answer is included.
4. Add the side-bet bonuses:

```sql
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
```

The half-point rule is deliberately the one piece of scoring logic that lives in SQL. Normal answer scoring remains in `js/engine/scoring.js` and `submit-answer`. The alternative — moving round close and scoring into an edge function — is a large refactor with new races. The SQL rule is one line and is covered directly by integration tests.

### 5.5 `round_result`

`round_result` calls `advance_room(p_room_id)` after its membership check and before reading the round. That guarantees a result is never served before the round's effects and scores are resolved, even if the caller is the first to ask after the deadline.

It returns the existing shape plus:

- `my_answer` normalised to the same shape the client already uses: `{ correct, points, stage, guessed_answer }`. This is important for a thief: the reveal must show the **resolved copied answer and points**, not the pending placeholder.
- `effects`, an array for the round:

```json
[
  {
    "kind": "steal",
    "actor_id": "uuid",
    "target_id": "uuid",
    "actor_points": 3750,
    "target_correct": true,
    "target_answered": true,
    "target_stole": false,
    "bonus_points": 0,
    "resolved": true
  },
  {
    "kind": "side_bet",
    "actor_id": "uuid",
    "target_id": "uuid",
    "actor_points": 5000,
    "target_correct": true,
    "target_answered": true,
    "target_stole": false,
    "bonus_points": 500,
    "resolved": true
  }
]
```

`target_stole` is true when the target has a steal effect in the same round. It takes precedence over `target_correct` in the steal story, because there was nothing to copy. `target_answered` means the target's answer row exists (including a steal placeholder). `target_correct` is false when there is no target answer. `actor_points` is the actor's round points, or 0 when the actor has no answer row; for a side bet, the bonus is in `bonus_points`, not `actor_points`. `effects` is `[]` when the round had none.

While the round is open, `effects` is `[]` and the result is pending. A pending effect must not leak through this path, because `round_result` is security definer and does not rely on the table's RLS.

### 5.6 `sync_room_state`

`sync_room_state` returns `my_effects`: every effect in the room where the caller is the actor, or the victim of a steal. It includes past rounds, because the client needs to know that a once-per-game effect has already been used, and the reveal may still be showing the previous round.

```json
[
  {
    "round_number": 3,
    "kind": "steal",
    "role": "target",
    "other_id": "uuid",
    "resolved": false,
    "bonus_points": 0
  }
]
```

- `role` is `actor` or `target`.
- `other_id` is the target for an actor, and the actor for a steal victim.
- The side-bet target is **not** included. The bet is silent to them mid-round; they learn at the reveal through `round_result`.
- No target answer, correctness, points, stage, response time or answered status is included.
- `my_answer` keeps the normalised `{ correct, points, stage, guessed_answer }` shape.
- The `members` payload stays `online`/`away` only. Do not add an answered count or answered flag. The room's existing no-mid-round-information guarantee is preserved.

### 5.7 `submit-answer` guard

`submit-answer` must reject a player who has a steal effect for that round. Before the existing answer lookup:

```js
const { data: steal } = await admin
  .from('room_effects')
  .select('id')
  .eq('round_id', round.id)
  .eq('actor_id', userId)
  .eq('kind', 'steal')
  .maybeSingle();
if (steal) {
  return json({ error: 'you are copying a player this round' }, 409);
}
```

The same check runs again in the `23505` retry branch, before it returns the existing row. Without it, a steal that lands while an answer is in flight could leave the retry branch returning the placeholder's `{ correct: false, points: 0 }`, which is misleading: the steal may later resolve to a correct copy. `submit-answer` is the only edge function that needs redeploying.

Exact error strings the RPC and guard use, so `friendly()` can map them without guessing:

| Server message | Player-facing copy |
|---|---|
| `you already used that effect this game` | You already used that effect. |
| `you already answered this round` | You already answered this round. |
| `you are copying a player this round` | You're copying a player this round. No answer of your own. |
| `that player is not in the room` | That player is no longer in the room. |
| `not a member of that room` | You're not in that room. |
| `you cannot use an effect on yourself` | You can't use an effect on yourself. |
| `that game is not running` | That game is not running. |
| `that round is not open` | That round is over. |
| `too late - that round is over` | Too late - that round is over. |

### 5.8 Why there is no new edge function

The effect placement, resolution and result are room rules over data the database already owns. A `security definer` RPC is the same trust boundary the room already uses for `create_room`, `join_room`, `advance_room` and `round_result`. It keeps the write path server-side, avoids a new deployment unit and keeps the resolution atomic with the close. The only edge-function change is the `submit-answer` guard.

### 5.9 Client state and API

`client/src/room.js`:

- Add `myEffects: []` to the state.
- `applyPayload` folds `payload.my_effects` into `myEffects`.
- Add `room.useEffect(kind, targetUserId)`:
  - call `supabase.rpc('use_room_effect', { p_room_id, p_round_number, p_kind, p_target_user_id })`;
  - on error, set `state.error` with the friendly message, notify, and return null;
  - on success, clear `state.error`, call `sync()` to get the canonical effect list;
  - for a steal, set `state.answeredRound = data.round_number` before the sync so the round screen routes to the reveal (use the server's round number, not the possibly stale local one);
  - return the RPC data.
- `room.result(roundNumber)` only stores `data` when `roundNumber === state.answeredRound`; a stale result for an older round must not overwrite the current round's answer or result. When it matches, fold `data.my_answer` into `state.myAnswer` if present, set `lastResult`, and apply the leaderboard as today.
- `subscribe()` adds a `postgres_changes` listener on `room_effects` filtered by `room_id`, calling `sync()`.
- `leave()` clears `myEffects` and the result-ask timestamp.
- `friendly()` maps the exact strings in §5.7.

`client/src/room-state.js`:

- Add `applyEffects(state, effects)`.
- Do not clear `myEffects` when the round changes.
- When the round changes, read the **old** `answeredRound` first and preserve `lastResult` if it belongs to that round; otherwise clear it:

```js
const revealing = state.answeredRound;
const keep = state.lastResult?.round_number === revealing ? state.lastResult : null;
state.myAnswer = null;
state.answeredRound = null;
state.lastResult = keep;
state.fetchingResult = false;
```

The order matters: checking after nulling `answeredRound` would drop the result. This prevents a `round_result` that advances the room from wiping the reveal it just fetched.

`client/src/screens/reveal.js`:

- Only treat `lastResult` as renderable when `lastResult.round_number === roomState.answeredRound`; otherwise wait and fetch. This covers the same race from the other side.
- The waiting state reads `myEffects` for the answered round to show "You're copying Sam", "Alex is copying you — your answer is locked", or the pending side bet.
- The result state renders the Effects card from `result.effects`.

---

## 6. UI specification

### 6.1 Effects strip

A compact row between the clues and the options:

```
EFFECTS — ONCE PER GAME
[ Steal a friend ]  [ Side bet ]
```

- Hidden in solo play and when no other player is in the room.
- Disabled at the deadline.
- Disabled with text **Steal used** / **Side bet used** after the player has used that effect anywhere in the game. Check `role: 'actor'` only: being the victim of a steal must not disable the victim's own steal.
- A pending side bet shows: **"Side bet on Sam: +500 if Sam is right."** Again, only the bettor's own `role: 'actor'` row.
- Any room error from an effect or answer renders as a `notice notice--warn` above the strip. The round screen currently does not show `roomState.error`; this fixes that small gap.

### 6.2 Target picker

An inline panel, not a modal. The room screen is rebuilt on every two-second redraw, so the open/closed state and the selected target live in module-level picker state and are re-rendered from there; a redraw must not close the picker. The picker resets on a round change. A redraw may still replace the buttons under the player's finger; that is existing room-screen behavior and is not worth a DOM-diffing layer for v1.

- Heading: "Copy a friend's answer" or "Bet on a friend".
- One row per other member: name, `online` / `away` text. No answered status, no score, no effect usage.
- Selecting a row highlights it. A confirmation button names the target and repeats the cost/risk.
- Cancel closes the picker without using the effect.
- The confirm button disables while the RPC is in flight. On success the picker closes; on error it stays open and the error notice explains why.
- The picker does not open if the effect is already used or the round is expired.

### 6.3 Victim warning

Above the effects strip, so it is seen before answering:

> **Alex is copying your answer.**
> Answering wrong burns them — but you lose the points too.

- Multiple thieves: "Alex and Robin are copying your answer."
- Already answered, on the reveal waiting screen: "Alex is copying your answer. Your answer is locked."
- Victim used their own steal, also on the reveal waiting screen: "Alex is copying you, but you used your steal — there is nothing to copy."
- Only `role: 'target'` rows for the **current round** produce the warning; past rounds are history for the used state.
- The warning is text, in normal reading order. If a live region is used, dedupe it by `round_number + thief id` so the two-second redraw does not re-announce the same warning.

### 6.4 Waiting reveal

The waiting state must say why the player is waiting:

- Thief: "You're copying Sam. The result appears when the round closes."
- Victim: "Alex is copying your answer. Your answer is locked."
- Side bettor: "Side bet on Sam: +500 if Sam is right."
- A player can have both a steal and a side bet; show both lines.

### 6.5 Result effects card

A `card` after the verdict, present only when the round has effects. Personal effects first, then the rest.

The thief's verdict headline is overridden to "You copied Sam — correct" / "You copied Sam — wrong" / "Nothing to copy", so the generic "You got it" never implies the thief knew the answer. The points label still shows the server's thief points. The victim's verdict stays their own; the effects card explains the copy.

### 6.6 Copy rules

- Use the room's existing `labelFor` so duplicate display names become "Alex #2".
- Use `pointsLabel` for bonus/payout numbers.
- Never name a raw id, table, function or metric.
- The word "steal" is the player-facing name; the warning and result use "copy" to describe what happened.

### 6.7 Accessibility, motion and sound

- No new animation. The existing `prefers-reduced-motion` rule already disables all animation and transitions.
- The warning, online/away state, used state and result story are all text. No colour-only or sound-only signal.
- No new sound is required. The existing click/reveal/right/wrong cues remain. If a steal sound is added later, it must never be the only feedback.
- The target buttons are real `<button type="button">` elements with accessible names. The confirmation names the target.
- The picker's selected state is visible in text/outline, not only colour.

### 6.8 Room results

Remove the `of ${pointsLabel(max)} possible` line from the room results screen. Side-bet bonuses can take a score above `totalRounds × 7,500`, so the line would be a lie. The leaderboard remains the source of truth.

---

## 7. Privacy and invariants

The room's existing guarantee is unchanged: **no player receives another player's answer, correctness, points, stage, response time or answered status before the round closes.**

What is new mid-round:

- The thief knows they are copying a target. They still do not know the target's answer or whether the target has answered.
- The victim of a steal knows the thief's name and that a copy is coming. They still do not know the thief's answer (the thief has none).
- The bettor knows their own side bet. The target does not.
- No other player sees any effect until the reveal.

The target picker must never show answered status. The `members` payload stays `online`/`away` only. `room_effects` contains no answer data. `round_result` returns effects only after the round is closed. The RLS policy and the security-definer functions both enforce the same visibility.

Mid-round, the thief never learns whether the victim saw the warning or answered before it. The reveal reports the outcome, not the warning.

---

## 8. Testing

### 8.1 Integration (`tests/integration/room.test.js` or a new `effects.test.js`)

1. Direct inserts/updates to `room_effects` are refused by RLS.
2. The actor and the steal victim can read the effect; an uninvolved member cannot.
3. The target of a side bet cannot read it mid-round.
4. `use_room_effect` rejects a steal after the actor has answered.
5. It rejects a second steal in a later round; a side bet is separately one per game.
6. It rejects a self-target, a non-member target, the wrong round, a closed round and a past deadline.
7. A correct steal gives the thief half the target's points, copies the target's guess, and leaves the target's full points intact.
8. A wrong steal copies the wrong guess and gives 0.
9. A steal of a target who did not answer gives 0.
10. No chains: A→B, B→C; A gets 0, B gets half of C.
11. Mutual steals: both get 0.
12. Multiple thieves on one correct victim: each gets half; the victim keeps full.
13. The victim's `sync_room_state` shows the pending steal; a third player's does not.
14. The victim answers wrong after the warning; the thief gets 0 and the victim gets 0.
15. A victim who already answered is locked; the thief copies that answer.
16. The steal placeholder lets the round close early without a normal answer from the thief.
17. `submit-answer` after a steal returns 409.
18. A side bet pays +500 when the target is correct and the bettor answered or stole.
19. It pays 0 when the target is wrong, the target did not answer, or the bettor neither answered nor stole.
20. A side bet on a successful stealer pays, because the target's final result is correct.
21. `round_result` while the round is open returns pending and no effects.
22. `round_result` after close returns the effects and a normalised `my_answer` with the resolved copy and points.
23. `round_result` itself resolves the round and effects even when it is the first call after the deadline.
24. A same-round retry after the round closed returns the first effect as an idempotent success.
25. Two thieves on one victim produce both rows in the victim's `sync_room_state`, and neither appears for a third player.
26. A side bet is in the bettor's `sync_room_state` but not the target's.
27. A warned victim who has not answered can answer normally; the thief copies that answer.
28. The existing room suite still passes.

### 8.2 Client (`tests/client/room.spec.js`)

1. Host uses a steal on the guest; the guest sees the named warning; the guest answers; the host's reveal says "You copied Sam" and shows the copy.
2. The target picker shows online/away text and no answered status, and stays open across a poll redraw.
3. A side bet can be placed; the round screen shows the pending line; the reveal shows the +500 or no-bonus story.
4. The effects strip is absent in solo play and when the player is alone in the room.
5. No console or page errors in any effect flow.
6. Existing room flows still pass.

### 8.3 Shared unit tests (`tests/shared/room-state.test.js`)

1. `applyEffects` replaces `myEffects`, including past-round rows and both `actor` and `target` roles.
2. An empty `my_effects` payload clears the list, so `leave()` and reset paths do not leave stale buttons disabled.
3. A round change keeps `myEffects`.
4. A round change preserves `lastResult` when its `round_number` matches the old `answeredRound`; `myAnswer` and `answeredRound` are still cleared.
5. A round change clears `lastResult` when it belongs to an earlier round or has no `round_number`.
6. The same round keeps `myAnswer`, `answeredRound` and `lastResult`, as today.

### 8.4 Regression

- The full existing suite (273 tests, 235 pass, 38 skipped) stays green.
- Solo play is untouched.
- The live room path is verified with two accounts after deployment.

---

## 9. Rollout

1. Add `supabase/migrations/20261026000100_room_effects.sql` with the table, RLS, realtime publication, `use_room_effect`, and the replaced `advance_room`, `round_result` and `sync_room_state`.
   - Start from the **existing** `advance_room` (20261021000300) and insert the effect resolution before the score roll-up; do not rewrite the round materialisation, host transfer, final/abandoned handling.
   - Start from the **latest** `sync_room_state` (20261021000600) so `scope_icon` and `server_now` survive; add `my_effects` only.
   - `round_result` keeps its existing fields and adds the normalised `my_answer` and `effects`.
2. Apply locally with `npm run supabase:reset` (or `npx supabase db reset`) and run the integration suite.
3. Redeploy the functions with `npm run supabase:deploy`; only `submit-answer` changed.
4. Apply the migration and deploy through the normal hosted path (`npm run deploy:hosted`, which pushes migrations, deploys functions and publishes `dist/`).
5. Verify live with two accounts: start a room, steal, see the warning, answer/sabotage, check the reveal and leaderboard, place a side bet and check the +500.
6. No new npm dependencies, no build step, and the publish script already copies the whole `client/` directory, so new client modules and CSS ship in `dist/`.

---

## 10. Decisions

| # | Decision | Why |
|---|---|---|
| E1 | Effects are a party-room feature, not a solo feature | The social read is the point; solo has no table. |
| E2 | First version is **Steal + Side bet** | Two social moves, one high-stakes and one light. |
| E3 | One steal and one side bet per player per game | Rare moments, no economy. |
| E4 | Steal forfeits the thief's own answer and copies blindly | The thief chooses a person, not an answer. The server resolves it. |
| E5 | Thief gets half the target's points; target keeps full | Football knowledge still wins; the thief pays for uncertainty. |
| E6 | Victim gets a private, named, live warning | The victim can retaliate socially; the thief never learns whether the victim saw it or acted on it mid-round. |
| E7 | Victim can sabotage only if they have not answered, at their own cost | Real tension, no free counter. |
| E8 | No chains; a steal of a stealer gets 0 | Simple, order-independent, no half-of-half math. |
| E9 | Side bet is a free +500 if the target is right and the bettor played | Light social garnish; the steal remains the hero effect. |
| E10 | Side bet is silent until the reveal; its target is never warned | It is a bet, not a second steal. |
| E11 | Resolution lives in `advance_room`'s close transaction | Atomic with scoring; no double-score window. |
| E12 | One new RPC, no new edge function | The database already owns the room rules. |
| E13 | Target picker never shows answered status | Preserves the room's no-mid-round-information guarantee. |
| E14 | Effects are public at the reveal | The story is the payoff. Only the warning and the pending bet are private. |

## 11. Open questions

None for v1. The two constants to tune after playtesting are the steal fraction (currently 1/2) and the side-bet bonus (currently 500). The side bet counting a target's successful steal as correct is deliberate for v1; if it feels wrong, add a `target_stole` check to the payout condition later.
