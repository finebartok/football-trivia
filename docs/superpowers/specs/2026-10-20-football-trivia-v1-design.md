# Football Trivia v1 — Design Specification

**Date:** 2026-10-20
**Status:** Approved for planning
**Supersedes:** `PROJECT_STATUS.md` (which describes a pipeline that does not exist)

---

## 1. Summary

A realtime multiplayer football trivia game for a friend group playing on their own phones. Players join a room with a short code, the host picks a **Scope** — the lens the quiz is seen through — and everyone plays ten rounds of **Guess the Player** together.

**The whole product is two things.**

**Pillar 1 — the user crafts the vibe.** Not a quiz from a catalogue: a season, a tournament, an era, a competition, a club, a nationality, a vibe. *"Our kind of football."* The Scope is that choice, and it is reusable, shareable and forkable.

**Pillar 2 — the engine generates the quiz.** This is the product. The engine does not filter a database and dress the rows up. Given a vibe, it *composes* a ten-round quiz: it decides which players are worth asking about, which facts about them are interesting and discriminable, how to word each question, which distractors would be genuinely tempting, and in what order the rounds should run. Two people playing the same vibe get different quizzes, and the quiz is different again next week.

**The engine is under the hood.** The player crafts a vibe and then plays. They never see a query, a plan, a metric list, or a summary of what the quiz contains. What the engine decided is discovered by playing it.

Pillar 1 without pillar 2 is a database with a filter. Pillar 2 without pillar 1 is the same generated quiz for everyone. The product is the intersection.

**v1 ships one game format.** The Scope layer and the generation layer are the risky parts of this product, so the format layer gets as little surface as possible to be excellent.

### 1.1 The shape of the system

```
Scope  ──────────────►  Quiz Plan  ──────────────►  Rounds  ──────────────►  Game
(what lens?)            (what will we ask?)          (composed Q + hints)     (played live)
  ↑                          ↑                          ↑                      ↑
user picks it            engine decides             engine writes it       server runs it
```

Each arrow is a separate, testable component. The user touches only the first and the last.

---

## 2. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Real free data only, zero fabrication** | The current dataset invents market values, caps, goals and shirt numbers for ~62% of players via a seeded RNG. A football fan spots a fake number instantly, and "no fabrication" is what makes the Scope layer worth anything. |
| D2 | **Realtime group play**, every player on their own phone | The pitch's thesis is the friend group. No host screen, no TV. |
| D3 | **Supabase** (Postgres + Realtime + Auth) | Managed, free at friend-group scale, and doubles as the data store. No socket server to operate. |
| D4 | **Guess the Player only** in v1 | Two of three current formats are broken; Higher/Lower is literally a game over invented numbers. One format, done excellently. |
| D5 | **Scope = union of clauses** | A scope is a disjunction of clauses; each clause is a conjunction of predicates. Makes "La Liga 2010s **OR** current PL" and "Spain **AND** Barça **AND** 2010s" both expressible. The current code intersects teams/nationalities on top of the union — the exact failure the pitch says it avoids. |
| D6 | **Vibes + "make this ours" in v1**; free-form composer is v2 | The pitch names setup friction as the #1 product risk. A blank composer is a form. Forking a vibe is a draft. |
| D7 | **Retro Collectible theme (D) by default**, Premium Editorial (C) optional | Approved visually. Both ship as token swaps over identical markup. |
| D8 | **Server-timed clue reveals, player-chosen answer lock** | The only way to guarantee every phone shows the same clue at the same time without spoilers, while preserving the risk/reward gamble. |
| D9 | **Photos from Wikimedia Commons via Wikidata P18** | Only source that is free, legally clean, and unlimited enough (50 entities per HTTP call). |
| D10 | **Era floor 2010**, surfaced as a coverage warning | Pre-2010 coverage is ~50 players per league — real but too thin. The builder shows it; the scope is refused with a reason, never silently padded. |
| D11 | **All fabricated stats deleted outright** | Not flagged, not hidden behind a demo flag. Deleted, along with the RNG estimator and the hand-injected players. |
| D12 | **Scopes can filter on statistics and tournament rosters, not just categorical metadata** | "La Liga 2010s" is only half the personalization. "World Cup 2022", "50+ goals after turning 30", "100+ caps" are scopes too, and they are the ones that feel bespoke. |
| D13 | **Every stat metric declares its window, and the clue states it** | Club goals and appearances are only real from 2012 in any free source. "50+ goals aged 30+ (since 2012)" is true; "50+ goals aged 30+" is a lie. This is the rule that stops the project re-creating the fabricated-stats bug. |
| D14 | **Three question templates, one round structure** | Variety comes from the template, not from rewriting the engine. T1 identify (names), T2 stat value (numbers), T3 membership (who was in the pool). |
| D15 | **A Scope defines a pool *and* a window context** | A Scope is not a filter over a table — it is a pool plus the lens the questions are asked through. "La Liga 2010s" is a pool of players *and* the 2010–19 season window. "World Cup 2022" is a pool *and* a tournament window. The scope's clauses decide **who**; the window decides **from when**. |
| D16 | **Questions are composed, never raw rows** | Every question is generated from a (metric, window, subject) triple by a phrasing registry. The player is a subject, not a record dump: "How many goals did he score for Real Madrid in 2014-15?", never "goals_rma_2014_15: 61". |
| D17 | **Windowed stats are exact where the source is exact** | `game_events` yields true all-competition club-season totals — derived Ronaldo 61, Messi 60, Suárez 59, Lewandowski 55, all matching the real records. Windowed does not have to mean approximate; it means *scoped*. |
| D18 | **The engine is under the hood** | The player's verb is **"craft the vibe"**. They never see a query, a plan, a metric list, or a summary of what the quiz contains. What the engine decided is discovered by playing it — a preview gives the quiz away, and the surprise is what makes a group ask for round 4. |

---

## 3. Scope of v1

