# Football Trivia v1 — Design Specification

**Date:** 2026-10-20
**Status:** Approved for planning
**Supersedes:** `PROJECT_STATUS.md` (which describes a pipeline that does not exist)

---

## 1. Summary

A realtime multiplayer football trivia game for a friend group playing on their own phones. Players join a room with a short code, the host picks a **Scope** (a saved definition of which players are eligible), and everyone plays ten rounds of **Guess the Player** together — clues reveal in lockstep across every phone, each player locks in an answer when they dare, and a live leaderboard resolves the reveal.

The differentiator is the Scope. Instead of picking from a fixed quiz catalogue, a group defines its own pool — "La Liga 2010s", "our club plus the Prem", "South Americans in Europe" — and plays against it.

**v1 ships one game format.** That is the entire point: the Scope layer is the risky part of this product, so the format layer gets as little surface as possible to be excellent.

---

## 2. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Real free data only, zero fabrication** | The current dataset invents market values, caps, goals and shirt numbers for ~62% of players via a seeded RNG. A football fan spots a fake number instantly, and "no fabrication" is what makes the Scope layer worth anything. |
| D2 | **Realtime group play**, every player on their own phone | The pitch's thesis is the friend group. No host screen, no TV. |
| D3 | **Supabase** (Postgres + Realtime + Auth) | Managed, free at friend-group scale, and doubles as the data store. No socket server to operate. |
| D4 | **Guess the Player only** in v1 | Two of three current formats are broken; Higher/Lower is literally a game over invented numbers. One format, done excellently. |
| D5 | **Scope = union of clauses** | A scope is a disjunction of clauses; each clause is a conjunction of predicates. Makes "La Liga 2010s **OR** current PL" and "Spain **AND** Barça **AND** 2010s" both expressible. The current code intersects teams/nationalities on top of the union — the exact failure the pitch says it avoids. |
| D6 | **Presets + fork-a-preset in v1**; free-form composer is v2 | The pitch names setup friction as the #1 product risk. A blank composer is a form. Forking a preset is a draft. |
| D7 | **Retro Collectible theme (D) by default**, Premium Editorial (C) optional | Approved visually. Both ship as token swaps over identical markup. |
| D8 | **Server-timed clue reveals, player-chosen answer lock** | The only way to guarantee every phone shows the same clue at the same time without spoilers, while preserving the risk/reward gamble. |
| D9 | **Photos from Wikimedia Commons via Wikidata P18** | Only source that is free, legally clean, and unlimited enough (50 entities per HTTP call). |
| D10 | **Era floor 2010**, surfaced as a coverage warning | Pre-2010 coverage is ~50 players per league — real but too thin. The builder shows it; the scope is refused with a reason, never silently padded. |
| D11 | **All fabricated stats deleted outright** | Not flagged, not hidden behind a demo flag. Deleted, along with the RNG estimator and the hand-injected players. |

---

## 3. Scope of v1

### In
- Scope engine (clauses) + 6–8 presets + fork-a-preset
- Realtime room: create, join by code, lobby, 10 synchronized rounds, live leaderboard, final standings
- Guess the Player with 4 clue stages, MCQ answer, lock-in scoring
- Real player data with photos
- Shareable Scope links; shareable results artifact
- Retro Collectible theme (default) + Premium Editorial theme (optional)

### Out (v2+)
- Free-form Scope composer
- Higher/Lower, Criteria Grid
- Natural-language scope creation
- Identity cards / discovery mechanics
- Accounts beyond anonymous sessions + saved scopes
- Native apps, host screen / TV mode

---

## 4. Data layer

### 4.1 Sources

| Source | Provides | Limits | Licence |
|---|---|---|---|
| `dcaribou/transfermarkt-datasets` | **Spine.** 50,149 players, 175,165 transfers, 1,894,350 appearances, 650k+ market valuations, 88,958 games, 790 clubs, 65 competitions | Snapshot frozen at 2026-07-06; no 2026/27 squads | CC0-1.0 |
| Wikidata (`wbsearchentities`, `wbgetentities`, `wbgetclaims`) | Player QIDs, DOB/nationality/position corroboration, club stints for pre-1993 players (263k footballers) | Quality uneven; dates often year-precision | CC0-1.0 |
| Wikimedia Commons | Player photos + per-file licence/author | Coverage ~35% of our target pool; living-player photos often absent | CC0 / CC BY-SA 4.0 / PD — attribution required for CC BY-SA |
| openfootball (GitHub repos) | Club → league mapping for 1993–2012 | Static files, per-country | Free open repos |

