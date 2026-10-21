# Client Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first client that turns the finished engine into something a person can actually play — craft a vibe, generate a quiz, play ten rounds, see the reveal, share the result.

**Architecture:** No build step and no framework. The engine (`js/engine/`) is plain ESM and runs in the browser unchanged, so the client loads `data/fixtures/pool.sample.json` over HTTP and calls `generateQuiz()` directly — the game is real from the first commit, with no backend. A hash router mounts one screen at a time from `client/src/screens/`. Two themes ship as CSS custom properties on `[data-theme]`: Retro Collectible (default) and Premium Editorial (optional).

**Tech Stack:** Plain ESM modules, CSS custom properties, no build step, no framework. Served by `python3 -m http.server` for dev and tests. Playwright for the end-to-end test (already a devDependency).

**Spec:** `docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` — §8 (client) and §5.7 (the vibe crafter) are the binding authority. The approved visual direction is the Retro Collectible mockup; the Premium Editorial mockup is the optional theme.

**Design reference:** the approved mockups live in the brainstorm workspace (`.superpowers/brainstorm/2026-10-20-game-engine/` was a different session — instead, see §2 below for the token values, which are exact).

## Global Constraints

- **Mobile-first.** Every screen must work at 360px wide. The primary target is a phone held in one hand.
- **No build step, no framework.** `client/src/**` is plain ESM the browser loads directly. No bundler, no JSX, no npm runtime dependency.
- **The engine is used unchanged.** The client calls `generateQuiz`, `scopePool`, `planQuiz` — it must not reimplement scope matching, clue generation or scoring.
- **The engine is under the hood.** The plan's shape may appear on the results screen (after the game). It must never appear before the game starts.
- **User-facing noun is "vibe"; the verb is "craft".** No player-facing string mentions a scope, a metric, a predicate or a window id. Internal ids (club ids, league ids) are never rendered — always the display name.
- **No fabricating.** A player with no photo gets the jersey tile (initials on a deterministic colour), never a broken image.
- **Theme tokens only.** Colour, radius, border width, shadow and font all come from CSS custom properties. A screen must not hard-code a colour.
- **Nothing is written to the server.** Phase 3 is client-only; saved vibes live in `localStorage` under `football-trivia-vibes`.

## Review Focus

1. **A 360px-wide viewport.** Every screen must be usable with no horizontal scroll. Test at 360×740.
2. **A player with no photo** — the jersey tile must render with the player's initials, not an empty box.
3. **A scope whose pool is below 20** — the crafter must refuse it with the count and the reason, never pad it.
4. **Reloading mid-round** — the app must land on a valid screen, not a half-rendered round.
5. **A player name containing an apostrophe or a non-Latin character** — it must render correctly and match correctly in the engine.

---

## 1. File structure

```
client/
  index.html              # the shell: fonts, styles, one #app mount point
  styles/
    tokens.css            # both themes as custom properties on [data-theme]
    app.css               # shared components + @import of every screen stylesheet
    screens/
      home.css  vibes.css  lobby.css  round.css  reveal.css  results.css  credits.css
  src/
    main.js               # bootstrap, hash router, screen mounting
    store.js              # app state: pool, scope, quiz, round index, theme
    pool.js               # loads pool.sample.json; scope helpers; presets
    ui.js                 # tiny DOM helpers (el, clear, on, text)
    screens/
      home.js
      vibes.js            # the vibe crafter
      lobby.js
      round.js
      reveal.js
      results.js
      credits.js
tests/client/
  client.spec.js          # Playwright end-to-end
```

**Boundaries:** `pool.js` knows about data; `store.js` knows about state; `ui.js` knows about the DOM; each screen knows about one screen. Screens never talk to each other — they read the store and dispatch actions.

---

## 2. Theme tokens (exact values — copy verbatim)