### In
- Scope engine (clauses) with **categorical + statistical + tournament predicates** + 8–11 presets + fork-a-preset
- Realtime room: create, join by code, lobby, 10 synchronized rounds, live leaderboard, final standings
- Guess the Player with 4 clue stages, MCQ answer, lock-in scoring
- **T1 `identify` template** (names)
- Real player data with photos, real stat metrics with declared windows, real tournament rosters
- Shareable Scope links; shareable results artifact
- Retro Collectible theme (default) + Premium Editorial theme (optional)

### Out (v1.1 / v2+)
- **T2 `stat_value`** (numeric answers) and **T3 `membership`** — spec'd in §6.5, built after T1 proves out
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
| `dcaribou/transfermarkt-datasets` | **Spine.** 50,149 players, 175,165 transfers, 1,894,350 appearances, **1,274,468 game events (247,803 goals, 381,752 cards, 631,339 substitutions)**, 650k+ market valuations, 88,958 games, 790 clubs, 65 competitions | Snapshot frozen at 2026-07-06; no 2026/27 squads | CC0-1.0 |
| Wikidata (`wbsearchentities`, `wbgetentities`, `wbgetclaims`, SPARQL) | Player QIDs, DOB/nationality/position corroboration, club stints for pre-1993 players (263k footballers), **tournament rosters** (WC2022 ≈ 231 players via `P1344` + date-qualified `P54`) | Quality uneven; dates often year-precision; WDQS rate-limits to ~1 req/min during outages — batch aggressively | CC0-1.0 |
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

-- Statistical predicates a Scope can filter on (see §4.7)
create table player_derived_stats (
  player_id bigint references players(id) on delete cascade,
  metric text not null,             -- 'goals_after_age_30', 'club_goals', 'international_caps', ...
  value numeric not null,
  window_start smallint,            -- null = exact career value
  window_end smallint,
  exact boolean not null,           -- true = career-true, false = windowed
  source_id text references sources(id),
  primary key (player_id, metric)
);
create index on player_derived_stats (metric, value);

-- Tournament roster membership (see §5.6)
create table tournaments (
  id text primary key,              -- 'wc-2022', 'euro-2024', 'copa-2024', 'wc-2026'
  name text not null,
  year smallint not null,
  display_name text not null
);
create table player_tournaments (
  player_id bigint references players(id) on delete cascade,
  tournament_id text not null references tournaments(id),
  team_name text,
  source_id text references sources(id),
  primary key (player_id, tournament_id)
);
create index on player_tournaments (tournament_id);

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
  load.js        raw → staging, one --source flag per run
                 (tm | wikidata | wikidata_tournaments | photos)
  normalize.js   pure: league alias resolution, ISO-3166 citizenship, position enum,
                 season-bound clamping, name normalisation, dedupe, apply overrides.json LAST
  derive.js      pure: player_seasons from stints, player_derived_stats from
                 appearances+games, club_path, career span — every metric stamped
                 with its window and `exact` flag
  validate.js    quality gate + report; --strict exits non-zero on any ERROR
```

**Idempotent:** natural keys + `INSERT … ON CONFLICT DO UPDATE`; re-running against the same manifest produces zero diffs, asserted by `validate.js`. Raw files are immutable — corrections live only in `overrides.json`.

`derive.js` is a **pure function of staged data**, which is what makes the windowing rule enforceable: a derived metric cannot exist without a window and an `exact` flag, because there is no code path that produces one without the other.

**Photo resolution chain:** Wikidata `wbsearchentities` (name → QID candidates, disambiguated by DOB + description) → `wbgetentities` with 50 QIDs per call → P18 image URL → Commons `imageinfo` for licence/author (50 titles per call) → download → resize to 512px WebP → Supabase Storage → `photos` row with licence + attribution + source URL. Fallback: deterministic jersey tile (`hsl(hash(player_id) % 36, 55%, 42%)` background, initials, position glyph) rendered by the same component that renders a real photo, so a missing image is a first-class card state rather than an error.

**Validation report blocks the ship** on: any `player_pool` player failing the gate; unresolved ambiguous/conflict names; DOB disagreement vs `gold_standard.json`; overlapping stints; unresolved league-alias collisions; any numeric without a `source_id`; any row traceable to the old RNG path; any advertised scope with pool < 20; pool drop >10% vs the previous run without an allowlist entry. Warns on per-field coverage %, name-match rate, photo coverage %, and prints an era-depth table per league.

**`data/gold_standard.json` stops being data and becomes a regression test** — assert exact DOB, club stints and caps for Messi, Ronaldo, Neymar, Salah, Haaland. Fails CI on silent drift.

### 4.7 Stat metrics and the windowing rule

A Scope can filter on numbers (D12). That only stays honest if every number knows where it came from.

**Metrics are either EXACT or WINDOWED, and the distinction is carried in the data, not in the UI's memory.**

| Metric | Type | Window | Measured coverage |
|---|---|---|---|
| `international_caps` | EXACT | career | 16,946 players with caps > 0; 1,023 with ≥ 50 |
| `international_goals` | EXACT | career | from `players.international_goals` |
| `highest_market_value_eur` | EXACT | career peak | 97% of gate-passers have a value |
| `age`, `nationality`, `position` | EXACT | — | required by the gate |
| `club_goals` | WINDOWED | 2012+ | 7 players ≥ 300; 160 ≥ 100; 712 ≥ 50 |
| `club_appearances` | WINDOWED | 2012+ | 13,666 players have appearances but 0 goals — the distractor pool |
| `goals_after_age_30` | WINDOWED | 2012+ | 23 players ≥ 100; 111 ≥ 50; 285 ≥ 30; 1,085 ≥ 10 |
| `tournament_goals` / `tournament_apps` | WINDOWED | per tournament | 200 goals recorded across 2,251 World Cup appearances |

**The rule:** a WINDOWED metric's clue text always states its window.

> ✓ "50+ goals aged 30+ (since 2012)"
> ✗ "50+ goals aged 30+"

> ✓ "80+ international caps"
> ✗ "80+ caps since 2012"  ← caps are exact; adding a window is wrong in the other direction

`player_derived_stats.exact` carries the flag, and the clue generator reads it. A metric may not be surfaced unless its window is known — there is no "unknown window" rendering.

**Threshold sanity:** "200 goals after turning 30" is **not reachable** — only 3 players clear it in the 2012+ window (max 333). Any scope threshold whose pool falls below 20 is refused with a reason (§5.5). The preset family is built around bands that hold: 30+ (285), 50+ (111), 100+ (23 — too thin, so it is not a preset).

**Why this matters more than it looks:** the original project shipped a clue reading `"Domestic Title Winner"` for 268 of 346 players who had won no domestic title. Unlabelled numbers are how that happened. The windowing rule is the structural fix, not a copy edit.

### 4.8 Windows — the lens questions are asked through

A **window** is a named, bounded slice of a player's career. It is the difference between "he scored 61 goals" and "he scored **61 goals for Real Madrid in 2014-15**".

```sql
create table windows (
  id text primary key,          -- 'wc-2022', 'rma-2014-15', 'la-liga-2010-2019', 'career'
  kind text not null check (kind in
    ('career','season','season_range','tournament','club_stint','age_band')),
  label text not null,          -- '2022 World Cup', 'Real Madrid 2014-15'
  detail text,                  -- '61 goals', 'the 2021-22 season'
  season_start smallint, season_end smallint,
  tournament_id text references tournaments(id),
  club_id bigint references clubs(id),
  team_name text,
  age_from smallint, age_to smallint
);