**Explicitly excluded:** FBref / Sports Reference (ToS prohibits use without licence; Stats Perform terminated their feed in Jan 2026), Transfermarkt CDN photos (agency-licensed to TM), API-Football free tier (100 req/day), TheSportsDB (watermarked player images), EA FC datasets (ratings are game design, not facts).

**Legal note:** the Transfermarkt dump is published CC0 by its author, but Transfermarkt's own ToS prohibits scraping and TDM. This is acceptable for a private, non-commercial friend-group game and must be re-assessed before any public/commercial launch. The pipeline is built so the Wikidata-only path can still produce a playable pool if source #1 is withdrawn (see §9 risk R1).

### 4.2 Verified era depth

Measured directly from the dataset (union of `appearances` + `transfers`, after the quality gate):

| League | 2020–25 | 2015–19 | 2010–14 | 2005–09 | 1998–04 |
|---|---|---|---|---|---|
| Premier League | 1,983 | 1,598 | 995 | 71 | 7 |
| La Liga | 1,778 | 1,499 | 961 | 49 | 8 |
| Serie A | 1,933 | 1,520 | 1,031 | 51 | 3 |
| Ligue 1 | 1,985 | 1,613 | 996 | 52 | 4 |
| Bundesliga | 1,717 | 1,298 | 836 | 46 | 2 |

**~1,850 players for "La Liga 2010s".** The pre-2010 cliff is real and is where D10 comes from.

### 4.3 Postgres schema

```sql
create table sources (
  id text primary key,           -- 'tm_dump_2026-07-06', 'wikidata_2026-10', 'commons'
  licence text not null, url text, sha256 text, fetched_at timestamptz not null
);

create table players (
  id bigserial primary key,
  slug text unique not null,
  name text not null,
  date_of_birth date not null,
  citizenship text[] not null default '{}',
  position text not null check (position in ('Goalkeeper','Defender','Midfielder','Forward')),
  sub_position text,
  foot text,
  height_cm smallint,
  international_caps int,          -- null is legal; 0 is NOT a default
  international_goals int,
  highest_market_value_eur bigint,
  market_value_eur bigint,
  active boolean not null default false,
  quality jsonb not null default '{}'   -- {status, reasons[]}
);

create table photos (
  id text primary key,              -- sha256 of bytes
  player_id bigint references players(id) on delete cascade,
  storage_path text not null,       -- photos/{player_id}/{id}.webp
  width int, height int,
  licence text not null,            -- 'CC BY-SA 4.0' | 'CC0' | 'PD'
  attribution text,                 -- author string, rendered on /credits
  source_url text not null,         -- Commons file page
  source_id text references sources(id),
  is_primary boolean not null default false,
  fetched_at timestamptz not null
);
create unique index on photos (player_id) where is_primary;

create table players_sources (      -- every field traceable to a row
  player_id bigint references players(id) on delete cascade,
  source_id text references sources(id),
  source_key text not null,
  primary key (player_id, source_id)
);

create table leagues (
  id text primary key,             -- 'GB1','ES1','IT1','FR1','L1' (TM competition ids)
  name text not null,              -- source slug, e.g. 'premier-league'
  display_name text not null       -- 'Premier League', 'La Liga', ...
);
create table league_aliases (       -- kills "Serie A" vs "Série A"
  alias text primary key, league_id text references leagues(id)
);

create table clubs (
  id bigserial primary key, name text not null,   -- source form, e.g. 'FC Barcelona'
  country text, current_league_id text references leagues(id)
);
create table club_aliases (        -- 'Arsenal' -> 'Arsenal FC', 'Man Utd' -> 'Manchester United'
  alias text primary key, club_id bigint references clubs(id)
);

-- THE BACKBONE: membership as dated intervals, evidence-tagged
create table club_stints (
  player_id bigint references players(id) on delete cascade,
  club_id bigint references clubs(id),
  season_start smallint not null,   -- 2012 = 2012/13 (start year)
  season_end smallint not null,     -- inclusive
  evidence text not null check (evidence in ('appearance','transfer','wikidata','override')),
  source_id text references sources(id),
  primary key (player_id, club_id, season_start)
);

-- derived, rebuilt each ingest: what era scopes actually query
create table player_seasons (
  player_id bigint references players(id) on delete cascade,
  season smallint not null, club_id bigint references clubs(id),
  league_id text references leagues(id),   -- null = unknown, NOT guessed
  primary key (player_id, season, club_id)
);
create index on player_seasons (league_id, season, player_id);
create index on player_seasons (season, player_id);

create table market_value_history (
  player_id bigint references players(id) on delete cascade,
  recorded_on date not null, value_eur bigint not null,
  source_id text references sources(id),
  primary key (player_id, recorded_on)
);

create table overrides (            -- human adjudication only, applied LAST
  match_key text primary key,       -- normalised name
  player_id bigint references players(id),
  note text, decided_by text, decided_at timestamptz
);

create view player_pool as
  select * from players where active and quality->>'status' = 'pass';
```