```css
:root, [data-theme="retro"] {
  --bg: #f6ecd6;
  --ink: #2b2119;
  --gold: #b8860b;
  --red: #c0392b;
  --win: #1f5d3a;
  --surface: #fff8e6;
  --highlight: #ffe9a8;
  --line: #2b2119;
  --muted: #7a6448;
  --radius: 14px;
  --radius-sm: 10px;
  --radius-lg: 20px;
  --border: 2px solid var(--ink);
  --shadow: 0 3px 0 var(--ink);
  --shadow-lg: 0 6px 0 var(--ink);
  --font-display: 'Fredoka', 'Trebuchet MS', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --paper: radial-gradient(rgba(0,0,0,.05) 1px, transparent 1px);
  --paper-size: 9px 9px;
}

[data-theme="editorial"] {
  --bg: #faf8f3;
  --ink: #17130f;
  --gold: #c8102e;
  --red: #c8102e;
  --win: #1f5d3a;
  --surface: #ffffff;
  --highlight: #f3efe7;
  --line: #e4ded2;
  --muted: #8a8175;
  --radius: 2px;
  --radius-sm: 2px;
  --radius-lg: 3px;
  --border: 1px solid var(--line);
  --shadow: 0 1px 0 var(--line);
  --shadow-lg: 0 2px 0 var(--line);
  --font-display: 'Playfair Display', Georgia, serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --paper: none;
  --paper-size: 0 0;
}
```

`--gold` is the accent in both themes (gold in Retro, crimson in Editorial). `--paper` is the halftone dot overlay on the body; Editorial disables it.

---

## 3. The presets (exact)

These are the `PRESET_SCOPES` the crafter offers. Pool sizes are measured, not guessed.

```js
export const PRESETS = [
  { id: 'laliga-2010s', name: 'La Liga 2010s', desc: 'A decade of Spanish football',
    icon: '🇪🇸', clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }], pool: 1854 },
  { id: 'premier-2010s', name: 'Premier League 2010s', desc: 'A decade of English football',
    icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }], pool: 1924 },
  { id: 'premier-2425', name: 'Premier League 2024/25', desc: 'Last season, right now',
    icon: '🆕', clauses: [{ leagues: ['GB1'], seasonStart: 2024, seasonEnd: 2025 }], pool: 1983 },
  { id: 'wc-2022', name: 'World Cup 2022', desc: 'Every squad in Qatar',
    icon: '🏆', clauses: [{ tournaments: ['wc-2022'] }], pool: 231 },
  { id: 'late-bloomers', name: 'Late Bloomers', desc: '50+ goals aged 30+',
    icon: '🎯', clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 50 }] }], pool: 111 },
  { id: 'ever-capped', name: 'Ever Capped', desc: '50+ international caps',
    icon: '🎽', clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 50 }] }], pool: 1023 },
  { id: 'centurion-club', name: 'Century Club', desc: '100+ goals since 2012',
    icon: '💯', clauses: [{ stats: [{ metric: 'club_goals', op: '>=', value: 100 }] }], pool: 160 },
];
```

**The pool counts above are the spec's measured figures for the full 50k-player pool.** The client runs against the 82-player fixture, where the counts are much smaller. **The client must compute the count live from the loaded pool, never show the hardcoded number.** The numbers above are the fallback shown before the pool loads.

---

## 4. Tasks

### Task 1: Shell, tokens, and the Playwright harness

**Files:**
- Create: `client/index.html`, `client/styles/tokens.css`, `client/styles/app.css`
- Create: `tests/client/client.spec.js`, `playwright.config.js`
- Modify: `package.json` (scripts only — add `dev` and `test:client`)

**Interfaces:**
- Consumes: nothing
- Produces: `client/index.html` serving at `/client/` with `#app` as the mount point; `client/styles/tokens.css` defining the exact tokens from §2; a Playwright config with a `webServer` that runs `python3 -m http.server 8099` from the repo root.

**Steps:**

