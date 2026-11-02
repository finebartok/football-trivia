# Football IQ mode implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a separate `football_iq` mode with four round formats (club, teammate, comparison, range) while guess-the-player stays the default and unchanged.

**Spec:** `docs/superpowers/specs/2026-11-01-football-iq-mode-design.md`

**Base:** Phase 1 press-your-luck work: per-player `round_progress`, `reveal_clue`, server-owned stage, clue families. All of it is committed and green before this plan starts.

**Tech stack:** Plain ES modules, Node test runner, Playwright, Supabase Postgres, edge functions. No React.

## Global constraints

- Guess-the-player rounds never appear in a Football IQ quiz and the reverse.
- Football IQ uses the Phase 1 loop unchanged: one free clue, on-demand reveals, 5/3/2/1, 20s clock, speed bonus.
- No exact-number options. Range rounds answer with a range label; comparison rounds answer with a player name.
- The reveal payload is secret until `round_result`; it never appears in `current_round` or `sync_room_state`.
- Server first: migration and functions deploy before the client.
- An old client can still create a guess-the-player room with the five-argument `create_room` call.

---

### Task 1: Migration

**Files:** Modify `supabase/migrations/20261101000200_game_mode.sql`

- [ ] Rewrite the migration so it contains the whole Phase 2 schema:
  - `rooms.game_mode` is `text not null default 'guess_player'` with a check for the two values. Backfill any nulls first so the migration is safe on a database that already ran the old bare `ADD COLUMN`.
  - `round_secrets.reveal jsonb`.
  - `drop function if exists public.create_room(text, jsonb, text, text, text);` and the six-argument `create_room` with `p_game_mode text default 'guess_player'`. Validate the value with the check constraint and store it.
  - `current_round(uuid, boolean)` adds `game_mode` to both return shapes (the no-round shape and the normal shape).
  - `advance_room(uuid)` copies from the Phase 1 body and adds `reveal` to the `round_secrets` insert.
  - `round_result(uuid, int)` returns `reveal` from the secret and `game_mode` from the room.
  - `notify pgrst, 'reload schema';`
- [ ] `npx supabase db reset`, then `npm run supabase:upload`.
- [ ] Commit.

### Task 2: Football IQ engine

**Files:** Create `js/engine/formats.js`; modify `js/engine/planner.js`, `js/engine/questions.js`, `js/engine/index.js`, `supabase/functions/_shared/projection.js`

Interfaces:

```js
IQ_FORMATS = ['club', 'teammate', 'comparison', 'range']
FORMAT_LABELS = { club: 'Club in a season', teammate: 'Teammate',
  comparison: 'Most in the pool', range: 'Stat range' }
composeFormatRound({ format, pool, registry, window, scope, rng, stages,
  difficulty, excludeSubjectIds }) -> round | null
planIqQuiz({ scope, pool, registry, seed, rounds, difficulty }) -> quiz
planQuiz({ ..., mode = 'guess_player' })
```

- [ ] `formats.js`:
  - `buildClubRound`: only a club-season where the subject has exactly one club. Options are four club names, preferring the same league and era. Clues: league, that season's goals when the window exists, nationality/position, birth year. The answer club never appears in a clue.
  - `buildTeammateRound`: a club-season with at least two players in the pool. The answer is a teammate; the subject is never an option; other same-season teammates are preferred distractors. Clues describe the teammate, never the subject.
  - `buildComparisonRound`: metrics `club_goals`, `international_goals`, `international_caps`, `highest_market_value_eur`, `goals_after_age_30`, `club_appearances`. Four distinct values, unique top. Three bounds narrow the field. The fourth clue is a profile fact. Reveal ranks all four.
  - `buildRangeRound`: reuse the existing metric values and windows. Fixed buckets per metric from the spec. Options are the four buckets; the answer is the raw bucket label. Edge clues pin the bucket without stating the value. Reveal carries the exact value and the range.
  - Every queued round carries `template`, `prompt`, `hook`, `context`, `subjectId`, `subjectName`, `answerPlayerId`, `answer`, `unit`, `options`, `clues`, `revealSchedule`, `reveal`, `difficulty`, `family: template`, `clueFamily: null`.
  - A builder returns `null` when the pool cannot supply a valid round.