Season key is the **start year** (2012 → "2012/13"), so it maps 1:1 onto the existing `seasons: [2012, 2013, …]` shape.

### 4.4 Quality gate

A player enters `player_pool` only if **all** hold:

| Rule | Threshold |
|---|---|
| G1 Identity | Exactly one source record after normalised-name match; if multiple candidates, DOB must select exactly one. Otherwise `ambiguous` → excluded. |
| G2 DOB | Non-null, between 1930-01-01 and today−16y. Disagreement between sources → `conflict` → excluded. |
| G3 Nationality | ≥1 citizenship resolvable to a known country code. |
| G4 Position | One of Goalkeeper / Defender / Midfielder / Forward. No `Unknown`. |
| G5 Club path | ≥1 `club_stints` row with both season bounds and real evidence. |
| G6 No season conflict | Two clubs claiming the same season → fail unless an override exists. |
| G7 Provenance | Every numeric carries a `source_id`. **Missing → `null`. `null` is legal. `0` as a default is not.** |
| G8 Photo | **Not required.** Jersey-tile fallback exists. |

Failing players stay in `players` with `quality.status='fail'` and `quality.reasons[]`, are excluded from every scope, and appear in the validation report. They are retried automatically on the next ingest when a second source fills the gap.

**Machine invention is forbidden. Human adjudication is allowed** — `overrides` resolves ambiguous names and conflicts with a cited source.

### 4.5 Hint capability gating

Hints are gated on availability, never defaulted:

```
nationality  ← citizenship
position     ← position
era          ← date_of_birth
clubs        ← club_stints
caps         ← international_caps IS NOT NULL
market_value ← market_value_eur IS NOT NULL
photo        ← photo_id          (else jersey tile)
```

Round targets are drawn from `scope ∩ player_pool WHERE every required hint is available`.

### 4.6 Ingestion pipeline

```
scripts/ingest/
  fetch.js       downloads each source to data/raw/{source}/{snapshot}/ and writes
                 manifest.json {url, sha256, bytes, fetched_at}; hash verified on re-runs
  load.js        raw → staging, one --source flag per run (tm | wikidata | photos)
  normalize.js   pure: league alias resolution, ISO-3166 citizenship, position enum,
                 season-bound clamping, name normalisation, dedupe, apply overrides.json LAST
  validate.js    quality gate + report; --strict exits non-zero on any ERROR
```

**Idempotent:** natural keys + `INSERT … ON CONFLICT DO UPDATE`; re-running against the same manifest produces zero diffs, asserted by `validate.js`. Raw files are immutable — corrections live only in `overrides.json`.

**Photo resolution chain:** Wikidata `wbsearchentities` (name → QID candidates, disambiguated by DOB + description) → `wbgetentities` with 50 QIDs per call → P18 image URL → Commons `imageinfo` for licence/author (50 titles per call) → download → resize to 512px WebP → Supabase Storage → `photos` row with licence + attribution + source URL. Fallback: deterministic jersey tile (`hsl(hash(player_id) % 36, 55%, 42%)` background, initials, position glyph) rendered by the same component that renders a real photo, so a missing image is a first-class card state rather than an error.