1. Write `client/index.html` — a single page: the Google Fonts link for Fredoka, Playfair Display and Inter; `client/styles/tokens.css`; `client/styles/components.css`; `<div id="app"></div>`; and `<script type="module" src="/client/src/main.js"></script>`. Add `<meta name="viewport" content="width=device-width, initial-scale=1">`.
2. Write `client/styles/tokens.css` with the tokens from §2 **verbatim**, plus a body rule applying the `--paper` halftone overlay.
3. Write `client/styles/app.css` — the shared pieces, all using tokens only: `.card`, `.btn` (primary = red fill, secondary = surface + border), `.clue-card`, `.clue-ladder` with `.step`/`.step.is-current`/`.step.is-done`, `.option` with `.option__letter`, `.banner` (the window banner), `.tile` (jersey tile), `.rank-row`, `.vibe-card`, `.topbar`, `.toast`. **No colour literals outside `tokens.css`.**
   At the very top of `app.css`, after nothing else, put the screen imports (CSS `@import` must precede all other rules):
   ```css
   @import url("./screens/home.css");
   @import url("./screens/vibes.css");
   @import url("./screens/lobby.css");
   @import url("./screens/round.css");
   @import url("./screens/reveal.css");
   @import url("./screens/results.css");
   @import url("./screens/credits.css");
   ```
   The screen stylesheets are created by later tasks; a missing `@import` is a harmless 404 until its file exists.
4. Write `playwright.config.js` with `webServer: { command: 'python3 -m http.server 8099', url: 'http://localhost:8099/client/', reuseExistingServer: true }` and a `projects` entry with `use: { viewport: { width: 390, height: 844 } }` (iPhone-ish).
5. Write `tests/client/client.spec.js` with one smoke test: the page loads, `#app` is visible, and no console errors were recorded.
6. Add `"dev": "python3 -m http.server 8099"` and `"test:client": "playwright test"` to `package.json` scripts. **Do not add dependencies.**
7. Run `npx playwright test` — Expected: the smoke test passes.
8. Commit.

### Task 2: `ui.js`, `pool.js`, `store.js`

**Files:**
- Create: `client/src/ui.js`, `client/src/pool.js`, `client/src/store.js`

**Interfaces:**
- Consumes: `js/engine/index.js` (`scopePool`, `planQuiz`), `data/fixtures/pool.sample.json`
- Produces (from `client/src/ui.js`): `el(tag, props = {}, children = [])` — creates an element; `props.className`, `props.text`, `props.html`, `props.attrs`, `props.on` (event map). `clear(node)` empties a node. `mount(node, children)` replaces a node's children.
- Produces (from `client/src/pool.js`): `loadPool()` → `Promise<{ registry, players }>` (fetched once, memoised). `poolFor(scope)` → the matching players (delegates to `scopePool` from the engine). `countFor(scope)` → number. `PRESETS` (from §3).
- Produces (from `client/src/store.js`): `store` object with `state` (`{ pool, registry, scope, quiz, roundIndex, theme, vibes }`), and actions `setScope(scope)`, `setTheme(name)`, `startQuiz({ scope, seed })` (calls `planQuiz` and stores the plan), `saveVibe(vibe)`, `loadVibes()`, `deleteVibe(id)`, `subscribe(fn)`.

**Steps:**

1. Write `client/src/ui.js` — the three helpers. `el` must set `textContent` (never `innerHTML`) for any user or data-derived string, so a player name with an apostrophe or a `<` cannot inject markup.
2. Write `client/src/pool.js` — `loadPool()` fetches `/data/fixtures/pool.sample.json` and returns `{ registry, players }`, memoised. `poolFor(scope)` calls `scopePool(scope, players)` from `/js/engine/index.js`. `countFor(scope)` returns `poolFor(scope).length`. Export `PRESETS`.
3. Write `client/src/store.js` — plain object + `subscribe`/`notify`. `startQuiz` calls `planQuiz({ scope, pool: state.pool.players, registry: state.pool.registry, seed, rounds: 10, difficulty: 'medium' })` and stores the returned plan. `saveVibe` writes `{ id, name, icon, clauses }` to `localStorage['football-trivia-vibes']`.
4. Write `tests/client/store.test.js` — hmm, the client has no unit-test harness (no jsdom). **Use Playwright instead**: a Playwright test that imports the store in the page context and asserts `countFor` matches `scopePool`. If a unit test is wanted, put the assertions in `tests/client/client.spec.js` using `page.evaluate` with a dynamic `import()`.
5. Run `npx playwright test` — Expected: passing.
6. Commit.

### Task 3: Router and `main.js`

**Files:**
- Create: `client/src/main.js`

**Interfaces:**
- Consumes: `client/src/store.js`, the screen modules
- Produces: `main.js` mounts the screen for the current hash. Hashes: `#home`, `#vibes`, `#lobby`, `#round`, `#reveal`, `#results`, `#credits`. `main.js` re-renders on `hashchange` and on every store notification.