create table player_window_stats (
  player_id bigint references players(id) on delete cascade,
  window_id text not null references windows(id),
  metric text not null,         -- 'goals', 'appearances', 'goals_aged_30', 'clean_sheets'
  value numeric not null,
  exact boolean not null,
  source_id text references sources(id),
  primary key (player_id, window_id, metric)
);
```

`player_derived_stats` (§4.7) is the career-window case of this table; the two are unified so a stat is always *some* window, and the window is always named.

**Window kinds and what backs each:**

| Kind | Example window | Backed by | Exactness |
|---|---|---|---|
| `career` | his whole career | `players` + `player_valuations` | exact |
| `season` | Real Madrid 2014-15 | `game_events` × `games` | **exact** (all competitions) |
| `season_range` | La Liga 2010-19 | `game_events` + `appearances` | exact within the window |
| `tournament` | 2022 World Cup | `game_events` × `games` | exact |
| `club_stint` | Sevilla 2014-16 | transfers + events | exact within the stint |
| `age_band` | goals aged 30+ | events + DOB | exact within the window |

**Verified against the real record** (derived from `game_events`, all competitions):

| Player | Window | Derived | Actual |
|---|---|---|---|
| Cristiano Ronaldo | Real Madrid 2014-15 | 61 | 61 |
| Lionel Messi | Barcelona 2012-13 | 60 | 60 |
| Luis Suárez | Barcelona 2015-16 | 59 | 59 |
| Robert Lewandowski | Bayern 2019-20 | 55 | 55 |
| Lionel Messi | 2022 World Cup | 7 | 7 |
| Olivier Giroud | 2022 World Cup | 4 | 4 |

**Windowed does not have to mean approximate.** It means *scoped* — and a scoped number is still true.

**Where the window's start comes from.** A window is never invented: it is derived from the scope's clauses, from a club stint, from a tournament roster, or from an age band. A window with no source is not created. `game_events` covers goal events from 2006 (World Cups) and club seasons from 2012/13; a window outside those bounds is not offered.

**The scope-to-window mapping** — how clauses turn into a lens:

| Scope clause | Window it implies |
|---|---|
| `tournaments: ["wc-2022"]` | `tournament:wc-2022` — pool = that squad |
| `leagues: ["ES1"], seasonStart: 2010, seasonEnd: 2019` | `season_range:ES1:2010-2019` |
| `teams: [<id>]` | `club_stint:<id>` (or the union over the player's stints at that club) |
| `stats: [{goals_after_age_30 >= 50}]` | `age_band:30+` |
| nothing | `career` |

A scope may also carry an explicit `window` override, which is what the composer produces when it wants to ask a question about a specific season inside a broader pool.

---

## 5. Scope engine

### 5.1 Model

A scope is a **disjunction of clauses**. Each clause is a **conjunction of predicates**. Array predicates match if the player matches *any* element. Missing predicate = wildcard.

**Predicate vocabulary:**

| Predicate | Type | Match |
|---|---|---|
| `leagues[]` | categorical | league id in array |
| `teams[]` | categorical | club id in array |
| `nationalities[]` | categorical | citizenship in array |
| `positions[]` | categorical | position in array |
| `tournaments[]` | roster | player was in the tournament's squad |
| `stats[]` | statistical | `{metric, op, value}` — see §5.2 |
| `seasons[]` | temporal | season start-year in array (2014 → "2014/15") |
| `seasonStart` / `seasonEnd` | temporal range | overlaps a stint's season range |

```json
{
  "v": 2,
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
  "v": 2, "id": "uuid", "name": "Our mix",
  "clauses": [
    { "leagues": ["ES1"], "seasonStart": 2010, "seasonEnd": 2019 },
    { "leagues": ["GB1"], "seasonStart": 2024, "seasonEnd": 2025 }
  ]
}
```

Stat and tournament clauses:

```json
{
  "v": 2, "id": "uuid", "name": "Late Bloomers",
  "clauses": [
    { "leagues": ["ES1"], "seasonStart": 2010, "seasonEnd": 2019 },
    { "stats": [{ "metric": "goals_after_age_30", "op": ">=", "value": 50 }] }
  ]
}
```

```json
{
  "v": 2, "id": "uuid", "name": "World Cup 2022",
  "clauses": [ { "tournaments": ["wc-2022"] } ],
  "window": "wc-2022",
  "question": { "template": "identify", "difficulty": "medium" }
}
```

A scope is three things, and the third is what makes it a *game* rather than a filter:

| Field | Decides |
|---|---|
| `clauses[]` | **who** is eligible — the pool |
| `window` | **the lens** questions are asked through (§4.8) |
| `question` | **what kind** of question, and how deep the hints go |

`window` is normally *derived* from the clauses (§4.8) and only stored when it is overridden. `question.template` defaults per scope type (§6.5) but is overridable, so a group can force "only ever ask me numbers" if they want.

**Scope clauses reference stable ids, never display names.** `leagues` holds competition ids (`ES1`, `GB1`, `IT1`, `FR1`, `L1`, `NL1`, `PO1`, `MLS1`, `SA1`); `teams` holds club ids; `tournaments` holds tournament ids. The client renders names from `leagues.display_name`, `clubs.name` and `tournaments.display_name`. This matters because the source club names are *not* the names people type — the dataset has `Arsenal FC`, `Liverpool FC`, `FC Barcelona`, `Juventus FC`, and the current app's team picker searches for `Arsenal`, so it would never match a single row. `club_aliases` and `league_aliases` map what people type to the canonical ids.

### 5.2 Matching

```js
const OPS = {
  '>=': (v, t) => v >= t,
  '>':  (v, t) => v >  t,
  '<=': (v, t) => v <= t,
  '<':  (v, t) => v <  t,
  '==': (v, t) => v === t,
  between: (v, t) => v >= t[0] && v <= t[1],
};