**Validation report blocks the ship** on: any `player_pool` player failing the gate; unresolved ambiguous/conflict names; DOB disagreement vs `gold_standard.json`; overlapping stints; unresolved league-alias collisions; any numeric without a `source_id`; any row traceable to the old RNG path; any advertised scope with pool < 20; pool drop >10% vs the previous run without an allowlist entry. Warns on per-field coverage %, name-match rate, photo coverage %, and prints an era-depth table per league.

**`data/gold_standard.json` stops being data and becomes a regression test** — assert exact DOB, club stints and caps for Messi, Ronaldo, Neymar, Salah, Haaland. Fails CI on silent drift.

---

## 5. Scope engine

### 5.1 Model

A scope is a **disjunction of clauses**. Each clause is a **conjunction of predicates**. Array predicates match if the player matches *any* element. Missing predicate = wildcard.

```json
{
  "v": 1,
  "id": "uuid",
  "name": "La Liga 2010s",
  "clauses": [
    { "leagues": ["ES1"], "seasonStart": 2010, "seasonEnd": 2019 }
  ],
  "createdAt": 1730000000000
}
```

Multi-blend:

```json
{
  "v": 1, "id": "uuid", "name": "Our mix",
  "clauses": [
    { "leagues": ["ES1"], "seasonStart": 2010, "seasonEnd": 2019 },
    { "leagues": ["GB1"], "seasonStart": 2024, "seasonEnd": 2025 }
  ]
}
```

**Scope clauses reference stable ids, never display names.** `leagues` holds competition ids (`ES1`, `GB1`, `IT1`, `FR1`, `L1`, `NL1`, `PO1`, `MLS1`, `SA1`); `teams` holds club ids. The client renders names from `leagues.display_name` and `clubs.name`. This matters because the source club names are *not* the names people type — the dataset has `Arsenal FC`, `Liverpool FC`, `FC Barcelona`, `Juventus FC`, and the current app's team picker searches for `Arsenal`, so it would never match a single row. `club_aliases` and `league_aliases` map what people type to the canonical ids.

### 5.2 Matching

```js
function seasonsOverlap(entrySeasons, start, end) {
  const lo = start ?? -Infinity, hi = end ?? Infinity;
  return (entrySeasons || []).some(s => s >= lo && s <= hi);
}

function clauseMatches(clause, player) {
  const L = clause.leagues?.length ? clause.leagues : null;
  const T = clause.teams?.length ? clause.teams : null;
  const N = clause.nationalities?.length ? clause.nationalities : null;
  const P = clause.positions?.length ? clause.positions : null;

  if (N && !N.includes(player.nationality)) return false;
  if (P && !P.includes(player.position)) return false;

  const needsEntry = L || T || clause.seasonStart != null || clause.seasonEnd != null;
  if (!needsEntry) return true;

  return (player.teams || []).some(e => {
    if (L && !L.includes(e.leagueId)) return false;
    if (T && !T.includes(e.clubId)) return false;
    return seasonsOverlap(e.seasons, clause.seasonStart, clause.seasonEnd);
  });
}

export function playerInScope(player, scope) {
  if (!scope || !Array.isArray(scope.clauses) || scope.clauses.length === 0) return true;
  return scope.clauses.some(c => clauseMatches(c, player));
}
```

This runs identically in SQL (as a view/query) and in the browser (for instant preview). One definition, two implementations, kept in step by a shared fixture test.

### 5.3 Sharing

UTF-8-safe base64url — the current `btoa(JSON.stringify(...))` throws on `Ç`:

```js
function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromBase64Url(tok) {
  const pad = tok.length % 4 ? '='.repeat(4 - (tok.length % 4)) : '';
  const bin = atob(tok.replace(/-/g,'+').replace(/_/g,'/') + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
```

Link format: `https://<host>/#scope=<base64url-token>`. The token carries only the definition (name + clauses) — never player rows — so the receiver evaluates against their own data. Limits: token ≤ 1800 chars, name ≤ 60, ≤ 8 clauses, ≤ 20 items per array. Over-limit → refuse with a message.

Receiver sees a read-only card: scope name, pool size, sample player names, and **Play now** / **Fork** / **Save**.

### 5.4 Presets