**Steps:**

1. Write `main.js` — a `SCREENS` map from hash to a screen module (each exporting `render(root)`), a `render()` that clears `#app` and calls the current screen, `window.addEventListener('hashchange', render)`, and `store.subscribe(render)`.
   **Guard against re-entrancy:** a store notification during a render must not recurse — track a `rendering` flag.
   **Guard against a missing screen:** an unknown hash falls back to `#home` rather than throwing.
2. Write placeholder screen modules for all seven hashes so the router has something to mount (each returning an empty container for now). They get fleshed out in later tasks.
3. Add a Playwright test: navigating to `#round` directly (a deep link) renders the round screen's container rather than throwing.
4. Run `npx playwright test` — Expected: passing.
5. Commit.

### Task 4: Home and Credits

**Files:**
- Create: `client/src/screens/home.js`, `client/src/screens/credits.js`
- Create: `client/styles/screens/home.css`, `client/styles/screens/credits.css`

**Interfaces:**
- Consumes: `client/src/store.js`, `client/src/pool.js` (`PRESETS`), `client/src/ui.js`
- Produces: `home.js` exports `render(root)`. `credits.js` exports `render(root)`.

**Steps:**

1. Write `home.js` — a topbar with the wordmark and a theme toggle button (cycles Retro → Editorial → Retro). Then "Craft a vibe" as the primary action, a grid of preset vibe cards (each showing icon, name, description and the **live** pool count once the pool is loaded), and a "Your vibes" section listing saved vibes from the store with a play and a delete action. Tapping a vibe card sets the scope and navigates to `#lobby`.
2. Write `credits.js` — a list of the photo sources and licences (Wikimedia Commons, CC BY-SA 4.0 / CC0 / public domain), a note that the fixture is derived from the CC0 `dcaribou/transfermarkt-datasets` dump, and a link back to the source repository.
3. Add Playwright tests: the home screen shows the wordmark and at least one preset card; the theme toggle changes `document.documentElement.dataset.theme`.
4. Run `npx playwright test` — Expected: passing.
5. Commit.

### Task 5: The vibe crafter — `vibes.js`

This is the product's front door and the most important screen. It is a **fork-a-vibe** surface, not a query composer.

**Files:**
- Create: `client/src/screens/vibes.js`
- Create: `client/styles/screens/vibes.css`

**Interfaces:**
- Consumes: `client/src/store.js`, `client/src/pool.js`
- Produces: `vibes.js` exports `render(root)`.

**Steps:**

1. Write the screen. It shows the selected vibe's **name, description and live pool count**, then a set of **named moves**:
   - **Different era** — cycles the season range through the eras the pool actually has.
   - **Different competition** — swaps the league id.
   - **Add a club** — a select of the clubs present in the pool.
   - **Only these nations** — a select of nationalities present in the pool.
   - **A narrower stat** — a select of the stat presets (the `stats` predicate).

   Each move rebuilds the scope's clauses and re-renders **immediately** with the new pool count. The count is the feedback loop; it updates on every move.
2. **Refusal behaviour.** If a move would take the pool below 20, the move is shown but **disabled**, with the reason beneath it — *"only 49 players have La Liga data for 2005–09"*. It is never silently applied and the count is never padded.
3. **The save action.** A name field and a **"Make this ours"** button that saves to the store and returns to `#home`.
4. **Never show raw ids.** Every select option shows a display name. League ids, club ids and tournament ids are values in the select, never visible text.
5. Add Playwright tests:
   - picking a preset shows its name and a pool count of at least 1;
   - a move that empties the pool shows a refusal with a count, and the count never displays 0 as if it were valid;
   - the name field and the "Make this ours" button exist, and saving adds the vibe to the store.
6. Run `npx playwright test` — Expected: passing.
7. Commit.

### Task 6: Lobby, Round and Reveal

**Files:**
- Create: `client/src/screens/lobby.js`, `client/src/screens/round.js`, `client/src/screens/reveal.js`
- Create: `client/styles/screens/lobby.css`, `client/styles/screens/round.css`, `client/styles/screens/reveal.css`

