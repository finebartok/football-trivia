# v1.4: Football IQ mode

Date: 2026-11-01
Status: design approved in conversation; written spec awaiting review
Base: `39bc8c5` (v1.2 live), after Phase 1
Phase: 2 of the richness work

## 1. Context

Phase 1 keeps the current mode a pure guess-the-player quiz and adds
press-your-luck clue reveals and clue families. Football IQ is the
second kind of game: the player reasons about clubs, teammates,
comparisons, and ranges instead of identifying a face from clues.

Football IQ must be a separate mode. Mixing a "which club?" or "which
range?" round into a guess-the-player quiz would recreate the v1.2
problem: two games in one quiz, with clues that do not fit the question.
The two modes share the round loop, scoring, rooms, effects, and
rematch, but not the question mix.

This spec depends on Phase 1. It assumes the press-your-luck loop,
`round_progress`, `reveal_clue`, the server-side stage, and the
`clue_family` plumbing exist. Phase 2 is not implemented until Phase 1
is shipped and validated.

## 2. Goals and non-goals

### Goals

- A separate `football_iq` game mode for solo and rooms.
- Four formats: club in a season, teammate, most-in-the-pool
  comparison, and stat range.
- Every round uses the Phase 1 press-your-luck loop: one clue visible,
  reveal on demand, multipliers 5/3/2/1, 20-second clock, speed bonus.
- Exact-number stat prompts are replaced by ranges and comparisons. No
  free-text or numeric input is added.
- A compact mode selector on the home screen. Solo uses the selected
  mode; a room uses its own mode; joining a room uses the room's mode.
- Format-specific reveal content.
- Guess-the-player remains the default and is unchanged by Phase 2.

### Non-goals

- Mixing Football IQ formats into guess-the-player rooms or the reverse.
- New effects, a new scoring curve, a new round length, or a new player
  pool.
- Removing the dormant `stat_value` engine capability. It stays for a
  future exact-number format; Football IQ does not use it.
- A per-question timer, a difficulty setting, or a player-facing format
  filter.
- Changing the v1.2 rematch or reliability behavior.
- Changing a room's mode after creation. A different mode means a new
  room.

## 3. Design

### 3.1 Mode plumbing

- Add `rooms.game_mode text not null default 'guess_player'` with
  `check (game_mode in ('guess_player', 'football_iq'))`.
- Replace `create_room` with a sixth argument
  `p_game_mode text default 'guess_player'`. Drop the five-argument
  function first so both call forms resolve to the new one. The function
  validates the value and stores it. The existing five-argument call
  still works and creates a guess-the-player room.
- `join_room` already returns the room row, so a joiner sees
  `game_mode`. The join screen does not offer a mode choice; the room's
  mode wins.
- `start-room` reads `room.game_mode` and passes `mode` to `planQuiz`.
- `planQuiz({ ..., mode = 'guess_player' })`:
  - `guess_player` uses the Phase 1 planner and clue families.
  - `football_iq` uses the Football IQ planner branch described in
    3.2. `statRounds` is ignored in this mode.
- `generateQuiz` forwards `mode` to `planQuiz`.
- `store.startQuiz({ scope, seed, mode })` passes the mode. The home and
  solo lobby use `store.state.gameMode`.
- `store.state.gameMode` defaults to `guess_player`, is set by
  `store.setGameMode(mode)`, and persists in localStorage under
  `football-trivia-mode`.
- The home screen gets a compact two-option segmented control under the
  hero subtitle: "Guess the player" and "Football IQ". The selected mode
  applies to the hero CTA, the preset cards, saved vibes, and room
  creation.
- The solo lobby shows the selected mode and a one-line description.
  The room lobby shows the room's mode. The host cannot change it.
- `room.create({ scope, gameMode })` passes `p_game_mode`.
  `room.state.gameMode` is set from `create_room`, `join_room`, and
  `sync_room_state`.
- The results screen shows the mode name. For Football IQ it also shows
  the four format labels instead of the clue-family recap.
- A rematch keeps the room's `game_mode` and writes a fresh Football IQ
  quiz.

### 3.2 Round mix and planner

- Ten rounds: two of each format plus two flex rounds, assigned by a
  seeded shuffle of the four formats. A shorter game cycles the four
  formats in a seeded order.
- No subject repeats across the game, matching the current mode.
- No consecutive repeat of the same format when another format is
  available.
- A format that cannot supply a round for the chosen subject or window
  falls back to another format that can. If none can, the quiz is
  shorter, as today.
- The planner summary reports `formats` (the number of distinct
  templates) and `rounds`.