function statMatches(pred, stats) {
  const v = stats?.[pred.metric];
  if (v === undefined || v === null) return false;   // no value → no match, NEVER default to 0
  const op = OPS[pred.op];
  return op ? op(v, pred.value) : false;
}

```js
function clauseMatches(clause, player) {
  const L = clause.leagues?.length ? clause.leagues : null;
  const T = clause.teams?.length ? clause.teams : null;
  const N = clause.nationalities?.length ? clause.nationalities : null;
  const P = clause.positions?.length ? clause.positions : null;
  const R = clause.tournaments?.length ? clause.tournaments : null;
  const S = clause.seasons?.length ? clause.seasons : null;

  if (N && !N.includes(player.nationality)) return false;
  if (P && !P.includes(player.position)) return false;

  if (R && !(player.tournaments || []).some(t => R.includes(t))) return false;

  // A stat predicate is satisfied by the player's derived value.
  // A player with a genuine 0 goals FAILS '>= 50' — but a player with NO
  // derived value also fails, and is distinguishable in the data.
  if (clause.stats?.length) {
    if (!clause.stats.every(p => statMatches(p, player.stats))) return false;
  }

  const needsEntry = L || T || S || clause.seasonStart != null || clause.seasonEnd != null;
  if (!needsEntry) return true;

  return (player.teams || []).some(e => {
    if (L && !L.includes(e.leagueId)) return false;
    if (T && !T.includes(e.clubId)) return false;
    if (S && !e.seasons.some(s => S.includes(s))) return false;
    if (clause.seasonStart != null || clause.seasonEnd != null) {
      if (!seasonsOverlap(e.seasons, clause.seasonStart, clause.seasonEnd)) return false;
    }
    return true;
  });
}

export function playerInScope(player, scope) {
  if (!scope || !Array.isArray(scope.clauses) || scope.clauses.length === 0) return true;
  return scope.clauses.some(c => clauseMatches(c, player));
}
```

The `stats` block is **ANDed within a clause** and the clause is **ORed across clauses**. So `[{leagues:["ES1"], 2010-19}, {stats:[goals_after_age_30>=50]}]` means *La Liga 2010s players* **or** *players with 50+ goals after 30* — the union semantics the pitch asks for, now including numeric predicates.

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
| **World Cup 2022** | `{tournaments:["wc-2022"]}` | ~231 (Wikidata) |
| **World Cup 2026** | `{tournaments:["wc-2026"]}` | ~1,247 (TM dump) |
| **Late Bloomers** | `{stats:[{metric:"goals_after_age_30",op:">=",value:50}]}` | ~111 |
| **Ever-Capped** | `{stats:[{metric:"international_caps",op:">=",value:50}]}` | ~1,023 |
| **Century Goals** | `{stats:[{metric:"club_goals",op:">=",value:100}]}` | ~160 |

The uncounted pools are measured by `validate.js` at ingest and their numbers are written into the preset definitions rather than guessed here. Club ids are resolved at ingest by name lookup, so a preset never hardcodes a club name string.

**Note:** the source dataset contains no Atlético Madrid club row, so no preset may reference it. Presets are limited to clubs that exist in the data.

### 5.5 Era floor handling

The builder's era slider spans the real data range. As the user drags, the live pool count updates and **low-coverage eras are flagged**: any window whose pool falls below 20 players shows a warning — *"only 49 players have La Liga data for 2005–09"*. Saving such a scope is refused with that reason. The slider is **not** hard-clamped — hiding the cliff would misrepresent what the data contains.

The same rule applies to **stat thresholds**: a threshold whose pool falls below 20 is refused with the count, e.g. *"only 3 players scored 200+ goals after turning 30 — try 50+"*. The builder suggests the nearest threshold that holds.

### 5.6 Tournament rosters

Tournament membership is a **separate source**, because the Transfermarkt dump's own tournament coverage is thin:

| Tournament | Squad source | Players |
|---|---|---|
| **World Cup 2022** | Wikidata `P1344` (participant in) ∪ date-qualified `P54` (member of sports team), ∩ occupation footballer | ~231 |
| World Cup 2026 | TM `game_lineups` (group stage only — the dump froze 2026-07-06) | ~1,247 |
| Copa América 2024 | TM `game_lineups` | ~412 |
| AFC Asian Cup 2024 | TM `game_lineups` | ~611 |
| AFCON 2025 / 2026 | TM `game_lineups` | ~650 / ~418 |

The TM dump contains **World Cup 2022 fixtures but no lineups**, and **no Euro lineups at all**, despite carrying Euro fixtures from 2008. So tournament rosters are ingested from Wikidata for WC2022 and other tournaments, and from the dump where lineups exist.

Ingest for a Wikidata tournament:

```sparql
SELECT DISTINCT ?player WHERE {
  ?player wdt:P31 wd:Q5; wdt:P106 wd:Q937857 .         # occupation: association football player
  { ?player wdt:P1344 wd:Q284163 . }                    # participant directly
  UNION
  { ?player p:P54 ?st . ?st ps:P54 ?team .            # or member of a participating team
    ?team wdt:P1344 wd:Q284163 .
    ?st pq:P580 ?start .                               # ...during the tournament window
    FILTER(YEAR(?start) >= 2021 && YEAR(?start) <= 2022) }
}
```

