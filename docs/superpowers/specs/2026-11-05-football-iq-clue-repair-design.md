# v1.4.1: Football IQ clue repair

Date: 2026-11-05
Status: approved 2026-11-05; implementation plan in
`../plans/2026-11-05-football-iq-clue-repair.md`
Supersedes: sections 3.3, 3.5, and the market-value wording in 3.6 of
`2026-11-01-football-iq-mode-design.md`
Base: `5b5d1d8` (v1.4 live)

## 1. Context

The v1.4 Football IQ mode shipped with four formats, but two of them
produce clues that are true and still useless. Live examples:

- A club round named the player, then offered "That season, they played
  in La Liga", "A left-footed centre-back", and "Born in 1993". The
  player was already named, the league was shared by all four options,
  and there was no season-goals clue. The round was pure recall.
- A comparison round offered "The answer has more than 313 goals",
  "more than 330", and "more than 496". Those are the exact totals of
  the 4th-, 3rd-, and 2nd-place options. They require memorising every
  option's total, leak the distractors' numbers, and label a lower bound
  "The leader".
- A range round could say "More than €30.0M" for the `€30-59M` bucket,
  which excludes a player worth exactly €30M.

The mode split is not the problem. Guess-the-player is untouched, and the
separate IQ mode keeps the bad rounds out of the main quiz. The problem
is the clue recipes and the lack of tests that would have caught them.

## 2. Goals and non-goals

### Goals

- Keep all four formats and the existing mode split.
- Make every club-round clue about the requested club-season, not about
  the already-named player's immutable profile.
- Replace numeric comparison bounds with named comparators.
- Make range bounds correct at every bucket edge, including market value.
- Encode the clue rules as tests so the same class of decoration cannot
  return.
- Keep the Phase 1 loop, scoring, rooms, effects, and rematch unchanged.
- Deploy server-first; no migration and no client code change.

### Non-goals

- Changing the mode selector, room mode ownership, or rematch behaviour.
- Adding a new format or removing a format.
- Changing the round length, scoring curve, or clue-reveal multipliers.
- Hiding the player's name in the club round. It stays named.
- Rewriting the teammate format.
- Changing the player pool or the data schema.

## 3. Clue quality contract

These rules apply to every Football IQ round and are enforced by tests.

1. **True.** Every clue is true of the round's answer.
2. **No leak.** No clue names the answer club, teammate, or comparison
   answer.
3. **No universal club or comparison clue.** A club or comparison clue
   that is true of every option is decoration. It may appear only as the
   final flavour clue, never as one of the first two. Teammate and range
   already describe a hidden answer, so their existing clue types stay.
4. **Two discriminating clues.** At least two clues must describe the
   thing being asked for:
   - club: the answer club-season (season goals, that season's squad, or
     a career club that is one of the options);
   - comparison: the named comparators;
   - teammate: the hidden teammate (role, nationality, career, or birth
     year);
   - range: the value and its bucket.
5. **Useful first clue.** For club and comparison, the free first clue
   is always one of the discriminating clues. A profile fact is never
   first. Teammate and range keep their existing order.
6. **Valid options.** Every option must be a possible answer to the
   question:
   - club: every option club was in the same league in that season;
   - comparison: the four options hold the top four distinct metric
     values, with a unique maximum;
   - teammate: the answer is a same-club-season teammate, and the subject
     is never an option;
   - range: the four options are the metric's four buckets.
7. **Profile last.** A role, birth year, nationality, or height fact may
   be the final clue. It is not counted toward the two discriminating
   clues.

## 4. Club round

Prompt stays: "Which club did **{player}** play for in **{season}**?"

### Eligibility

A subject is eligible only when:

- the player has exactly one club in that season in the pool's `teams`
  data (existing rule); and
- the club-season supplies at least one club-season fact: a positive
  `windows` goals entry for that club-season, or at least one other pool
  player at that club in that season.

A candidate with no club-season fact is skipped; it is not padded with
profile facts.

### Options

- Three distractors from the same league and the same season as the
  answer.
- If the player has another club that was also in that league in that
  season, include it deliberately so the career clue can eliminate it.
- If fewer than three valid clubs exist, skip the candidate. The planner
  falls back to another format.

This removes dead options such as a club that was not in the league that
season.

### Clues

In order:

1. **The season** — "They scored **{n}** goals in **{season}**." When the
   `windows` entry is absent or zero, use **The squad** — "**{teammate}**
   was in the squad that season." This first clue is free.
2. The other of the season/squad facts, when available.
3. **The career** — "Also played for **{option club}** in
   **{other season}**." Used only when the named club is one of the four
   options, so the clue eliminates that option. Skipped otherwise.
4. **The profile** — one role, birth-year, nationality, or height fact,
   as flavour.

The league clue is removed when every option is in the same league,
which is always under the new option rule. A round with fewer than two
discriminating clues (season, squad, or career-option) is not used.

### Reveal

Unchanged: `{ format: 'club', player, season, club, league, goals }`.
The card reads "**{player}** played for **{club}** in **{season}**
({league})." plus the goals when known.

## 5. Comparison round

Prompt stays: "Who has the most **{metric label}**?"

### Options and values

Unchanged: the top four distinct values, a unique maximum, four player
names as options.

### Clues

In order:

1. **The field** — "The answer has more than **{4th-place player}**."
2. **The shortlist** — "The answer has more than **{3rd-place player}**."
3. **The runner-up** — "The answer has more than **{runner-up}**."
4. **The profile** — one fact about the answer, as flavour.

No numbers appear in the three comparator clues. The final profile clue
may contain a birth year. Each named comparator is one of the options, so
the ladder works by elimination: the 4th is ruled out, then the 3rd, then
the runner-up.

### Reveal

Unchanged: ranked four rows with exact values, answer highlighted.

## 6. Range round

Everything stays except the market-value bound wording.

- Counting metrics keep "More than 24 goals" and "Fewer than 50 goals".
- Market-value buckets use the bucket edge, not `start - 1`:
  - `<€10M` -> "Under €10M";
  - `€10-29M` -> "€10M or more" / "Under €30M";
  - `€30-59M` -> "€30M or more" / "Under €60M";
  - `€60M+` -> "€60M or more".
- A value exactly on a bucket edge must satisfy its own bucket's clues.
- The percentile clue and profile flavour clue stay.

## 7. Teammate round

No gameplay change. It already asks for a hidden teammate and its clues
describe that teammate. It is added to the shared contract tests so a
future edit cannot quietly make the clues describe the subject or stop
describing the teammate.

## 8. Tests

### Contract tests

For every format, over many seeds:

- every clue is true of the answer;
- no clue names the answer;
- at least two clues describe the thing being asked for;
- every option is valid for the question.

For club and comparison only:

- the first clue is discriminating;
- no profile fact appears before a discriminating clue.

Club-specific checks:

- every option club has the asked season in the same league;
- every club round has a season-goals clue or a squad clue;
- every club round has at least two of season, squad, and career-option
  clues;
- a career clue, when present, names an option other than the answer.

Comparison-specific checks:

- the three comparator clues contain no digits;
- each named comparator is an option;
- the answer is the only option not named by a comparator clue.

Range-specific checks:

- values exactly €10M, €30M, and €60M satisfy their bucket's floor and
  ceiling clues;
- the floor and ceiling do not use the exact answer value.

### Regression tests

- The Mikel Villanueva club round shows a season/squad clue before any
  profile clue and offers only clubs that were in that season's league.
- The Messi/Ronaldo comparison round has named comparators and no
  numeric thresholds.

### Suites

- `node --test tests/engine/*.test.js`
- `npm test`
- `npx playwright test tests/client/iq.spec.js`

## 9. Rollout and compatibility

- No database migration.
- No client source change: the clue labels and values come from the
  engine payload, and the client already renders them.
- The functions vendor the engine, so run `npm run supabase:serve` before
  the integration suite, then deploy with `npm run supabase:deploy`.
- Deploy functions before pushing `main`; Vercel then publishes the
  client and the engine together.
- Live check: one ten-round solo IQ game, one IQ room that reaches a
  club round and a comparison round, and a guess-the-player room to
  confirm it is unchanged.
- Old clients are unaffected: no RPC or database shape changes.

## 10. Done when

- A club round never opens with a profile fact and never offers a club
  that was not in that season's league.
- A comparison round never contains a numeric bound and its named
  comparators are the options it eliminates.
- A player valued at exactly €30M is correctly placed in `€30-59M`.
- The contract tests fail if any of those regress.
- Guess-the-player, rooms, steals, and rematch behave as before.