- New module `js/engine/formats.js` holds the four composers. Each
  returns the same round shape as `composeRound`, plus a `reveal` field:
  `template`, `prompt`, `hook`, `context`, `subjectId`, `subjectName`,
  `answer`, `unit`, `options`, `clues`, `revealSchedule`, `reveal`,
  `difficulty`. `clueFamily` is null for Football IQ rounds, and
  `family` is set to the template so the old results recap still has a
  value.
- `projectRound` puts `reveal` in the secret, not the client row. The
  reveal may contain the exact value or the ranked values, so it must
  not be public before the round closes.
- The format labels, exported by the engine for the client:
  - `club` -> "Club in a season"
  - `teammate` -> "Teammate"
  - `comparison` -> "Most in the pool"
  - `range` -> "Stat range"

### 3.3 Format: club in a season

- Prompt: "Which club did **{player}** play for in **{season}**?"
- Eligibility: the player has exactly one club in that season in the
  pool's `teams` data. A season with two clubs is a mid-season move and
  is skipped. The season is chosen from the player's club-seasons,
  seeded, preferring a season inside the scope window.
- Options: four club names from the pool. Distractors prefer clubs in
  the same league and era, excluding the answer; pad from the pool if
  needed.
- Clues, in order:
  1. "That season, they played in **{league}**."
  2. "They scored **{n}** goals in that season." This uses the player's
     `windows` entry for the club-season; skip the clue when the entry
     is absent.
  3. "They are from **{nationality}**." or "They played as a
     **{position}**."
  4. "They were born in **{year}**." or another profile fact.
- The clues never name the answer club. The career trail is not used
  because it would name the club.
- Answer: the club name. Matching uses `normaliseName`.
- Reveal: `{ format: 'club', player: {id,name}, season, club, league,
  goals }`. The reveal card reads "**{player}** played for **{club}**
  in **{season}** ({league})." plus the goals when known.

### 3.4 Format: teammate

- Prompt: "Who was a teammate of **{player}** at **{club}** in
  **{season}**?"
- Eligibility: a club-season with at least two players in the pool. The
  subject and the answer are distinct. The teammate is chosen seeded,
  preferring one with a position and nationality.
- Options: four player names, including the answer, excluding the
  subject. Other teammates from the same club-season are good
  distractors because they are plausible.
- Clues, in order:
  1. "The teammate played as a **{position}**."
  2. "They are from **{nationality}**."
  3. "They also played for **{otherClub}** in **{otherSeason}**." This
     is the teammate's career, not the shared club-season.
  4. "They were born in **{year}**." or "They were **{foot}**-footed."
- The clues describe the teammate, never the subject. The shared
  club-season is in the prompt, so naming it is not a leak.
- Answer: the teammate's name. Matching uses `normaliseName`.
- Reveal: `{ format: 'teammate', player, teammate, club, season,
  position, nationality }`. The reveal card reads "**{teammate}** was
  at **{club}** with **{player}** in **{season}**."

### 3.5 Format: most in the pool

- Prompt: "Who has the most **{metric label}**?" with four player
  options.
- Metric: one of `club_goals`, `international_goals`,
  `international_caps`, `highest_market_value_eur`,
  `goals_after_age_30`, `club_appearances`. Choose seeded, preferring a
  metric with at least four distinct positive values in the pool.
- The four players: the answer has the highest value; the three
  distractors are the next-highest distinct values, so the comparison
  is close. All four values must be distinct. A tie at the top is
  skipped in favour of another metric or group.
- Clues, in order:
  1. "The answer has more than **{low}**." where `low` is below the
     second-highest value, so at least two of the four remain.
  2. "The answer has more than **{mid}**." where `mid` is between the
     second- and third-highest values, so two remain.
  3. "The answer has more than **{high}**." where `high` is between the
     top two values, so the answer is unique.
  4. A profile fact about the answer: position, nationality, birth
     year, or a club.
- The exact values are not in the clues. The reveal ranks all four.
- Answer: the answer player's name. Matching uses `normaliseName`.
- Reveal: `{ format: 'comparison', metric, metricLabel, unit, values:
  [{ player: {id,name}, value }, ...] }` sorted descending. The reveal
  card is a four-row ranked list with the answer highlighted and the
  exact values.

### 3.6 Format: stat range

- Prompt: the existing metric wording (`How many goals did ...`,
  `How many international caps did ...`) with four range options instead
  of four exact numbers.
- Metric and window: reuse the existing metric values and windows.
  Career metrics (`international_caps`, `goals_after_age_30`,
  `highest_market_value_eur`, career `club_goals`/`club_appearances`)
  use the player's own figures. A tournament window uses the
  tournament's goals. A club-season uses the player's `windows` entry
  for that club-season when present.
