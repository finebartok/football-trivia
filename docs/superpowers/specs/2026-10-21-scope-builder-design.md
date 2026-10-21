# Scope Builder — Phase 5 design

**Date:** 2026-10-21
**Status:** approved in conversation; written up here for review
**Builds on:** `docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` §5.5, §5.7, §10 (Phase 5), and `docs/superpowers/specs/2026-10-21-multiplayer-room-design.md` (the room this phase connects to)

---

## 1. What this is

The vibe crafter already exists: a grid of presets, five named moves, a live pool count, and "Make this ours". It is a good screen with five gaps in it, and those gaps are exactly the ones the v1 spec names in Phase 5.

This phase closes them:

| The spec asks for | Today |
|---|---|
| Stat threshold control with a live count and a nearest-valid suggestion | Five fixed thresholds. The player cannot type one. |
| A coverage warning that says *why* | "A vibe needs at least 20 players to write a quiz from." |
| A low-coverage scope refused on save, with the reason | Saving is not refused at all. |
| A tournament picker | No tournament move. The data has one tournament. |
| Share links | "Copy your score" copies text, not a link. |

And it closes one gap the room phase left open: **a crafted vibe is playable in a room.** Today the room takes a preset id and the server resolves the scope itself, so a vibe the player crafted is refused by the server with "unknown vibe".

### 1.1 The two decisions this design was built on

- **A share link carries the vibe's definition.** Not a server-stored scope id. The spec's §5.7 says it outright: *"The share link carries the vibe's definition and opens as a ready-to-play card for the recipient."* The scope travels in the URL fragment, so it never reaches a server, and the saved-vibes list stays in the browser with no accounts.
- **The era control stays as bands.** The spec's §5.5 says "era slider", but the coverage is not smooth — La Liga 2010s resolves 236 players and 2002–11 resolves 49 — and the same section insists the cliff must stay visible. A continuous slider has to interpolate over that cliff, so it would show a number describing no window that exists. The bands are the data's real coverage, and each one shows its own count.

---

## 2. What the player does

1. **Opens a vibe.** A preset from the grid, one of their saved vibes, or a link someone sent them.
2. **Makes moves.** Different era, different competition, add a club, only these nations, a tournament, a stat threshold. The pool count updates live with every move.
3. **Types a threshold.** The number they typed stays in the field. If the pool falls under the floor, a suggestion appears beside it: *"only 3 players hit 200+ goals aged 30+ — try 50+"* — and one tap applies it.
4. **Saves.** If the pool is under the floor, saving is refused with the reason: *"only 49 players have La Liga data for 2002–11"*. The vibe is not lost; the player can widen it and save it then.
5. **Shares.** A link that opens as a ready-to-play card for whoever receives it.
6. **Plays it.** Solo, or in a room with friends.

### 2.1 The floor

The floor is twenty players, and it is the engine's own (`MIN_POOL` in `js/engine/planner.js`). A scope under it cannot produce a quiz, so it cannot be saved and it cannot start a game. The spec's rule is the same: the scope is *refused with the count*, never silently padded.

---

## 3. The pieces

### 3.1 `lib/scope.js` — new, shared and pure

The browser and the server both need to reason about a scope. The engine already owns matching (`js/engine/scope.js`); this module owns the advice around it. It has no imports beyond `lib/seasons.js`, so it runs in the browser, in Node and in Deno.

```js
/**
 * The nearest threshold that holds.
 *
 * A ">= threshold" pool shrinks monotonically as the threshold rises, so
 * the nearest holding threshold is a binary search, not a scan over every
 * number. Returns { value, count }.
 */
export function nearestThreshold({ scope, metric, op = '>=', players, floor = 20, min = 0, max = 5000 })

/** The sentence a player reads when the pool is too thin. */
export function describeCoverage({ scope, count, floor = 20 })

/** The scope's clauses, name and icon, as a link payload. */
export function encodeScope(scope)
export function decodeScope(code)      // null when the payload is not a scope

/** Is this a scope the server will accept? Returns { ok, reason }. */
export function validateScope(scope, { registry, players })
```

`nearestThreshold` searches downward first: the largest threshold at or below the typed one whose pool still clears the floor, falling back to the smallest threshold above it that does. The spec's own example — "200+ goals aged 30+ … try 50+" — is the downward case.

`validateScope` checks the shape, not the size:

- a clause's `leagues` and `clubs` entries exist in the registry's maps, and its `tournaments` entries exist in the registry's tournament list;
- a clause's `nations` entries are countries the pool knows — the registry holds no countries, they live on the players' citizenship;
- a clause's `stats` entries name a known metric, a known operator and a number;
- a clause's `seasonStart` and `seasonEnd` are numbers within the data's range.

It does **not** check the pool size — that is the floor's job, and it is checked where the size is known.

### 3.2 The client

**`client/src/vibe-moves.js`** — new. The moves, their option lists, and `applyMove` move out of `client/src/screens/vibes.js`, which is already 270 lines and would pass 400 with this phase's work. The screen keeps the shell: the vibe header, the count, the moves, the threshold field, the save, the share.

The threshold field replaces the fixed stat choices:

- a number input with the metric and operator already chosen from the quick picks;
- the count updates as they type;
- under the floor, the field keeps their number and a suggestion sits beside it;
- the quick picks stay, as one-tap ways to reach a threshold that holds.