| Preset | Clauses | Pool |
|---|---|---|
| La Liga 2010s | `{leagues:["ES1"], seasonStart:2010, seasonEnd:2019}` | ~1,854 |
| Premier League 2010s | `{leagues:["GB1"], seasonStart:2010, seasonEnd:2019}` | ~1,924 |
| Premier League 2024/25 | `{leagues:["GB1"], seasonStart:2024, seasonEnd:2025}` | ~1,983 |
| El Clásico Derby Night | `{leagues:["ES1"], seasonStart:2008, seasonEnd:2018, teams:[<id:FC Barcelona>, <id:Real Madrid>]}` | computed at ingest |
| South Americans in Europe | `{nationalities:["Argentina","Brazil","Uruguay","Colombia"], leagues:["GB1","ES1","IT1","FR1","L1"], seasonStart:2015, seasonEnd:2025}` | computed at ingest |
| New-Money Leagues | `{leagues:["SA1","MLS1"], seasonStart:2023, seasonEnd:2025}` | computed at ingest |

The three uncounted pools are measured by `validate.js` at ingest and their numbers are written into the preset definitions rather than guessed here. Club ids are resolved at ingest by name lookup, so a preset never hardcodes a club name string.

**Note:** the source dataset contains no Atlético Madrid club row, so no preset may reference it. Presets are limited to clubs that exist in the data.

### 5.5 Era floor handling

The builder's era slider spans the real data range. As the user drags, the live pool count updates and **low-coverage eras are flagged**: any window whose pool falls below 20 players shows a warning — *"only 49 players have La Liga data for 2005–09"*. Saving such a scope is refused with that reason. The slider is **not** hard-clamped — hiding the cliff would misrepresent what the data contains.

---

## 6. Game engine

Pure, DOM-free, unit-tested modules under `js/engine/`. The server must be able to validate a submitted answer, so answer validation and scoring cannot live only in the browser.

### 6.1 Round structure

**20 seconds.** Four clue stages, auto-revealed by the server on an absolute schedule.

| t | Event |
|---|---|
| 0–2s | Setup. Scope name, round number. Answer inputs disabled. |
| 2–7s | **Clue 1** revealed. Multiplier ×5. |
| 7–12s | **Clue 2** revealed. Multiplier ×3. |
| 12–17s | **Clue 3** revealed. Multiplier ×2. |
| 17–20s | **Clue 4** revealed. Multiplier ×1. |
| 20s | **Snap.** All inputs lock. Server reveals the answer and resolves the round. |

Clue set is chosen per target from the capabilities the player actually has (§4.5), ordered **hardest first** — nationality and position last, because they narrow the pool fastest.

### 6.2 Answer input

**MCQ, 4 options, one correct.** Free-text is rejected for v1: typing "Calhanoğlu" on a phone under time pressure is a typo generator, and fuzzy matching adds a correctness surface that has nothing to do with football knowledge.

The 25% baseline is not a coinflip problem because the distractors are **thematic**: same nationality, same position, overlapping era. A guesser who does not know the player should be genuinely uncertain.

One shot. Answering locks the round for that player.

### 6.3 Scoring

```
multiplier = { 1: 5, 2: 3, 3: 2, 4: 1 }[stage at which the answer was locked]
timeFactor = 1.5 → 1.0, sliding linearly across the round (1.5s → 20s)
points     = correct ? round(1000 * multiplier * timeFactor) : 0
```

Max per round = 1000 × 5 × 1.5 = **7,500**. Max per game = 75,000.

Leaderboard order: total points → correct count → lowest total response time → earliest join.

### 6.4 Distractor selection

Candidates are ranked by similarity to the target: shared position (+3), shared nationality (+3), shared club (+4), shared league (+2). The top-ranked pool is sampled with a small randomness budget so the same target does not produce an identical option set every game.

**Constraint:** the answer must never be inferable from the option set itself — i.e. if exactly one option is Turkish *and* a midfielder *and* has a La Liga stint, that option is the answer by elimination. The generator must verify that no distractor shares the *full* conjunction of revealed clues, and regenerate if it does.

---

## 7. Multiplayer

### 7.1 Schema