- Buckets are fixed and readable:
  - `club_goals`, `international_goals`, `goals_after_age_30`:
    `0-9`, `10-24`, `25-49`, `50+`.
  - `international_caps`: `0-24`, `25-49`, `50-99`, `100+`.
  - `highest_market_value_eur`: `<€10M`, `€10-29M`, `€30-59M`,
    `€60M+`.
  - `club_appearances`: `0-49`, `50-149`, `150-299`, `300+`.
- The answer is the range label containing the value. For counting
  metrics the raw label is the range without its unit (`0-9`, `10-24`,
  `25-49`, `50+`) and the options append the unit (`0-9 goals`, ...).
  Market-value ranges are self-contained labels (`<€10M`, `€10-29M`,
  ...) and are not passed through `withUnit`. The four options are the
  metric's four ranges, built directly rather than through
  `buildOptions`, because the label is the answer. The option value and
  the secret answer are the same raw label, so exact matching is
  unambiguous, and the existing `withUnit` reveal renders "25-49 goals"
  rather than "25-49 goals goals".
- Clues, in order:
  1. "More than **{bucketStart - 1}**." This is the bucket's lower edge.
     Skip it for the bottom bucket.
  2. "Fewer than **{bucketEnd + 1}**." This is the bucket's upper edge.
     Skip it for the top bucket.
  3. A pool percentile or a second bound that narrows to the bucket.
  4. A profile or window fact: club, league, season, nationality, or
     position.
- The two edge clues together pin the bucket without stating the exact
  value. When an edge is missing, the percentile clue replaces it. The
  clues must not contain the exact value.
- Answer: the range label. Matching is exact.
- Reveal: `{ format: 'range', player, metric, metricLabel, unit, value,
  range, window }`. The reveal card uses `formatMetric` for the exact
  value, so a market value reads `€80M`, and adds the range. It reads
  "**{player}** had **{value}** - the **{range}** range." plus the
  window.

### 3.7 Shared round loop and scoring

- All four formats use the Phase 1 loop: one clue visible, reveal on
  demand, multipliers 5/3/2/1, 20-second clock, speed bonus.
- The stage is the visible clue count. In rooms it is the server's
  `clue_index + 1`; in solo it is the local index.
- The reveal breakdown is the same as Phase 1: multiplier, speed factor,
  points.
- Effects are unchanged. A steal copies the target's answer, stage,
  response time, and half points for every format. A side bet pays when
  the target is correct. The effect stories are format-agnostic.
- The round screen stays format-agnostic: prompt, clues, options, and a
  format label. The format label replaces the clue-family chip for
  Football IQ rounds.
- The reveal screen adds one format-specific block; everything else
  (verdict, effects, leaderboard, next round) is unchanged.

### 3.8 Server and data

Additive migration `20261108000100_football_iq.sql`:

- `alter table public.rooms add column if not exists game_mode text not
  null default 'guess_player' check (game_mode in ('guess_player',
  'football_iq'));`
- `alter table public.round_secrets add column if not exists reveal
  jsonb;`
- Replace `create_room` with the six-argument version. Drop the
  five-argument function first.
- Replace `advance_room` so the next round's secret insert carries
  `reveal` from `v_next->'secret'->'reveal'`. The Phase 1 `clue_family`
  insert stays.
- Replace `round_result` to return `reveal` and `game_mode`.
- `current_round` and `sync_room_state` return `game_mode`. The rest of
  the Phase 1 shape stays.
- No `rounds.template` check constraint exists, so the new template
  values need no DDL.

`projectRound`:

- Add `reveal: round.reveal ?? null` to the secret.
- The client payload is unchanged apart from the Phase 1
  `clue_family`. The format is already carried by `template`.

`start-room`:

- Read `room.game_mode` and pass `mode` to `planQuiz`.
- Insert `clue_family` for round one as Phase 1 does.
- Include `reveal` in the `round_secrets` upsert.
- The start response does not need `game_mode`; the room row and
  `sync_room_state` carry it.

`submit-answer`:

- The stage logic is Phase 1's `on_demand` logic, unchanged.
- `answerRound` gains the new templates:
  - `club`, `teammate`, `comparison`: `normaliseName` equality.
  - `range`: exact range-label equality.
  - `stat_value`: the existing exact numeric-string comparison, dormant.
- The secret `answer_value` is a club name, teammate name, player name,
  or range label. The old client's reveal shows a sensible string for
  every format.

### 3.9 Client

- `store.js`: `gameMode` state, `setGameMode`, localStorage load, and
  the mode argument to `startQuiz`.
- `home.js`: the compact mode segmented control.
- `lobby.js`: show the mode; pass it to `startQuiz`; pass it to
  `room.create`.
- `room.js`: `create({ scope, gameMode })`; `state.gameMode` from the
  payload.