Each resolved player is matched to a `player_pool` row by normalised name + DOB; unmatched names go to `overrides.json` for adjudication. A tournament that resolves to fewer than 20 pool players is not offered as a preset.

**What the pool actually is:** footballers Wikidata records as participants in, or members of a participating nation's squad during, the tournament. It is **not** the exact 26-man squad list — that is modelled only in Wikipedia's navbox templates, not in Wikidata. The scope card states the pool size so nothing is overstated. The ~231 figure was measured on 2026-10-21; an earlier estimate of ~440 came from an unfiltered query and was wrong.

### 5.7 The vibe crafter — the front door

The customization surface is the first thing a user touches, and it must feel like **curating a mood**, not composing a query. This is where the setup-friction risk the pitch names is won or lost.

**User-facing language.** The player-facing noun is a **vibe**, and the verb is **craft**. Internally it is still a `scope` — the code keeps the precise term, the interface uses the warm one.

| Everywhere | Instead of |
|---|---|
| "Craft a vibe" | "Create Scope" / "Build a filter" |
| "Make this ours" | "Fork" / "Duplicate" |
| "A fresh quiz is generated every time you play" | "New quiz each session" |
| "Vibes" (saved list) | "Your Scopes" |

**Principles:**

1. **Start from a vibe, never from a blank form.** The first screen is a grid of vibe cards — *La Liga 2010s*, *World Cup 2022*, *Late Bloomers*, *Derby Night*, *Ever-Capped*. Each shows its pool size and a one-line description. A blank composer is a form; a preset is a starting point.
2. **Adjust by swapping, not by configuring.** Opening a vibe offers named moves — **different era**, **different competition**, **add a club**, **only these nations**, **a narrower stat** — not a wall of checkboxes and sliders. Every move re-runs the pool and shows the new count.
3. **The pool count is the feedback loop.** Every move shows the before and after: *"1,854 players → 312 players"*, instantly, on-device. If the count drops below the floor, the move is marked and the reason is stated — *"only 49 players have La Liga data for 2005–09"*.
4. **Never reject a number the user typed.** A stat threshold that yields 3 players is not an error to be refused; it is shown with the count and a suggestion — *"only 3 players hit 200+ goals aged 30+ — try 50+"* — and the smaller threshold is one tap away.
5. **Fork, don't start over.** The primary action on a vibe card is **"Make this ours"**, which copies it into the group's saved list.
6. **Share the vibe, not the query.** The share link carries the vibe's definition and opens as a ready-to-play card for the recipient.

**The composer stays behind the vibes.** A free-form query console is v2 and only unlocks if vibes get used *and* forked. If people keep forking presets but never build from scratch, the composer is not a missing feature — it is unnecessary.

---

## 6. Game engine

Pure, DOM-free, unit-tested modules under `js/engine/`. The server must be able to validate a submitted answer, so answer validation and scoring cannot live only in the browser.

### 6.1 Round structure

**20 seconds.** Four clue stages, auto-revealed by the server on an absolute schedule.

| t | Event |
|---|---|
| 0–2s | Setup. **Window banner** (e.g. "2022 WORLD CUP"), scope name, round number. Answer inputs disabled. |
| 2–7s | **Clue 1** revealed. Multiplier ×5. |
| 7–12s | **Clue 2** revealed. Multiplier ×3. |
| 12–17s | **Clue 3** revealed. Multiplier ×2. |
| 17–20s | **Clue 4** revealed. Multiplier ×1. |
| 20s | **Snap.** All inputs lock. Server reveals the answer and resolves the round. |

The window banner is always visible for the whole round. It is the answer to "what is this round actually about?" and it is what makes a windowed scope feel different from a flat one.

Clue set is chosen per target from the capabilities the player actually has (§4.5) and the window in play (§6.7), ordered **hardest first** — the window-specific facts outrank the career surface facts.

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

### 6.5 Question templates

Every round has the same shape, whatever the template:

```js
{
  template: 'identify' | 'stat_value' | 'membership',
  prompt:  string,          // what is being asked
  context: string | null,   // the window label, shown as a banner
  subject: player | null,   // named in the prompt, if any
  answer:  string,          // the correct answer value
  options: string[],        // 4 options, one correct
  answerLabel: string,      // how the correct option is labelled
  clues:   [{id, label, value, iconKey, window?}],   // revealed across the 4 stages
}
```

The engine signature becomes `generateRound(scope, template, difficulty)`. The 4-stage ladder, the lock-in, the scoring formula and the UI are **identical across templates** — only the prompt, the option set and the hint generator change. That is what keeps three templates from becoming three games.

**T1 — `identify`** (v1 default). "Who is this?" The target is drawn from the scope pool; each stage reveals a fact about it. Answer is a player name; options are 4 names.

Because the Scope can carry stat predicates, T1 automatically produces statistical questions: the target comes from a stat-filtered pool and one of the clue cards is the stat itself.

> Scope: *Late Bloomers* (50+ goals aged 30+, since 2012)
> Clue 3: **"50+ goals aged 30+ (since 2012)"**
> Options: İlkay Gündoğan · Hakan Çalhanoğlu · Emre Belözoğlu · Okay Yokuşlu

This costs nothing beyond the scope extension — no new UI, no new answer shape.

**T2 — `stat_value`** (v1.1). The answer is a **number**, not a name. The prompt names the player; the player must be chosen so the number is not guessable from the prompt alone.

> "How many international caps did **Mesut Özil** have?"
> Options: 90 · 92 · 94 · 96

Numeric distractors are generated from the metric's real distribution among comparable players (same position, similar era), rounded to plausible increments, and **never equal to the true value**. A metric with fewer than 20 non-zero values in the pool is not used — there would be nothing to discriminate against.

**T3 — `membership`** (v1.1). The answer is one of four players who *is* in the scope, with three who are not.

> "Who played in the **2022 World Cup**?"
> Options: Lionel Messi · Kevin De Bruyne · Erling Haaland · Jude Bellingham

The distractor rule reverses: the three wrong options must each violate the scope for a *different, visible* reason, so the answer is findable by elimination rather than by luck.