```sql
create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,               -- 6-char join code
  creator_id uuid not null references auth.users(id),
  scope_id uuid references game_scopes(id),
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  status text not null check (status in ('lobby','round_active','round_ended','final','abandoned')),
  max_players int not null default 12,
  current_round int not null default 0,
  total_rounds int not null default 10,
  round_started_at timestamptz,
  deadline_at timestamptz,
  finished_at timestamptz,
  winner_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on rooms (code); create index on rooms (creator_id);

create table room_memberships (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,              -- deliberately NOT unique
  is_host boolean not null default false,
  is_ready boolean not null default false,
  connection_status text not null default 'online',
  last_seen_at timestamptz not null default now(),
  total_score int not null default 0,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table game_scopes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  clauses jsonb not null,
  player_count int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  target_player_id bigint not null references players(id),   -- THE ANSWER, never sent to clients
  clue_order jsonb not null,             -- [{id,label,value,iconKey}] in reveal order
  reveal_schedule jsonb not null,        -- [{stage, reveal_at}] absolute timestamptz
  status text not null default 'pending' check (status in ('pending','active','closed')),
  started_at timestamptz, closed_at timestamptz,
  unique (room_id, round_number)
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  guessed_player_name text not null,
  is_correct boolean not null,            -- server-computed
  stage_locked int not null,              -- server-computed
  response_time_ms int not null,          -- server-computed
  points_earned int not null,             -- server-computed
  received_at timestamptz not null default now(),   -- server clock, authoritative
  unique (round_id, user_id)
);
```

**RLS intent:**
- `rooms` — SELECT: creator or member. INSERT: authenticated. UPDATE: only via a `SECURITY DEFINER` RPC (the state machine must not be forgeable by clients). DELETE: creator.
- `room_memberships` — SELECT: same-room members. INSERT: `auth.uid() = user_id` and room is in `lobby` and not full. UPDATE: own row only. DELETE: own row or creator.
- `rounds` — SELECT: room members. INSERT/UPDATE: **server only** (service_role). Clients can never write the answer key.
- `answers` — SELECT: room members. INSERT: `auth.uid() = user_id`, guarded by an `is_round_open` RPC. No UPDATE ever.

### 7.2 State machine

```
lobby ──start──> round_active ──all answered | deadline──> round_ended
                  round_ended ──advance──> round_active (rounds 1..9)
                  round_ended ──advance──> final (round 10)
  any ──empty 5 min / explicit──> abandoned
```

Illegal transitions are rejected at the RPC/CHECK layer: lobby→final, round_active→final, round_ended→lobby, final→anything, join while status ≠ lobby, answer when status ≠ round_active, double answer in a round, start/advance by a non-host.

### 7.3 Synchronisation

**Invariant:** at every wall-clock instant, all connected clients in a room render the identical set of revealed clues, and no client learns `target_player_id` before the round resolves.

The server is the clock and the authority. Per round it generates the target from the scope pool, the clue order, and `reveal_schedule` (absolute `reveal_at` timestamps). At each `reveal_at` it broadcasts `clue:revealed`. Clients schedule against absolute timestamps and render immediately if already past, which absorbs clock drift.

**Reconnect:** client re-auths the channel and calls `sync_room_state(room_id)`. The server returns status, current round, `round_started_at`, `deadline_at`, `clue_order`, `reveal_schedule`, which stages are revealed *now* (computed server-side), the player's own prior answer if any, and the running leaderboard. The target is never included. The player can still answer if the round is open.

**Late join:** rejected — joins are allowed only in `lobby`. A latecomer sees "game in progress — join the next room". Simplicity and spoiler-safety over mid-game entry; the round waits for nobody.

### 7.4 Failure modes

| Failure | Handling |
|---|---|
| Host leaves mid-game | The server is the clock, so rounds continue. Host role auto-transfers to the longest-tenured online member and `host:transferred` is broadcast. Room is `abandoned` after 5 empty minutes. |
| Two players share a display name | `display_name` is deliberately not unique. Internally players are keyed by `user_id`; the client disambiguates the leaderboard by join order (`Alex`, `Alex #2`). Zero join friction. |
| Answer after the round closed | Server rejects on `closed_at IS NOT NULL OR now() > deadline_at`; no row is written. A packet in flight before close but arriving after is treated as late — fair, since the server clock is authoritative. |
| Phone sleeps / backgrounds | iOS suspends timers and drops the socket. The server marks the membership offline after missed heartbeats. On wake (`visibilitychange`) the client reconnects, calls `sync_room_state`, and resumes rendering; it can still answer if the round is open. Any answer sent before sleep is durable server-side. No pause for one phone — missed rounds score 0. |
| Network partition | The client buffers the answer and retries on reconnect; the unique constraint makes retries idempotent. If the round closed meanwhile, the retry is refused — correct. If Supabase Realtime is degraded, clients fall back to polling a REST sync endpoint until it recovers, then converge. |