- `room-lobby.js`: show the room's mode.
- `round.js`: the family chip becomes a format chip for Football IQ,
  using `FORMAT_LABELS[round.template]`.
- `reveal.js`: if `result.reveal` exists, render the format-specific
  block; otherwise keep the identity reveal. The range answer uses the
  range label, not a raw bucket id.
- `results.js`: show the mode and, for Football IQ, the four format
  labels.
- No new screen and no new input type.

### 3.10 Testing

#### Unit

- Planner: a ten-round Football IQ quiz contains only `club`,
  `teammate`, `comparison`, and `range` rounds, with two of each plus
  two flex; no `identify` or `stat_value` rounds; no subject repeats;
  deterministic per seed.
- Club: the chosen season has exactly one club; the answer club is not
  named in any clue; the four options include the answer and the
  distractors are clubs.
- Teammate: the answer shares the club-season; the subject is not an
  option; the clues describe the teammate; the answer is in the options.
- Comparison: four distinct values; the answer is the maximum; the
  three bounds are below/above the intended values; the reveal ranks all
  four.
- Range: the bucket contains the value; the options are four range
  labels; the clues do not contain the exact value; the reveal carries
  the exact value and the range.
- `answerRound`: normalized matching for club, teammate, and
  comparison; exact matching for range; the dormant `stat_value` branch
  still works.
- Scoring: the Phase 1 stage and time tests still pass for every
  format.

#### Integration (local Supabase)

- `create_room` with `p_game_mode = 'football_iq'` stores the mode; an
  invalid mode is refused; the default is `guess_player`.
- A Football IQ room started through `start-room` has the four
  templates and no identify rounds.
- `round_result` returns the `reveal` payload after the round closes;
  the reveal is absent from `current_round`.
- A steal on a comparison round copies the target's answer, stage, and
  half points.
- A rematch keeps `game_mode` and starts a new Football IQ quiz.
- A guess-the-player room is unchanged: ten identify rounds, Phase 1
  clue families, on-demand progress.

#### Playwright

- Home: select Football IQ, start a solo quiz, see a Football IQ prompt
  and format label, reveal a clue, answer, and see the format-specific
  reveal.
- Football IQ room: the host creates with the mode; the guest joins and
  sees the mode; both play a round; the reveal shows the ranked, range,
  club, or teammate content.
- Guess-the-player remains the default: a fresh session starts in that
  mode.
- No console or page errors.

#### Gate

`npm test` and the room Playwright suite, excluding the two known base
failures. Live checks after deploy.

### 3.11 Rollout

1. Apply the additive migration to the local stack and run the tests.
2. Deploy the migration and the `start-room` and `submit-answer`
   functions. The server must go first: the new client passes the sixth
   `create_room` argument and reads `game_mode`.
3. Publish the client, push `main`, and let Vercel deploy.
4. Live check: one solo Football IQ game (all four formats appear in a
   ten-round game), one Football IQ room, a steal, and a rematch.
5. No pool upload is needed; the data shape is unchanged.

Backward compatibility:

- Guess-the-player solo and rooms are unchanged.
- An old client can join a Football IQ room by code. It sees the text
  prompt, timed clues, text options, and the answer name or range label.
  It ignores the reveal payload and the mode selector. The experience is
  degraded but not broken.
- An old client's `create_room` call uses the five-argument form, which
  resolves to the new function's default and creates a guess-the-player
  room.
- The server deploys before the client, so the new client never calls
  the old schema.

### 3.12 Risks and decisions

- **Football IQ is a different game.** It is a separate mode, not a
  mix. The current mode stays pure.
- **Comparison and range difficulty needs tuning.** The clue bounds and
  the four options are tunable without schema changes. The live sample
  decides.
- **Club questions need a single club in the season.** Mid-season moves
  are skipped. A thin scope may fall back to another format.
- **Teammate questions depend on club-season coverage.** The fixture
  shows over 97% of players have at least one teammate; a thin scope
  falls back to another format.
- **Mode selection adds a home-screen choice.** It is compact and
  defaults to the current mode, so existing players are unaffected.
- **Old clients in Football IQ rooms.** Accepted as a degraded
  experience; the old client cannot create the mode.

### 3.13 Acceptance criteria

- A separate Football IQ mode exists for solo and rooms;
  guess-the-player remains the default and is unchanged.
- A ten-round Football IQ game uses the four formats, with no
  exact-number prompts and no identify rounds.
- Club, teammate, comparison, and range rounds each compose, answer,
  score, reveal, steal, and rematch correctly.
- The press-your-luck loop, multipliers, clock, and speed bonus match
  Phase 1.
- The reveal shows the format-specific content.
- Joining a room uses the room's mode; the home selector applies to
  solo and room creation.
- A guess-the-player room is unaffected.
- All tests pass and the live checks pass.