- [ ] `questions.js`: export `metricValue` so range uses the same reading as stat rounds.
- [ ] `planner.js`: `iqFormatSchedule(rounds, rng)` gives ten rounds two of each format plus two seeded flex rounds, with no adjacent repeat. `planIqQuiz` walks the schedule, falls back to another format when one returns `null`, and never repeats a subject. `planQuiz` routes on `mode`. The summary reports `rounds`, `formats`, and `subjects`.
- [ ] `projectRound` puts `reveal` in the secret only and uses `answerPlayerId ?? subjectId` for `target_player_id`.
- [ ] `index.js`: export the formats, labels, `planIqQuiz`, and forward `mode` from `generateQuiz`; `answerRound` matches names for club/teammate/comparison and exact labels for range and dormant `stat_value`.
- [ ] Tests in `tests/engine/formats.test.js` and additions to `tests/engine/planner.test.js`, `tests/engine/scoring.test.js` cover the spec's unit list. Run `node --test tests/engine/*.test.js`.
- [ ] Commit.

### Task 3: Server functions

**Files:** Modify `supabase/functions/_shared/start-room.js`, `submit-answer.js`; add `tests/integration/football-iq.test.js`

- [ ] `start-room` passes `mode: room.game_mode ?? 'guess_player'` to `planQuiz`; writes `reveal` into the first `round_secrets` row.
- [ ] `submit-answer` uses the Phase 1 on-demand stage. No change is needed beyond `answerRound` learning the new templates.
- [ ] Integration tests: mode default/stored/invalid; a Football IQ plan has the four templates and no identify; `round_result` carries `reveal` and `game_mode`; `current_round` never carries `reveal`; rematch keeps the mode; a guess-the-player room is unchanged.
- [ ] Run `node --test tests/integration/*.test.js` with the local stack and functions server.
- [ ] Commit.

### Task 4: Client mode plumbing

**Files:** Modify `client/src/store.js`, `client/src/screens/home.js`, `lobby.js`, `room-lobby.js`, `client/src/room.js`

- [ ] `store.state.gameMode` defaults to `guess_player`, loads from `football-trivia-mode`, persists via `setGameMode`, and `startQuiz` passes it to `planQuiz`.
- [ ] Home gets a two-button segmented control under the hero subtitle (`#mode-guess`, `#mode-iq`) with `is-active` on the chosen mode.
- [ ] Lobby shows the mode and its one-line description, starts the quiz with it, and creates rooms with `gameMode`.
- [ ] `room.create` passes `p_game_mode`; `room.state.gameMode` is set from `create_room`, `join_room`, and every `sync_room_state`.
- [ ] Room lobby shows the room's mode. It is not changeable.
- [ ] Commit.

### Task 5: Round, reveal, results

**Files:** Modify `client/src/screens/round.js`, `reveal.js`, `results.js`

- [ ] Round chip: Football IQ uses `FORMAT_LABELS[round.template]`; guess-the-player keeps the clue-family chip. Everything else is format-agnostic.
- [ ] Reveal: one block (`#iq-reveal`) when `result.reveal` (room) or `round.reveal` (solo) exists.
  - club: "Player played for Club in Season (League)." plus goals.
  - teammate: "Teammate was at Club with Player in Season."
  - comparison: four ranked rows with exact values, answer highlighted.
  - range: "Player had <formatted value> — the <range> range."
  - Guess-the-player renders exactly as today.
- [ ] Results: show the mode. Football IQ lists the four format labels instead of the clue-family recap; rooms show the mode name.
- [ ] Playwright: home selector starts a solo IQ quiz; the round shows a format chip and prompt; the reveal shows `#iq-reveal`; a fresh session defaults to guess-the-player. Add one IQ room test that creates, joins, starts, and reaches a format round.
- [ ] Enforce `npm test`, `npx playwright test tests/client/client.spec.js tests/client/room.spec.js`.
- [ ] Commit.

### Task 6: Deploy

- [ ] Server first: apply the migration, deploy `start-room` and `submit-answer`.
- [ ] Publish the client, push `main`, let Vercel deploy.
- [ ] Live checks: one ten-round solo IQ game (all four formats), one IQ room with a steal, one rematch, one guess-the-player room. No pool upload.

## Done when

- A ten-round Football IQ game has all four formats, no identify or stat_value rounds, no repeated subject, no exact-number options.
- Range answers land in the shown bucket and the reveal shows the exact value.
- Comparison options have four distinct values and the reveal ranks them.
- Club clues never name the answer club; the teammate subject is never an option.
- Guess-the-player solo and rooms are unchanged, including Phase 1 reveals.
- The old five-argument `create_room` still resolves and creates a guess-the-player room.
- Unit, integration, and Playwright suites pass.