**Template selection.** The template is part of the Scope's configuration, with a default per scope type:

| Scope contains | Default template |
|---|---|
| a `tournaments` predicate | `membership` (it is the natural question) |
| a `stats` predicate | `identify` (the stat becomes a clue) |
| neither | `identify` |

Difficulty applies to **clue depth**, not just player obscurity:

| Difficulty | T1 clue ladder | T2 | T3 |
|---|---|---|---|
| Easy | nationality → position → club → stat | one supporting hint | one elimination hint |
| Medium | position → club → era → stat | two supporting hints | two elimination hints |
| Hard | all statistical / career-path clues, surface facts withheld | three supporting hints | three elimination hints |

**Why "inclusivity" needs all three:** the casual fan gets T1 with a shallow ladder and a famous player; the football-stat obsessive gets T2 with a precise number and a deep hint chain; the nostalgic fan gets a tournament scope with T3. One template serves one of those three people and leaves the other two bored — which is the same reason a room with one format dies after round 4.

### 6.6 The question generator

Questions are **composed**, not selected from a table. A generator produces the question text, the answer, and the distractors from a (metric, window, subject) triple.

```js
// recipes/registry.js
export const RECIPES = [
  {
    id: 'goals_in_season',
    template: 'stat_value',
    metric: 'goals',
    windowKinds: ['season'],
    // subject is chosen by the generator; the recipe only knows how to speak.
    speak: ({ subject, window, value }) => ({
      prompt: `How many goals did ${subject.name} score for ${window.clubName} in ${window.seasonLabel}?`,
      answer: value,
      unit: 'goals',
    }),
  },
  {
    id: 'goals_in_tournament',
    template: 'stat_value',
    metric: 'goals',
    windowKinds: ['tournament'],
    speak: ({ subject, window, value }) => ({
      prompt: `How many goals did ${subject.name} score at the ${window.label}?`,
      answer: value,
      unit: 'goals',
    }),
  },
  {
    id: 'identify_in_window',
    template: 'identify',
    metric: 'identity',
    windowKinds: ['career', 'season', 'season_range', 'tournament', 'club_stint', 'age_band'],
    speak: ({ subject, window }) => ({
      prompt: `Who is this?`,
      context: window.label,          // rendered as a banner above the clue ladder
      answer: subject.name,
    }),
  },
  // ... one entry per metric × window kind combination that ships
];
```

**Selection.** The generator picks a recipe whose metric and window kind are *available* for the scope's window and whose answer is discriminable:

1. Collect every `(recipe, subject)` pair where the subject has a non-null value for the recipe's metric in a window of a compatible kind.
2. Reject pairs whose value is degenerate — `0` (nothing to distinguish) or a value the window's population shares with every other candidate.
3. Rank by **informativeness**: how sharply the true value separates the subject from the other candidates in the pool.
4. Pick one, then build distractors appropriate to the template.

This is why the questions are **dynamic**: the same scope produces a different question each game, chosen from whatever the data can actually distinguish.

**Distractors per template.** Numeric questions draw from the metric's real distribution among comparable players (same window, same position), rounded to plausible increments, never equal to the truth. Name questions draw from the pool and enforce the non-determinability rule from §6.4.

**Phrasing is content, not code.** Every recipe carries its own sentence, so a human can rewrite "How many goals did he score for Real Madrid in 2014-15?" into "He hit 61 for Real Madrid that season — how many?" without touching logic. The registry is the one place where the game's voice lives.

### 6.7 Hint catalogue

Hints are the ladder's payload. The catalogue below is what "wide and inclusive" means concretely — every one is backed by a real source row, and each declares whether it is exact or windowed.

**Career-level**

| # | Hint | Source | Exact |
|---|---|---|---|
| 1 | Nationality | `players.citizenship` | ✓ |
| 2 | Position + preferred foot | `players.position`, `players.foot` | ✓ |
| 3 | Age / birth decade | `players.date_of_birth` | ✓ |
| 4 | Height | `players.height_cm` | ✓ |
| 5 | International caps | `players.international_caps` | ✓ |
| 6 | International goals | `players.international_goals` | ✓ |
| 7 | Peak market value + the year it peaked | `market_value_history` | ✓ |
| 8 | Club path with years | `club_stints` | ✓ |
| 9 | Number of clubs / leagues | `club_stints` | ✓ |
| 10 | Shirt number at a given club-season | `game_lineups.number` | windowed |

**Window-level** — the new layer

| # | Hint | Example | Source | Exact |
|---|---|---|---|---|
| 11 | Tournament participation | "played in the 2022 World Cup" | `player_tournaments` | ✓ |
| 12 | Tournament output | "scored 3 goals at the 2022 World Cup" | `player_window_stats` | ✓ |
| 13 | Club-season output | "61 goals for Real Madrid in 2014-15" | `player_window_stats` | ✓ |
| 14 | Club-season appearances | "made 38 league appearances in 2018-19" | `appearances` | windowed |
| 15 | Age-band output | "50+ goals aged 30+ (since 2012)" | `player_window_stats` | windowed |
| 16 | Value at a point in time | "valued at €80M in 2018" | `market_value_history` | ✓ |
| 17 | Scarcity comparison | "one of only 7 players with 100+ Premier League appearances" | derived over the pool | ✓ |
| 18 | Teammate link | "played alongside Messi at Barcelona" | club-season overlap | ✓ |

**Explicitly unavailable:** trophies, Ballon d'Or, league awards, transfer fees, and captaincy. None of these exist in any free source, and the old project's "Domestic Title Winner" clue was the fabrication that proved the point. A hint type ships only when it has a source.

**Hint ordering.** The ladder serves the hardest, most specific fact first — the one that narrows the pool fastest. For a tournament window, "scored 3 goals at the 2022 World Cup" (12) outranks "played in the 2022 World Cup" (11) outranks "a forward" (2). Career-level surface facts (nationality, position) are held back for the low-multiplier stages, so the ×5 stage is worth waiting for.

**Difficulty = hint depth**, not just player obscurity. Easy ladders surface surface facts early; hard ladders surface window-level facts and withhold the obvious ones.