The tournament move lists the registry's tournaments with their pool counts, exactly as the competition move does.

The share button copies a link. The link's payload is the scope's clauses, name and icon, base64url-encoded into the fragment: `#vibe?c=<payload>`. The router opens it as a vibe card — the same card a preset opens, with "Play" and "Make this ours" — and the player can play it, save it, or fork it.

### 3.3 The server

Two changes, both small.

**Scope resolution.** `create_room` and `start-room` resolve a room's scope like this:

- a `scope_id` that names a preset keeps using the **preset's** clauses. The client cannot change what a preset means, which is the guarantee the room already has and the integration test already pins.
- a crafted scope arrives with the room's own clauses and is validated with `validateScope` before it is planned. A malformed scope is refused with a reason.

**The floor, before the plan.** `start-room` computes the pool for the resolved scope and, if it is under the floor, refuses with the count and a suggestion rather than letting the engine's own `MIN_POOL` throw — which today reaches the player as a 500.

`create_room` already takes the scope's clauses, so **no migration is needed**: the room's `scope_clauses` column was there from the start, and the change is in what the server does with them.

### 3.4 What stays where

| Thing | Home |
|---|---|
| Which players a scope matches | `js/engine/scope.js` (unchanged) |
| The floor | `js/engine/planner.js` (unchanged) |
| The advice around a scope | `lib/scope.js` (new) |
| The moves and their options | `client/src/vibe-moves.js` (new) |
| The screen | `client/src/screens/vibes.js` (edited) |
| The route for a shared link | `client/src/main.js` (edited) |
| Room scope resolution | `supabase/functions/_shared/start-room.js`, `supabase/migrations/…00200…` (edited) |

---

## 4. The flow, end to end

```
  preset card ──┐
  saved vibe ───┼──> the vibe screen ──> moves ──> live count
  shared link ──┘         │                            │
                           │                            ├──> under the floor?
                           │                            │      "only 49 players have
                           │                            │       La Liga data for 2002-11"
                           │                            │      [try 50+]   (a suggestion)
                           │                            │
                           ├──> save ──> under the floor? refuse with the reason
                           │            over it?       saved
                           │
                           └──> share ──> a link ──> the recipient's vibe screen
```

---

## 5. Error handling

| Case | What the player sees |
|---|---|
| A threshold that leaves three players | The number stays in the field, the count shows 3, and a suggestion names a threshold that holds. |
| An era with thin coverage | The count is marked, and the reason is on the card. |
| Saving a thin scope | Refused, with the reason and the count. The vibe is not lost. |
| A link that is not a scope | "That link is not a vibe." and the home screen. |
| A link to a scope with a bad shape | The same. A link cannot carry a scope the server would refuse. |
| A room with a scope under the floor | The host is told: "only 3 players fit that vibe — widen it and try again." The room stays in the lobby. |
| A room with a scope the server refuses | The host is told why. The room stays in the lobby. |

Nothing in this list reaches the player as a 500, and nothing names a scope, a predicate, a metric, a window id or a raw id.

---

## 6. Testing

| Layer | Approach |
|---|---|
| `lib/scope.js` | Unit tests: the nearest threshold against a real pool (monotonic, so the binary search is checkable), the coverage sentence, the link round trip, and the validator's four checks. |
| The vibe screen | Playwright: type a threshold and see the count and the suggestion; try to save a thin scope and be refused with the reason; open a link and land on the card. |
| The room | Integration: a room with a crafted scope plays it; a malformed scope is refused; a scope under the floor is refused with a count; a preset room still ignores the clauses the client sent. |

---

## 7. What is deliberately not built

- **No accounts and no server-stored scopes.** The link carries the vibe. The v1 spec puts "accounts beyond anonymous sessions + saved scopes" out of v1.
- **No free-form composer.** v2, and only if people fork presets but never build.
- **No era slider.** The bands are the data's coverage; see §1.1.
- **No discovery.** No "vibe of the week", no browsing other people's vibes.
- **No tournament roster work** beyond the picker. The data has one tournament; the move grows when the data does.
- **No shareable results, no shareable scores.** The link shares the vibe, not a result.
- **Nothing that changes the engine.** The matching, the floor and the planner are untouched.

---

## 8. The files this phase adds or changes

```
lib/scope.js                              new
client/src/vibe-moves.js                  new
client/src/screens/vibes.js               edited - the shell
client/src/main.js                        edited - the #vibe route
client/src/screens/home.js                edited - the share button
supabase/functions/_shared/start-room.js  edited - resolve and check the scope
supabase/migrations/…00200_room_functions.sql  edited - create_room takes a custom scope
tests/shared/scope.test.js                new
tests/client/vibes.spec.js                new
tests/integration/room.test.js            edited
```

---

## 9. Open questions for the implementer

None that change the shape of the work. Two small ones, answered here so they are not reopened:

- **A share link is long.** A vibe with three clauses encodes to roughly 120 characters of base64url. That is a long URL but a normal one, and it is shorter than most links people paste into a chat. If it turns out to be too long in practice, the fix is a server-stored scope id, not a shorter encoding.
- **The link's payload is not signed.** Anyone can craft a link, and the server validates what it carries. The server never trusts a link, and a link cannot make the server do anything the player could not already do by typing the clauses into a room.