**Message volume:** ≈240 channel deliveries per round for 12 players (1 round-start + 6 clue reveals + ≤12 answer acks + 1 round-end + heartbeats). Trivial for Supabase Realtime. At scale, drop per-answer acks to sender-only and publish an aggregate "answered count".

---

## 8. Client

### 8.1 Screens

| Screen | Purpose |
|---|---|
| Home | Play a preset, resume a saved scope, create a room |
| Lobby | Room code, scope card, roster, start |
| Round | Clue ladder, clue cards, live avatar strip, 4 options, timer, rank |
| Reveal | Collectible card with photo, your points, resolved leaderboard |
| Results | Final standings, "make your own Scope" CTA, share |
| Scope builder | Preset + fork, era slider with coverage warning, live pool count |
| Credits | Photo attributions (CC BY-SA compliance) |

### 8.2 Theme tokens

One `<div data-theme="retro|editorial">` wrapper. ~30 CSS custom properties. **`border-radius` and `box-shadow` are tokens**, not literals — D's chunky `14px` radius + `0 3px 0` hard shadow and C's `2px` radius + hairline border are what make them feel like different objects, not a palette swap.

Default theme (Retro Collectible):

| Token | Value |
|---|---|
| `--bg` | `#F6ECD6` (cream, halftone dot overlay) |
| `--ink` | `#2B2119` |
| `--gold` | `#B8860B` |
| `--red` | `#C0392B` |
| `--win` | `#1F5D3A` |
| `--highlight` | `#FFE9A8` |
| `--radius` | `14px` |
| `--shadow` | `0 3px 0 var(--ink)` (hard offset, no blur) |
| `--border` | `2px solid var(--ink)` |
| `--display` | Fredoka |
| `--body` | Inter |

Optional theme (Premium Editorial): `--bg #FAF8F3`, `--ink #17130F`, `--accent #C8102E`, `--radius 2px`, `--shadow 0 1px 0`, `--border 1px solid #E4DED2`, `--display 'Playfair Display'`, `--body Inter`.

**Explicitly not shipping in any theme:** pure `#000` backgrounds, all-caps shouting CTAs, `clip-path` skew on primary buttons, emoji as icons (proper SVG, as `assets.js` already started), any layout that breaks at 360px.

### 8.3 Key UI elements

- **Clue ladder** — four steps (×5 ×3 ×2 ×1) lighting up as stages reveal. Makes the scoring rule legible before the player commits.
- **Live avatar strip** — filled = locked in, hollow = thinking. This is the tension engine and the reason a phone screen feels social.
- **Collectible reveal card** — tilted, gold-foil gradient, real photo (initials = jersey-tile fallback), name, nationality · position, club path.
- **Jersey tile** — deterministic fallback avatar, also used for lobby/leaderboard avatars.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The Transfermarkt dump could vanish (publisher paused updates 2026-07-06) or be challenged on ToS grounds | Vendor the snapshot today — download once, record sha256 in `manifest.json`, commit it. Keep the Wikidata-only load path able to produce a playable pool on its own. Re-assess licensing before any public launch. |
| R2 | Era/league accuracy is thinner than it looks — ~50 players/league pre-2010, 20/310 name conflicts, ambiguous names | The capability report is a product feature: the builder shows pool size per era and refuses <20 with a reason. `overrides.json` resolves conflicts by hand. Never guess a league. |
| R3 | Fabrication regression — the old RNG script still exists and `server.js` still serves the hand-editable `players.json` | Delete the RNG branch in the same commit that switches `server.js` to the pool export. CI check: every numeric in published data must resolve to a `players_sources` row. |
| R4 | Setup friction — most groups pick "play everything" | Ship presets + fork. Measure: if presets get used but nobody forks, the composer is unnecessary. |
| R5 | Empty-room cold start — nobody joins, so a session yields no signal | The cheapest falsification test (§10) runs before multiplayer work, not after. |
| R6 | Photo coverage gaps and CC BY-SA attribution burden | Jersey tile is a first-class card state, not an error. One credits screen satisfies attribution. |