### 6.8 The Quiz Planner — generating a quiz, not ten questions

This is pillar 2. Everything above generates **a round**; the planner generates **a quiz**.

A round generated in isolation produces ten unrelated questions: the same player twice, three consecutive rounds about goals, a career-total clue next to a windowed one, a hard question in round 1. That is a filtered database with extra steps.

The planner takes the scope and produces the **entire ten-round set at once**, with the shape of a quiz designed in.

```js
// engine/quiz-planner.js
export function planQuiz(scope, pool, { rounds = 10, seed, difficulty }) {
  const candidates = collectCandidates(scope, pool);   // every (subject, metric, window) that is discriminable
  const plan = [];
  const used = { subjects: new Set(), metrics: new Set(), windows: new Set() };

  for (let i = 0; i < rounds; i++) {
    const target = pickBest(candidates, {
      used,
      // the curve: early rounds are generous, later rounds dig
      depth: difficultyCurve(difficulty, i, rounds),
      rng: seeded(seed, i),
    });
    if (!target) break;
    const round = composeRound(target, scope, difficultyCurve(difficulty, i, rounds));
    plan.push(round);
    used.subjects.add(round.subject.id);
    used.metrics.add(round.metric);
    used.windows.add(round.window.id);
  }
  return { scope, seed, rounds: plan };
}
```

**What makes a candidate worth asking.** Each (subject, metric, window) is scored on four axes, and the planner takes the highest-scoring one that does not violate the diversity constraints:

| Axis | Question it answers | Example |
|---|---|---|
| **Informativeness** | Does the answer actually separate the subject from the other candidates? | A goal total of 61 separates; 0 does not |
| **Specificity** | Is the fact precisely scoped rather than a vague career summary? | "61 goals for Real Madrid in 2014-15" beats "he scored a lot" |
| **Non-obviousness** | Would a casual fan already know this? | A famous player's nationality is obvious; a teammate link is not |
| **Novelty** | Has this fact already been used in this quiz? | "Scored in 4 of 6 windows" is unused until it isn't |

**The diversity constraints** — what makes it a quiz:

1. **No subject repeats** within a quiz (relaxed to at most twice only when the pool is smaller than 20).
2. **No metric repeats consecutively**; ideally no metric repeats at all until the scope's metrics are exhausted.
3. **The quiz spans the scope.** If the scope supports career facts, window facts and scarcity facts, the quiz uses all three families rather than ten goals questions.
4. **A difficulty curve.** Early rounds use shallow hints and generous multipliers; later rounds dig into window-level facts. Round 1 is a warm-up; round 10 is the one people argue about.
5. **No dead rounds.** Every generated round must have a discriminable answer and at least one hint that is not already implied by an earlier round's answer.

**The plan is server-side and identical for everyone.** It is generated once when the room starts, written to the `quiz_plans` table, and every phone renders the same ten rounds. Determinism comes from a seed (`rooms.quiz_seed`), so a plan can be regenerated and verified — and so a bug report can be reproduced exactly.

**The plan is never shown to the players.** The engine is under the hood: a player sees a round, plays it, and finds out what the quiz had in store by playing it. Showing the plan's shape beforehand would give the quiz away — the stat types, the scarcity questions and the curve are the surprise, and a surprise is the thing that makes a group ask for round 4.

What the lobby *does* show is the Scope (the pool, the era, the difficulty) and one honest line: **a fresh quiz is generated every time you play.** That tells the group the quiz is not a fixed artefact without describing it.

The one place the plan's shape does surface is **after** the game, on the results screen, where it becomes part of the shared artefact rather than a preview of it.

**Why this is the difference between a filter and a generator.** A filter returns a set and lets the player consume it in whatever order it happens to be in. A generator returns a *designed* set: it has a beginning and an end, it varies, it builds, and it reserves its best material for when it will land hardest. If the group plays the same Scope every week, the plan being fresh each time is the retention mechanic — the Scope is stable, the quiz is not.

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
  quiz_seed bigint,                         -- seed the quiz plan was generated with
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

-- The plan is generated server-side at game start and is NEVER exposed to clients.
create table quiz_plans (
  room_id uuid primary key references rooms(id) on delete cascade,
  seed bigint not null,
  plan jsonb not null,           -- the composed ten rounds, in order
  summary jsonb,                 -- machine-readable shape, for the post-game recap
  generated_at timestamptz not null default now()
);
-- RLS: SELECT denied to all clients. service_role only.

-- A round's client-visible data. Deliberately contains NO answer.
create table rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  clue_order jsonb not null,             -- [{id,label,value,iconKey}] in reveal order
  reveal_schedule jsonb not null,        -- [{stage, reveal_at}] absolute timestamptz
  status text not null default 'pending' check (status in ('pending','active','closed')),
  started_at timestamptz, closed_at timestamptz,
  unique (room_id, round_number)
);

-- The answer key. Separate table because RLS is row-level and cannot hide a column.
create table round_secrets (
  round_id uuid primary key references rounds(id) on delete cascade,
  target_player_id bigint not null references players(id),
  source_id text references sources(id)
);
-- RLS: no client SELECT, no client INSERT/UPDATE. service_role only.

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
- `quiz_plans` — **no client access at all.** The plan and the answer keys are server-only.
- `rounds` — SELECT: room members, **and only for rounds that have started**. A client may see the current round's clues and schedule; it may not read a future round. INSERT/UPDATE: server only.
- `round_secrets` — **no client SELECT, ever.** This is the answer key.
- `answers` — SELECT: room members. INSERT: `auth.uid() = user_id`, guarded by an `is_round_open` RPC. No UPDATE ever.

**Two rules that make "the engine is under the hood" true:**

1. **A client never receives the plan.** The ten-round plan exists only in `quiz_plans`, readable by the service role. Clients receive *the current round's* clues, schedule and options, and nothing about the rounds after it.
2. **Future rounds are not materialised.** The plan is computed once at game start, but `rounds` rows are inserted one at a time, as each round begins. Even if a client queried the table directly, there is no future row to find — and the one row that exists has no answer in it.