**Interfaces:**
- Consumes: `client/src/store.js` (`store.state.quiz`, `store.state.roundIndex`), `client/src/pool.js`
- Produces: each screen exports `render(root)`.

**Steps:**

1. Write `lobby.js` — the room code (a generated six-character code, shown large and copyable), the vibe card (icon, name, pool count), the roster (the local player for now — **do not fake other players**; show a single row and say the room is yours until the multiplayer phase lands), the line *"A fresh quiz is written every time you play"*, and a **"Start the quiz"** button that calls `startQuiz` and navigates to `#round`.
2. Write `round.js` — the window banner (the scope's window label), the clue ladder (four steps showing ×5/×3/×2/×1, with the current step lit), the four clue cards (revealed one at a time as the round's reveal schedule elapses — drive it from the round's `revealSchedule` timestamps, not a fixed delay), the four options, and a timer that counts the round down. Tapping an option locks the answer, stops the timer, and navigates to `#reveal`.
   **The option list must be the engine's `round.options`** — do not reimplement or re-shuffle.
   **The clue cards must be the engine's `round.clues`.**
3. Write `reveal.js` — the collectible card: the player's photo, or the **jersey tile** when there is no photo (initials on a deterministic colour derived from the player id), the name, nationality · position, the club path, the window fact, then the points earned and the running leaderboard.
   **Never render a broken image.** If the player has no photo, render the tile.
4. Add Playwright tests:
   - start a quiz, confirm the round screen shows the clue ladder and four options;
   - tapping an option navigates to the reveal and shows the player's name;
   - a player with no photo shows the jersey tile (initials), not an `<img>` with a broken source;
   - the round works at 360px wide with no horizontal scroll (`document.documentElement.scrollWidth <= 360`).
5. Run `npx playwright test` — Expected: passing.
6. Commit.

### Task 7: Results

**Files:**
- Create: `client/src/screens/results.js`
- Create: `client/styles/screens/results.css`

**Interfaces:**
- Consumes: `client/src/store.js` (`store.state.quiz`), `client/src/store.js` (`saveVibe`)
- Produces: `results.js` exports `render(root)`.

**Steps:**

1. Write `results.js` — the final standings (the local player's score and the round-by-round recap), the **quiz recap** (the plan's summary: how many rounds, how many kinds of question, the hardest round), and the CTA **"Craft your own vibe"** linking to `#vibes`, plus a share button that copies a shareable text summary to the clipboard.
   **The recap is shown here and only here** — after the game. Never before.
2. Add Playwright tests: after finishing a quiz the results screen shows the standings and the recap line; the recap mentions more than one kind of question when the plan says so.
3. Run `npx playwright test` — Expected: passing.
4. Commit.

### Task 8: The end-to-end test and the polish pass

**Files:**
- Modify: `tests/client/client.spec.js`
- Modify: `client/styles/tokens.css`, `client/styles/app.css`

**Interfaces:**
- Consumes: everything above
- Produces: one Playwright spec that plays a whole game.

**Steps:**

1. Write the end-to-end spec: load the client → craft a vibe from a preset → start the quiz → play all ten rounds (tap the first option on each) → reach the results → assert the standings and the recap rendered. Assert no console errors were recorded during the whole run.
2. Add a test that the whole flow works in the **editorial** theme (toggle it, play one round) — the theme must not break any screen's layout.
3. **Polish pass.** Check, and fix:
   - every screen at 360px with no horizontal scroll;
   - focus-visible outlines on every interactive element;
   - `prefers-reduced-motion` disables the card flip and the confetti;
   - the theme toggle persists across a reload (`localStorage`);
   - a reload mid-round lands on a valid screen.
4. Run `npx playwright test` and `npm test` — Expected: both green.
5. Commit.

---

## 5. Definition of Done

- `npx playwright test` passes, including the full ten-round playthrough, at 390px and at 360px.
- `npm test` still passes (the engine and pipeline are untouched by this plan).
- No colour literal appears outside `client/styles/tokens.css`.
- No screen contains the words "scope", "predicate", "metric id" or a raw league/club id in its visible text.
- The round screen renders the engine's own clues and options without reimplementing either.
- A player with no photo renders a jersey tile, never a broken image.
- A scope below 20 players is refused with a reason and a count.
- The plan's shape appears on the results screen and nowhere else.