---

## 10. Build order and the falsification test

The implementation plan covers **Phase 1 (data spine) and Phase 2 (game engine) only**. Later phases get their own plans once the earlier ones are running — the client shell and the room are both cheaper to plan against a real engine than against a spec.

### Phase 0 — the falsification test (before any of this code)

**Run the manual Wizard-of-Oz test the pitch names and then skips.** One static HTML page, one scope ("La Liga 2010s"), 10 hand-picked **real** players from the dataset, no backend, no auth, no images. Play it with 6–10 friends. Then post it in one football Discord or subreddit.

**Pre-committed kill criteria** (decide before, not after):
1. <50% of the group finish the 10 rounds.
2. **No unprompted return within a week.** This is the "build once, replay ten times" hypothesis — the single most important number in the project.
3. Offered both a personalised scope and generic trivia, the group prefers generic or says the personalised one wasn't better.
4. Nobody asks for their own scope.

If (2) and (4) both fail after two sessions, stop and re-think the product.

This also independently measures the data gap: if a hand-picked 20-player list is the only thing that works, the data pipeline is the priority.

### Phase 1 — Data spine
`scripts/ingest/*` → Postgres. `player_pool` view. Quality gate. Validation report green. `gold_standard.json` as a regression test. Photos ingested via the Commons chain.

### Phase 2 — Game engine
`js/engine/` — pure modules: scope matcher, clue generator, distractor generator, scoring, round state machine. Unit-tested, no DOM. Same code runs in the browser and in server-side validation.

### Phase 3 — Client shell
Mobile-first PWA, Retro Collectible theme + Premium Editorial theme, four screens wired to the engine with fake data, accessibility pass (contrast, focus, reduced-motion).

### Phase 4 — Multiplayer room
Supabase schema + RLS + RPCs, room lifecycle, Realtime channels, sync, leaderboard, failure-mode handling.

### Phase 5 — Scope builder
Presets + fork + era slider with coverage warning + live pool preview + share links.

### Phase 6 — Polish
Sound, haptics, motion, credits screen, empty/error states, PWA install.

---

## 11. Testing

| Layer | Approach |
|---|---|
| Scope matcher | Pure-function unit tests + a shared fixture run against both the JS and SQL implementations so they cannot drift |
| Clue generation | Property tests: every clue value is non-null, comes from a real source row, and no two stages leak the same fact |
| Distractors | Property test: no distractor matches the full conjunction of revealed clues; the answer is never uniquely determined by the option set |
| Scoring | Table-driven unit tests for stage × time factor, including the boundary at exactly 20s |
| Room state machine | Exhaustive transition table test — every legal and illegal transition asserted |
| RLS | Integration test per table per role: anon, non-member, member, host, service_role |
| Sync | Multi-client integration test: two browsers, one simulated 5s disconnect, assert both converge to the same revealed set |
| Data | `validate.js --strict` in CI + `gold_standard.json` regression assertions |
| End-to-end | Playwright: create room → 3 players join → 2 rounds played → leaderboard asserted → scope saved and shared |

---

## 12. What gets deleted

| Path | Reason |
|---|---|
| `scripts/enrich-player-stats.js` | The RNG estimator and the 82 hand-injected players. Deleted, not flagged. |
| `data/players.json` | Hand-editable and partly fabricated. Replaced by the Postgres pool export. |
| `data/football.db` + `scripts/import-datasets.js` | A pipeline that cannot run (`data/raw` does not exist, `csv-parse` is not installed) and is superseded by the Postgres ingestion. |
| `data/gold_standard.json` | Becomes a test fixture, not a dataset. |
| `js/games/higher-lower-game.js`, `js/games/criteria-grid-game.js` | Broken, and out of v1 scope. Preserved in git history. |
| `js/app.js` (958 lines) | Replaced by the engine + client split. |
| `js/guess-player.js`, `js/criteria-grid.js` | Already deleted in the working tree; superseded. |
| `css/styles.css` | Replaced by token-driven themes. |
| `gameplay_test.cjs`, `test_game.cjs`, `test_modal.cjs`, `test_console.cjs`, `check_syntax.js` | Ad-hoc scripts superseded by the Playwright suite. |