A player who opens devtools sees their own round's clues and options (which they can see on screen anyway) and nothing else.

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
| Home | Craft a vibe, resume a saved vibe, create a room |
| **Vibe crafter** | Vibe cards, named moves, live pool count (§5.7) |
| Lobby | Room code, vibe card, roster, **"a fresh quiz is generated every time you play"**, start |
| Round | Window banner, clue ladder, clue cards, live avatar strip, 4 options, timer, rank |
| Reveal | Collectible card with photo and window fact, your points, resolved leaderboard |
| Results | Final standings, **post-game quiz recap**, "craft your own vibe" CTA, share |
| Credits | Photo attributions (CC BY-SA compliance) |

**The lobby shows nothing about the quiz.** No plan summary, no stat types, no curve. The engine's decisions are discovered by playing. The lobby shows only what the group chose — the vibe, its pool size, the era, the difficulty — and one honest line about the quiz being generated fresh. The plan's shape surfaces **after** the game, on the results screen, where it is part of the shared artefact rather than a preview of it.

**The results screen's quiz recap** is a small, honest line: *"This quiz: 10 rounds · 5 different kinds of question · hardest round: 6"*. It is the discovery mechanic — the group finds out what the engine did with their vibe, and that is what they talk about afterwards.

**The lobby's plan card** is where the user sees pillar 2 working. It is generated from the plan, not written by hand:

> **TONIGHT'S QUIZ**
> 10 rounds · La Liga 2010–19
> 5 different stat types · 1 club-season question · 1 scarcity question
> Gentle → deep

The group reads that and knows the quiz has a shape before round 1. It is also the strongest reason to press **Start** — which is the entire setup-friction risk the pitch names, solved by showing value before asking for commitment.

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
| R7 | **Answer leakage** — a player reads the answer key from the database | The answer lives in `round_secrets`, which has no client SELECT. Future rounds are never materialised, so there is no future answer to find. A devtools check is part of the end-to-end test: a client cannot read any round's target before it resolves. |

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
`scripts/ingest/*` → Postgres. `player_pool` view. Quality gate. Validation report green. `gold_standard.json` as a regression test. Photos ingested via the Commons chain. **Derived stats (`derive.js`) with window + `exact` flags.** Tournament rosters from Wikidata and from `game_lineups`.

### Phase 2 — Game engine
`js/engine/` — pure modules:
- scope matcher (categorical + temporal + statistical + tournament predicates)
- window builder (§4.8)
- **quiz planner** (§6.8) — generates the ten-round set with diversity constraints
- question generator + recipe registry (§6.6)
- clue generator (§6.7)
- distractor generator
- scoring, round state machine

Unit-tested, no DOM. Same code runs in the browser and in server-side validation.

**The planner is the piece to build first in this phase.** A round generator without a planner produces ten unrelated questions, and the whole product is the difference between that and a designed quiz.

### Phase 3 — Client shell
Mobile-first PWA, Retro Collectible theme + Premium Editorial theme, four screens wired to the engine with fake data, accessibility pass (contrast, focus, reduced-motion).

### Phase 4 — Multiplayer room
Supabase schema + RLS + RPCs, room lifecycle, Realtime channels, sync, leaderboard, failure-mode handling. `quiz_plans` and `round_secrets` are service-role only; `rounds` rows are materialised one at a time as each round begins.

### Phase 5 — Scope builder
Presets + fork + era slider with coverage warning + **stat threshold control with live count and nearest-valid suggestion** + tournament picker + live pool preview + share links.

### Phase 6 — Polish
Sound, haptics, motion, credits screen, empty/error states, PWA install.

### Phase 7 — v1.1 templates
Add T2 `stat_value` and T3 `membership` to the template registry. Each is a new generator + a new option renderer; the ladder, scoring and room are untouched.

---

## 11. Testing

| Layer | Approach |
|---|---|
| Scope matcher | Pure-function unit tests + a shared fixture run against both the JS and SQL implementations so they cannot drift |
| Scope stat predicates | Property test: a player with a **missing** metric never matches a numeric predicate; a player with a genuine `0` matches `== 0` and fails `>= 1`. The distinction must hold. |
| Metric windowing | Property test: every `player_derived_stats` row has a window unless `exact`; every clue text for a windowed metric contains the window string. **Fails if a windowed metric is ever surfaced unlabelled.** |
| Window derivation | Property test: every window in `windows` traces to a source row — no window exists that no stint, tournament, season range or age band produced. |
| Window accuracy | Regression fixture asserting the verified totals: Ronaldo 61 (Real Madrid 2014-15), Messi 60 (Barcelona 2012-13), Suárez 59 (2015-16), Lewandowski 55 (Bayern 2019-20), Messi 7 (2022 WC). |
| Threshold guard | Every preset threshold and every stat filter resolves to ≥ 20 pool players, asserted in `validate.js` |
| Clue generation | Property tests: every clue value is non-null, comes from a real source row, and no two stages leak the same fact |
| Question generator | Property test: for every generated round, the answer appears in the options exactly once, the true value is not among the distractors, and the prompt's numbers match the answer. **Every recipe's output is snapshot-tested** so a wording change is a visible diff. |
| Recipe coverage | Assert every shipped metric has a recipe for every window kind it supports, and that no recipe can be selected without a non-degenerate value. |
| Quiz planner | Property test on every generated plan: no subject repeats; no metric repeats consecutively; the plan spans ≥ 2 metric families when the scope supports them; every round has a discriminable answer; the difficulty curve is monotonic in hint depth. |
| Quiz planner determinism | Same `(scope, seed)` → byte-identical plan. Different seed → a materially different plan (assert > 50% of rounds differ). |
| Quiz plan summary | Assert the lobby summary is derived from the plan (round count, metric-family count, curve) and never contradicts it. |
| Hint catalogue | Assert every shipped hint type resolves to a source row; a hint type with no source cannot be enabled. |
| Distractors | Property test: no distractor matches the full conjunction of revealed clues; the answer is never uniquely determined by the option set |
| Templates | One test per template asserting the round shape (`prompt`, `context`, `answer`, 4 options, 4 clues) and that the answer is present in the options exactly once |
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
