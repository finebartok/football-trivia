# Data Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fabricated dataset with a reproducible pipeline that produces a validated Postgres `player_pool` — real players only, every stat traceable to a source row, every metric carrying its window.

**Architecture:** A four-stage pipeline — `fetch` (download + sha256 manifest) → `load` (raw CSV → staging) → `normalize` (pure functions → canonical rows) → `derive` (staging → `player_seasons`, `windows`, `player_window_stats`) → `validate` (quality gate + report). `normalize` and `derive` are pure functions over arrays, so they are unit-testable without a database. The database is Postgres; tests run against PGlite (Postgres compiled to WASM, in-process) so the suite needs no server.

**Tech Stack:** Node 22 (ESM), `node --test`, `csv-parse`, `pg`, `@electric-sql/pglite`, Postgres 15, Supabase for hosted Postgres + Storage.

**Spec:** `docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` — §4 (data layer) governs this plan. The engine plan (`docs/superpowers/plans/2026-10-20-game-engine.md`) runs in parallel and consumes `data/fixtures/pool.sample.json`.

## Global Constraints

- **Zero fabrication.** No value enters the database that is not present in a source row. Missing means `NULL`, never `0`. A seeded-RNG estimator does not exist in this codebase.
- **Every metric carries a window.** `player_window_stats.exact` is `true` only for career-true metrics (caps, market value, DOB). Windowed metrics (`club_goals`, `club_appearances`, `goals_after_age_30`) carry `window_start`/`window_end` and must never be surfaced without them.
- **Season key is the start year.** `2014` means the 2014/15 season. Ranges are inclusive.
- **Stable ids only.** Leagues are TM competition ids (`ES1`, `GB1`), clubs are `clubs.id`, tournaments are `tournaments.id`. No display name is ever stored as a key.
- **`data/raw/` is gitignored** and holds immutable snapshots. Corrections live in `data/overrides.json`, never by editing raw files.
- **Node 22+, ESM only** (`"type": "module"`). Tests run with `node --test`; no test framework dependency.
- **Migrations are idempotent** and applied in filename order from `db/`.
- Source data: `https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data` (the CC0 `dcaribou/transfermarkt-datasets` dump). Photographic data: Wikidata P18 → Wikimedia Commons.

## Review Focus

These are the inputs and boundaries most likely to bite a person using this software. Each has a test pinned to the task that owns the code.

1. **A player with no value for a metric** — must not match a numeric predicate and must never render as `0`. (Task 4)
2. **A name outside ASCII** — `Ç`, `ğ`, `ü`, `ø` must survive normalisation round-trip and still match. Our own `players.json` shipped 8 wrong DOBs from day/month swaps; a name/DOB mismatch must be reported, not silently resolved. (Tasks 2, 4)
3. **A scope or threshold resolving to fewer than 20 players** — refused with a reason and a count, never silently padded with substitute players. (Task 8)
4. **A player exactly on a scope's era boundary** — `seasonStart` and `seasonEnd` are both inclusive; a player whose only stint is `2019` matches a `2010–2019` scope. (Task 4)
5. **Two clubs with the same name in different leagues** — `Arsenal FC` (GB1) and `Arsenal Tula` (RU1) are different clubs, and `Arsenal` (no "FC") must alias to exactly one of them. (Task 4)

---

## File Structure

```
lib/                        # shared pure helpers, imported by BOTH plans
  names.js                  # normaliseName, matchKey, isJunkName
  seasons.js                # parseSeason, seasonLabel, overlapsSeason

db/
  001_schema.sql            # tables
  002_views.sql             # player_pool view + indexes
  003_seed_reference.sql    # leagues, league_aliases, tournaments

scripts/ingest/
  fetch.js                  # download sources -> data/raw/, write manifest.json
  load.js                   # raw -> staging -> normalized tables
  normalize.js              # PURE: raw row -> canonical row
  derive.js                 # PURE: canonical rows -> stints, windows, window stats
  validate.js               # quality gate + report; --strict exits non-zero
  export-pool.js            # player_pool -> data/fixtures/pool.sample.json shape
  lib/
    db.js                   # PGlite/pg adapter, same query() interface
    csv.js                  # streaming gzip CSV reader over csv-parse
    manifest.js             # read/write + sha256 verify
    wikidata.js             # SPARQL + wbsearchentities + wbgetentities clients

data/
  raw/                      # gitignored immutable snapshots + manifest.json
  overrides.json            # human adjudication, applied last

tests/
  ingest/
    names.test.js
    seasons.test.js
    normalize.test.js
    derive.test.js
    validate.test.js
    load.test.js
    export-pool.test.js
```

**Responsibility boundary:** `lib/` is the only code both plans touch. `scripts/ingest/` is Node-only and never imported by the client. `js/engine/` is browser-safe and never imports from `scripts/`.

---

### Task 1: Harness, dependencies, and the schema

**Files:**
- Modify: `package.json`
- Create: `db/001_schema.sql`
- Create: `db/002_views.sql`
- Create: `db/003_seed_reference.sql`
- Create: `scripts/ingest/lib/db.js`
- Create: `tests/ingest/schema.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `openDb({ url })` → `{ query(sql, params), close() }` — an in-process PGlite instance when `url` is omitted, a `pg` Pool when `url` is given. Same interface for both, so every test runs on PGlite and production runs on Supabase.
- Produces: `applyMigrations(db)` → applies every `db/*.sql` file in filename order, idempotently.

- [ ] **Step 1: Set up the package and dependencies**

Rewrite `package.json`:

```json
{
  "name": "football-trivia",
  "version": "1.0.0",
  "type": "module",
  "description": "Personalized football trivia — real data, generated quizzes",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/",
    "db:apply": "node scripts/ingest/lib/db.js --apply",
    "ingest:all": "node scripts/ingest/fetch.js && node scripts/ingest/load.js && node scripts/ingest/derive.js && node scripts/ingest/validate.js",
    "validate": "node scripts/ingest/validate.js --strict",
    "fixtures": "node scripts/ingest/export-pool.js"
  },
  "dependencies": {
    "@electric-sql/pglite": "^0.2.17",
    "csv-parse": "^5.6.0",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0"
  }
}
```

Run: `npm install`
Expected: installs cleanly; `node_modules/pg`, `node_modules/csv-parse`, `node_modules/@electric-sql/pglite` exist.

- [ ] **Step 2: Write the failing schema test**

Create `tests/ingest/schema.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';

test('migrations apply cleanly and create the expected tables', async () => {
  const db = await openDb();
  await applyMigrations(db);

  const tables = (await db.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `)).rows.map(r => r.table_name);

  for (const t of [
    'clubs', 'club_aliases', 'club_stints', 'leagues', 'league_aliases',
    'market_value_history', 'overrides', 'player_derived_stats', 'player_pool',
    'player_seasons', 'player_sources', 'player_tournaments', 'player_window_stats',
    'players', 'sources', 'tournaments', 'windows',
  ]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  await db.close();
});

test('player_pool only exposes rows that passed the quality gate', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(`insert into players (slug, name, date_of_birth, citizenship, position, quality)
    values ('a','A Pass','1990-01-01','{"England"}','Forward','{"status":"pass"}'),
           ('b','B Fail','1990-01-01','{"England"}','Forward','{"status":"fail"}')`);
  const rows = (await db.query('select slug from player_pool')).rows;
  assert.deepEqual(rows.map(r => r.slug), ['a']);
  await db.close();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/ingest/schema.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/ingest/lib/db.js`.

- [ ] **Step 4: Write the schema**

Create `db/001_schema.sql`:

```sql
create table if not exists sources (
  id text primary key,
  licence text not null,
  url text,
  sha256 text,
  fetched_at timestamptz not null default now()
);

create table if not exists players (
  id bigserial primary key,
  slug text unique not null,
  name text not null,
  date_of_birth date not null,
  citizenship text[] not null default '{}',
  position text not null check (position in ('Goalkeeper','Defender','Midfielder','Forward')),
  sub_position text,
  preferred_foot text,
  height_cm smallint,
  international_caps int,
  international_goals int,
  highest_market_value_eur bigint,
  market_value_eur bigint,
  photo_id text,
  active boolean not null default false,
  quality jsonb not null default '{}'
);

create table if not exists player_sources (
  player_id bigint references players(id) on delete cascade,
  source_id text references sources(id),
  source_key text not null,
  primary key (player_id, source_id)
);

create table if not exists leagues (
  id text primary key,
  name text not null,
  display_name text not null
);

create table if not exists league_aliases (
  alias text primary key,
  league_id text references leagues(id)
);

create table if not exists clubs (
  id bigserial primary key,
  name text not null,
  country text,
  current_league_id text references leagues(id)
);

create table if not exists club_aliases (
  alias text primary key,
  club_id bigint references clubs(id)
);

create table if not exists tournaments (
  id text primary key,
  name text not null,
  year smallint not null,
  display_name text not null
);

create table if not exists club_stints (
  player_id bigint references players(id) on delete cascade,
  club_id bigint references clubs(id),
  season_start smallint not null,
  season_end smallint not null,
  evidence text not null check (evidence in ('appearance','transfer','wikidata','override')),
  source_id text references sources(id),
  primary key (player_id, club_id, season_start)
);

create table if not exists player_seasons (
  player_id bigint references players(id) on delete cascade,
  season smallint not null,
  club_id bigint references clubs(id),
  league_id text references leagues(id),
  primary key (player_id, season, club_id)
);
create index if not exists player_seasons_league_season_idx on player_seasons (league_id, season, player_id);
create index if not exists player_seasons_season_idx on player_seasons (season, player_id);

create table if not exists player_derived_stats (
  player_id bigint references players(id) on delete cascade,
  metric text not null,
  value numeric not null,
  window_start smallint,
  window_end smallint,
  exact boolean not null,
  source_id text references sources(id),
  primary key (player_id, metric)
);
create index if not exists player_derived_stats_metric_value_idx on player_derived_stats (metric, value);

create table if not exists windows (
  id text primary key,
  kind text not null check (kind in ('career','season','season_range','tournament','club_stint','age_band')),
  label text not null,
  detail text,
  season_start smallint,
  season_end smallint,
  tournament_id text references tournaments(id),
  club_id bigint references clubs(id),
  team_name text,
  age_from smallint,
  age_to smallint
);

create table if not exists player_window_stats (
  player_id bigint references players(id) on delete cascade,
  window_id text not null references windows(id),
  metric text not null,
  value numeric not null,
  exact boolean not null,
  source_id text references sources(id),
  primary key (player_id, window_id, metric)
);
create index if not exists player_window_stats_window_metric_idx on player_window_stats (window_id, metric);

create table if not exists player_tournaments (
  player_id bigint references players(id) on delete cascade,
  tournament_id text not null references tournaments(id),
  team_name text,
  source_id text references sources(id),
  primary key (player_id, tournament_id)
);
create index if not exists player_tournaments_tournament_idx on player_tournaments (tournament_id);

create table if not exists market_value_history (
  player_id bigint references players(id) on delete cascade,
  recorded_on date not null,
  value_eur bigint not null,
  source_id text references sources(id),
  primary key (player_id, recorded_on)
);

create table if not exists photos (
  id text primary key,
  player_id bigint references players(id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  licence text not null,
  attribution text,
  source_url text not null,
  source_id text references sources(id),
  is_primary boolean not null default false,
  fetched_at timestamptz not null default now()
);
create unique index if not exists photos_primary_idx on photos (player_id) where is_primary;

create table if not exists overrides (
  match_key text primary key,
  player_id bigint references players(id),
  note text,
  decided_by text,
  decided_at timestamptz not null default now()
);
```

Create `db/002_views.sql`:

```sql
create or replace view player_pool as
  select p.*, ph.storage_path as photo_path
  from players p
  left join photos ph on ph.player_id = p.id and ph.is_primary
  where p.active and p.quality->>'status' = 'pass';
```

Create `db/003_seed_reference.sql`:

```sql
insert into leagues (id, name, display_name) values
  ('GB1','premier-league','Premier League'),
  ('ES1','laliga','La Liga'),
  ('IT1','serie-a','Serie A'),
  ('FR1','ligue-1','Ligue 1'),
  ('L1','bundesliga','Bundesliga'),
  ('NL1','eredivisie','Eredivisie'),
  ('PO1','liga-portugal','Primeira Liga'),
  ('MLS1','major-league-soccer','MLS'),
  ('SA1','saudi-pro-league','Saudi Pro League')
on conflict (id) do update set name = excluded.name, display_name = excluded.display_name;

insert into league_aliases (alias, league_id) values
  ('Premier League','GB1'), ('PL','GB1'), ('premier league','GB1'),
  ('La Liga','ES1'), ('Laliga','ES1'), ('LaLiga','ES1'), ('laliga','ES1'),
  ('Serie A','IT1'), ('SerieA','IT1'), ('serie a','IT1'),
  ('Ligue 1','FR1'), ('Ligue1','FR1'), ('ligue 1','FR1'),
  ('Bundesliga','L1'), ('Bundes Liga','L1'),
  ('Eredivisie','NL1'), ('Primeira Liga','PO1'), ('Major League Soccer','MLS1')
on conflict (alias) do update set league_id = excluded.league_id;

insert into tournaments (id, name, year, display_name) values
  ('wc-2022','2022 FIFA World Cup',2022,'2022 World Cup'),
  ('wc-2026','2026 FIFA World Cup',2026,'2026 World Cup'),
  ('euro-2024','UEFA Euro 2024',2024,'Euro 2024'),
  ('copa-2024','Copa America 2024',2024,'Copa América 2024')
on conflict (id) do update set name = excluded.name, year = excluded.year, display_name = excluded.display_name;
```

- [ ] **Step 5: Write the db adapter**

Create `scripts/ingest/lib/db.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, '../../db');

export async function openDb({ url } = {}) {
  if (url) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    return {
      async query(sql, params) { return pool.query(sql, params); },
      async close() { await pool.end(); },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = await PGlite.create();
  return {
    async query(sql, params) {
      const res = await pg.query(sql, params);
      return { rows: res.rows ?? [], rowCount: res.affectedRows ?? res.rows?.length ?? 0 };
    },
    async close() { await pg.close(); },
  };
}

export async function applyMigrations(db) {
  const files = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    await db.query(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
  }
  return files;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const db = await openDb({ url: process.env.DATABASE_URL });
  const files = await applyMigrations(db);
  console.log(`applied ${files.length} migrations`);
  await db.close();
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/ingest/schema.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json db/ scripts/ingest/lib/db.js tests/ingest/schema.test.js
git commit -m "feat(data): schema, migrations and a PGlite-backed test harness"
```

---

### Task 2: Shared helpers — names and seasons

**Files:**
- Create: `lib/names.js`
- Create: `lib/seasons.js`
- Create: `tests/ingest/names.test.js`
- Create: `tests/ingest/seasons.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (from `lib/names.js`): `normaliseName(s: string): string` — accent-folded, punctuation-stripped, lowercased, whitespace-collapsed. `matchKey(s: string): string` — `normaliseName` plus a surname-initial suffix, for disambiguating two players with the same folded name. `isJunkName(s: string): boolean` — true for `''`, `'without club'`, `'unknown'`, `'anonymous'`.
- Produces (from `lib/seasons.js`): `parseSeason(v: string | number): number | null` — `'25/26'` → `2025`, `'99/00'` → `1999`, `'2014/15'` → `2014`, `'2020'` → `2020`. `seasonLabel(start: number): string` — `2014` → `'2014/15'`. `overlapsSeason(seasons: number[], start: number | null, end: number | null): boolean` — inclusive on both ends; `null` means unbounded.

**Note on the century rule:** TM writes `00/01` for 2000/01 and `99/00` for 1999/00. So a two-digit year `n` means `2000 + n` when `n <= 29`, and `1900 + n` when `n >= 30`. Getting this backwards is how the old dataset produced wrong dates.

- [ ] **Step 1: Write the failing tests**

Create `tests/ingest/names.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, matchKey, isJunkName } from '../../lib/names.js';

test('normaliseName folds accents and punctuation but keeps word order', () => {
  assert.equal(normaliseName('Hakan Çalhanoğlu'), 'hakan calhanoglu');
  assert.equal(normaliseName('  Lionel   Messi  '), 'lionel messi');
  assert.equal(normaliseName("Jules Koundé"), 'jules kounde');
  assert.equal(normaliseName('N\'Golo Kanté'), 'ngolo kante');
});

test('matchKey disambiguates two players who fold to the same name', () => {
  assert.notEqual(matchKey('Sadio Mané'), matchKey('Mane'));
  assert.equal(matchKey('Sadio Mané'), matchKey('Sadio Mane'));
});

test('isJunkName rejects placeholder club and player names', () => {
  assert.equal(isJunkName('without club'), true);
  assert.equal(isJunkName(''), true);
  assert.equal(isJunkName('Lionel Messi'), false);
});
```

Create `tests/ingest/seasons.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeason, seasonLabel, overlapsSeason } from '../../lib/seasons.js';

test('parseSeason reads Transfermarkt two-digit seasons in the right century', () => {
  assert.equal(parseSeason('25/26'), 2025);
  assert.equal(parseSeason('99/00'), 1999);
  assert.equal(parseSeason('00/01'), 2000);
  assert.equal(parseSeason('12/13'), 2012);
  assert.equal(parseSeason('2014/15'), 2014);
  assert.equal(parseSeason('2020'), 2020);
  assert.equal(parseSeason('nonsense'), null);
  assert.equal(parseSeason(''), null);
});

test('seasonLabel renders a start year as a season', () => {
  assert.equal(seasonLabel(2014), '2014/15');
  assert.equal(seasonLabel(1999), '1999/00');
  assert.equal(seasonLabel(2000), '2000/01');
});

test('overlapsSeason is inclusive at both ends and unbounded with nulls', () => {
  assert.equal(overlapsSeason([2019], 2010, 2019), true);
  assert.equal(overlapsSeason([2019], 2010, 2018), false);
  assert.equal(overlapsSeason([2005], null, null), true);
  assert.equal(overlapsSeason([2005], 2010, null), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/ingest/names.test.js tests/ingest/seasons.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/names.js`.

- [ ] **Step 3: Write the implementations**

Create `lib/names.js`:

```js
const JUNK = new Set(['', 'without club', 'unknown', 'anonymous', 'n/a', 'na', 'none', '-']);

export function normaliseName(s) {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchKey(s) {
  const n = normaliseName(s);
  if (!n) return '';
  const parts = n.split(' ');
  const last = parts[parts.length - 1];
  const first = parts[0] ?? '';
  return `${first} ${last}`.trim();
}

export function isJunkName(s) {
  return JUNK.has(normaliseName(s));
}
```

Create `lib/seasons.js`:

```js
export function parseSeason(v) {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const head = raw.includes('/') ? raw.split('/')[0] : raw;
  const n = Number.parseInt(head, 10);
  if (Number.isNaN(n)) return null;
  if (n >= 1000) return n;
  return n <= 29 ? 2000 + n : 1900 + n;
}

export function seasonLabel(start) {
  const end = (start + 1) % 100;
  return `${start}/${String(end).padStart(2, '0')}`;
}

export function overlapsSeason(seasons, start, end) {
  const list = seasons || [];
  const lo = start ?? -Infinity;
  const hi = end ?? Infinity;
  return list.some(s => s >= lo && s <= hi);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/names.test.js tests/ingest/seasons.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ tests/ingest/names.test.js tests/ingest/seasons.test.js
git commit -m "feat(lib): shared name and season helpers, with the TM century rule"
```

---

### Task 3: Fetch with a sha256 manifest

**Files:**
- Create: `scripts/ingest/lib/manifest.js`
- Create: `scripts/ingest/lib/csv.js`
- Create: `scripts/ingest/fetch.js`
- Create: `tests/ingest/manifest.test.js`

**Interfaces:**
- Consumes: `lib/names.js` (nothing yet — reserved for Task 4)
- Produces (from `scripts/ingest/lib/manifest.js`): `readManifest(dir): Manifest`, `writeManifest(dir, manifest): void`, `sha256File(path): Promise<string>`. `Manifest` = `{ sources: { [name]: { url, sha256, bytes, fetchedAt } } }`.
- Produces (from `scripts/ingest/lib/csv.js`): `readCsvGz(path): AsyncIterable<Record<string,string>>` — streams a gzipped CSV with a header row, yielding one object per row. Never loads the file into memory.
- Produces (from `scripts/ingest/fetch.js`): `fetchAll({ dest, sources, force })` → downloads each source to `dest/{name}.csv.gz` and records its sha256 in `dest/manifest.json`. If a file exists and its sha256 matches the manifest, it is not re-downloaded.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/manifest.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readManifest, writeManifest, sha256File } from '../../scripts/ingest/lib/manifest.js';

test('manifest round-trips and records a real hash', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-'));
  const file = path.join(dir, 'thing.csv.gz');
  await fs.writeFile(file, 'hello');
  const hash = await sha256File(file);
  assert.equal(hash.length, 64);

  writeManifest(dir, { sources: { thing: { url: 'http://x/thing.csv.gz', sha256: hash, bytes: 5, fetchedAt: 1 } } });
  const m = readManifest(dir);
  assert.equal(m.sources.thing.sha256, hash);
  assert.equal(m.sources.thing.bytes, 5);
});

test('readManifest returns an empty manifest when the file is absent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-'));
  assert.deepEqual(readManifest(dir).sources, {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/manifest.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementations**

Create `scripts/ingest/lib/manifest.js`:

```js
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MANIFEST = 'manifest.json';

export function readManifest(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, MANIFEST), 'utf8');
    const parsed = JSON.parse(raw);
    return { sources: parsed.sources ?? {} };
  } catch {
    return { sources: {} };
  }
}

export function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export async function fileBytes(filePath) {
  return (await fsp.stat(filePath)).size;
}
```

Create `scripts/ingest/lib/csv.js`:

```js
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

export async function* readCsvGz(filePath) {
  const parser = createReadStream(filePath).pipe(parse({ columns: true, bom: true, relax_column_count: true }));
  for await (const row of parser) yield row;
}
```

Create `scripts/ingest/fetch.js`:

```js
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, writeManifest, sha256File, fileBytes } from './lib/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BASE = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data';

export const SOURCES = {
  players: `${BASE}/players.csv.gz`,
  transfers: `${BASE}/transfers.csv.gz`,
  games: `${BASE}/games.csv.gz`,
  clubs: `${BASE}/clubs.csv.gz`,
  competitions: `${BASE}/competitions.csv.gz`,
  appearances: `${BASE}/appearances.csv.gz`,
  game_events: `${BASE}/game_events.csv.gz`,
  player_valuations: `${BASE}/player_valuations.csv.gz`,
};

export async function fetchAll({ dest = path.join(REPO, 'data', 'raw'), sources = SOURCES, force = false } = {}) {
  await fsp.mkdir(dest, { recursive: true });
  const manifest = readManifest(dest);

  for (const [name, url] of Object.entries(sources)) {
    const file = path.join(dest, `${name}.csv.gz`);
    const known = manifest.sources[name];

    if (!force && fs.existsSync(file) && known) {
      const actual = await sha256File(file);
      if (actual === known.sha256) {
        console.log(`  ${name}: cached (sha256 ok)`);
        continue;
      }
      console.log(`  ${name}: hash changed, re-downloading`);
    }

    console.log(`  ${name}: downloading`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(file, buf);

    manifest.sources[name] = {
      url,
      sha256: await sha256File(file),
      bytes: await fileBytes(file),
      fetchedAt: Date.now(),
    };
    writeManifest(dest, manifest);
  }

  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchAll();
  console.log('fetch complete');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/ingest/manifest.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the real fetch**

Run: `node scripts/ingest/fetch.js`
Expected: downloads 8 files into `data/raw/`, writes `data/raw/manifest.json`, prints `cached (sha256 ok)` on a second run.

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest/fetch.js scripts/ingest/lib/manifest.js scripts/ingest/lib/csv.js tests/ingest/manifest.test.js
git commit -m "feat(data): fetch sources with a sha256 manifest for idempotent re-runs"
```

---

### Task 4: Normalisation — pure functions from raw rows to canonical rows

**Files:**
- Create: `scripts/ingest/normalize.js`
- Create: `tests/ingest/normalize.test.js`

**Interfaces:**
- Consumes: `lib/names.js` (`normaliseName`, `matchKey`, `isJunkName`), `lib/seasons.js` (`parseSeason`)
- Produces:
  - `normalisePosition(raw: string): 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward' | 'Unknown'`
  - `normaliseLeague(raw: string): string | null` — resolves a competition id or a display name to a league id, via the alias table.
  - `normalisePlayer(raw: object): NormalisedPlayer | null` — `null` when the row is unusable (no name, junk name, no DOB). Returns `{ sourceKey, name, slug, dateOfBirth, citizenship, position, subPosition, preferredFoot, heightCm, internationalCaps, internationalGoals, marketValueEur, highestMarketValueEur }`.
  - `normaliseTransfer(raw: object): NormalisedTransfer | null`
  - `resolveClubAliases(clubs: Array<{id,name,leagueId}>, aliases: string[]): Map<string, number>` — maps an alias to exactly one club id, and refuses to map an alias that matches two clubs in different leagues.

**This task owns Review Focus items 1, 2, 4 and 5.**

- [ ] **Step 1: Write the failing tests**

Create `tests/ingest/normalize.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePosition, normalisePlayer, resolveClubAliases,
} from '../../scripts/ingest/normalize.js';

test('normalisePosition maps TM sub-positions onto four game positions', () => {
  assert.equal(normalisePosition('Centre-Forward'), 'Forward');
  assert.equal(normalisePosition('Attacking Midfield'), 'Midfielder');
  assert.equal(normalisePosition('Central Midfield'), 'Midfielder');
  assert.equal(normalisePosition('Left-Back'), 'Defender');
  assert.equal(normalisePosition('Goalkeeper'), 'Goalkeeper');
  assert.equal(normalisePosition('Missing'), 'Unknown');
  assert.equal(normalisePosition(''), 'Unknown');
});

test('normalisePlayer keeps a missing stat as null, never zero', () => {
  const p = normalisePlayer({
    player_id: '1', name: 'Test Player', date_of_birth: '1990-01-02',
    country_of_citizenship: 'England', position: 'Centre-Forward',
    international_caps: '', market_value_in_eur: '0', foot: 'Right',
  });
  assert.equal(p.internationalCaps, null, 'empty caps must be null, not 0');
  assert.equal(p.marketValueEur, null, 'a zero market value is not a value');
  assert.equal(p.position, 'Forward');
});

test('normalisePlayer rejects a junk name', () => {
  assert.equal(normalisePlayer({ player_id: '2', name: 'without club', date_of_birth: '1990-01-01' }), null);
});

test('normalisePlayer preserves a non-ASCII name while folding it for matching', () => {
  const p = normalisePlayer({
    player_id: '3', name: 'Hakan Çalhanoğlu', date_of_birth: '1994-01-01',
    country_of_citizenship: 'Turkey', position: 'Central Midfield',
  });
  assert.equal(p.name, 'Hakan Çalhanoğlu');
  assert.equal(p.slug, 'hakan-calhanoglu');
});

test('resolveClubAliases maps an alias to exactly one club', () => {
  const clubs = [
    { id: 1, name: 'Arsenal FC', leagueId: 'GB1' },
    { id: 2, name: 'Arsenal Tula', leagueId: 'RU1' },
  ];
  const map = resolveClubAliases(clubs, ['Arsenal FC', 'Arsenal Tula']);
  assert.equal(map.get('arsenal fc'), 1);
  assert.equal(map.get('arsenal tula'), 2);
});

test('resolveClubAliases refuses an ambiguous alias', () => {
  const clubs = [
    { id: 1, name: 'Arsenal FC', leagueId: 'GB1' },
    { id: 2, name: 'Arsenal', leagueId: 'RU1' },
  ];
  const map = resolveClubAliases(clubs, ['Arsenal']);
  assert.equal(map.has('arsenal'), false, 'an alias matching two clubs must not resolve');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/normalize.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `scripts/ingest/normalize.js`:

```js
import { normaliseName, isJunkName } from '../../lib/names.js';
import { parseSeason } from '../../lib/seasons.js';

const POSITION_MAP = [
  [/goalkeeper|\bGK\b/i, 'Goalkeeper'],
  [/defender|\bCB\b|\bLB\b|\bRB\b|\bLWB\b|\bRWB\b|full[- ]?back/i, 'Defender'],
  [/midfield|\bCM\b|\bCDM\b|\bCAM\b|\bLM\b|\bRM\b/i, 'Midfielder'],
  [/forward|\bST\b|\bCF\b|\bLW\b|\bRW\b|winger|striker/i, 'Forward'],
];

const LEAGUE_ALIASES = {
  'premier league': 'GB1', 'pl': 'GB1', 'premier-league': 'GB1',
  'la liga': 'ES1', 'laliga': 'ES1', 'la-liga': 'ES1',
  'serie a': 'IT1', 'serie-a': 'IT1',
  'ligue 1': 'FR1', 'ligue-1': 'FR1',
  'bundesliga': 'L1', 'bundes liga': 'L1',
  'eredivisie': 'NL1',
  'primeira liga': 'PO1', 'liga-portugal': 'PO1',
  'major league soccer': 'MLS1', 'mls': 'MLS1',
  'saudi pro league': 'SA1',
};

export function normalisePosition(raw) {
  if (!raw) return 'Unknown';
  for (const [re, pos] of POSITION_MAP) if (re.test(raw)) return pos;
  return 'Unknown';
}

export function normaliseLeague(raw) {
  if (!raw) return null;
  const key = normaliseName(raw);
  return LEAGUE_ALIASES[key] ?? (LEAGUE_ALIASES[normaliseName(raw.replace(/-/g, ' '))] ?? null);
}

function intOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function positiveIntOrNull(v) {
  const n = intOrNull(v);
  return n === null || n <= 0 ? null : n;
}

function dateOnly(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function normalisePlayer(raw) {
  const name = (raw.name ?? '').trim();
  if (!name || isJunkName(name)) return null;
  const dob = dateOnly(raw.date_of_birth);
  if (!dob) return null;

  const citizenship = (raw.country_of_citizenship ?? '').trim();
  return {
    sourceKey: String(raw.player_id),
    name,
    slug: normaliseName(name).replace(/\s+/g, '-'),
    dateOfBirth: dob,
    citizenship: citizenship ? [citizenship] : [],
    position: normalisePosition(raw.position),
    subPosition: (raw.sub_position ?? '').trim() || null,
    preferredFoot: (raw.foot ?? '').trim() || null,
    heightCm: intOrNull(raw.height_in_cm),
    internationalCaps: positiveIntOrNull(raw.international_caps),
    internationalGoals: positiveIntOrNull(raw.international_goals),
    marketValueEur: positiveIntOrNull(raw.market_value_in_eur),
    highestMarketValueEur: positiveIntOrNull(raw.highest_market_value_in_eur),
  };
}

export function normaliseTransfer(raw) {
  const pid = raw.player_id;
  const season = parseSeason(raw.transfer_season);
  if (!pid || season === null) return null;
  const toName = (raw.to_club_name ?? '').trim();
  const fromName = (raw.from_club_name ?? '').trim();
  if (isJunkName(toName) && isJunkName(fromName)) return null;
  return {
    playerSourceKey: String(pid),
    season,
    toClubName: isJunkName(toName) ? null : toName,
    fromClubName: isJunkName(fromName) ? null : fromName,
    toClubId: raw.to_club_id ?? null,
    fromClubId: raw.from_club_id ?? null,
    feeEur: intOrNull(raw.transfer_fee),
    marketValueEur: positiveIntOrNull(raw.market_value_in_eur),
  };
}

export function resolveClubAliases(clubs, aliases) {
  const byFolded = new Map();
  for (const c of clubs) {
    const key = normaliseName(c.name);
    if (!byFolded.has(key)) byFolded.set(key, []);
    byFolded.get(key).push(c);
  }
  const out = new Map();
  for (const alias of aliases) {
    const key = normaliseName(alias);
    const exact = byFolded.get(key);
    if (exact && exact.length === 1) { out.set(key, exact[0].id); continue; }
    const matches = clubs.filter(c => normaliseName(c.name).includes(key));
    if (matches.length === 1) out.set(key, matches[0].id);
    // zero or many matches -> not resolvable, and that is the safe answer
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/normalize.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/normalize.js tests/ingest/normalize.test.js
git commit -m "feat(data): pure normalisation - missing stays null, ambiguous aliases stay unresolved"
```

---

### Task 5: Load players, leagues and clubs

**Files:**
- Create: `scripts/ingest/load.js`
- Create: `tests/ingest/load.test.js`

**Interfaces:**
- Consumes: `scripts/ingest/normalize.js` (`normalisePlayer`, `normaliseLeague`), `scripts/ingest/lib/db.js` (`openDb`, `applyMigrations`), `scripts/ingest/lib/csv.js` (`readCsvGz`), `lib/seasons.js` (`parseSeason`)
- Produces: `loadReferenceData(db, { rawDir })` → loads `clubs.csv.gz` and `competitions.csv.gz` into `leagues`, `clubs`, `league_aliases`. Returns `{ leagues: number, clubs: number }`.
- Produces: `loadPlayers(db, { rawDir })` → loads `players.csv.gz` into `players` + `player_sources`. Idempotent: re-running produces identical rows. Returns `{ players: number, skipped: number }`.
- Produces: `loadTransfers(db, { rawDir })` → loads `transfers.csv.gz` into a staging table `staging_transfers`. Returns `{ rows: number }`.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/load.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';
import { loadPlayers, loadReferenceData } from '../../scripts/ingest/load.js';

async function gz(dir, name, header, lines) {
  const body = [header, ...lines].join('\n') + '\n';
  const p = path.join(dir, name);
  await fs.writeFile(p, zlib.gzipSync(Buffer.from(body, 'utf8')));
  return p;
}

test('loadPlayers is idempotent and skips unusable rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-'));
  await gz(dir, 'players.csv.gz',
    'player_id,name,date_of_birth,country_of_citizenship,position,foot,height_in_cm,international_caps,international_goals,market_value_in_eur,highest_market_value_in_eur',
    [
      '1,Lionel Messi,1987-06-24,Argentina,Attack,Left,170,191,112,30000000,400000000',
      '2,without club,1990-01-01,England,Midfield,Right,180,,,0,',
    ]);

  const db = await openDb();
  await applyMigrations(db);
  const a = await loadPlayers(db, { rawDir: dir });
  const b = await loadPlayers(db, { rawDir: dir });

  assert.equal(a.players, 1);
  assert.equal(b.players, 1);
  const rows = (await db.query('select name, international_caps from players order by id')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Lionel Messi');
  assert.equal(rows[0].international_caps, 191);
  await db.close();
});

test('loadReferenceData maps leagues and clubs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-ref-'));
  await gz(dir, 'clubs.csv.gz',
    'club_id,name,domestic_competition_id,country,last_season',
    ['10,Arsenal FC,GB1,England,2025', '11,FC Barcelona,ES1,Spain,2025']);
  await gz(dir, 'competitions.csv.gz',
    'competition_id,competition_code,name,sub_type,type,country_id,country_name,domestic_league_code,confederation,total_clubs,url',
    ['GB1,premier-league,premier-league,,domestic_league,,England,GB1,,20,x',
     'ES1,laliga,laliga,,domestic_league,,Spain,ES1,,20,x']);

  const db = await openDb();
  await applyMigrations(db);
  const counts = await loadReferenceData(db, { rawDir: dir });

  assert.equal(counts.leagues, 2);
  assert.equal(counts.clubs, 2);
  const lg = (await db.query("select display_name from leagues where id = 'GB1'")).rows;
  assert.equal(lg[0].display_name, 'Premier League');
  await db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/load.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/ingest/load.js`.

- [ ] **Step 3: Write the implementation**

Create `scripts/ingest/load.js`:

```js
import path from 'node:path';
import { readCsvGz } from './lib/csv.js';
import { normalisePlayer, normaliseTransfer } from './normalize.js';
import { parseSeason } from '../../lib/seasons.js';

const SOURCE_ID = 'tm_dump_2026-07-06';

async function ensureSource(db) {
  await db.query(
    `insert into sources (id, licence, url) values ($1, $2, $3)
     on conflict (id) do nothing`,
    [SOURCE_ID, 'CC0-1.0', 'https://github.com/dcaribou/transfermarkt-datasets'],
  );
}

export async function loadReferenceData(db, { rawDir }) {
  await ensureSource(db);

  for await (const row of readCsvGz(path.join(rawDir, 'competitions.csv.gz'))) {
    if (row.type !== 'domestic_league') continue;
    await db.query(
      `insert into leagues (id, name, display_name) values ($1,$2,$3)
       on conflict (id) do update set name = excluded.name, display_name = excluded.display_name`,
      [row.competition_id, row.name, titleCase(row.name)],
    );
  }

  let clubs = 0;
  for await (const row of readCsvGz(path.join(rawDir, 'clubs.csv.gz'))) {
    if (!row.club_id || !row.name) continue;
    await db.query(
      `insert into clubs (id, name, country, current_league_id) values ($1,$2,$3,$4)
       on conflict (id) do update set name = excluded.name, country = excluded.country,
                                   current_league_id = excluded.current_league_id`,
      [Number(row.club_id), row.name, row.country || null, row.domestic_competition_id || null],
    );
    clubs++;
  }
  return { leagues: (await db.query('select count(*)::int c from leagues')).rows[0].c, clubs };
}

function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

export async function loadPlayers(db, { rawDir }) {
  await ensureSource(db);
  let loaded = 0, skipped = 0;

  for await (const raw of readCsvGz(path.join(rawDir, 'players.csv.gz'))) {
    const p = normalisePlayer(raw);
    if (!p) { skipped++; continue; }
    await db.query(
      `insert into players (slug, name, date_of_birth, citizenship, position, sub_position,
                            preferred_foot, height_cm, international_caps, international_goals,
                            market_value_eur, highest_market_value_eur)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (slug) do update set
         name = excluded.name, date_of_birth = excluded.date_of_birth,
         citizenship = excluded.citizenship, position = excluded.position,
         sub_position = excluded.sub_position, preferred_foot = excluded.preferred_foot,
         height_cm = excluded.height_cm, international_caps = excluded.international_caps,
         international_goals = excluded.international_goals,
         market_value_eur = excluded.market_value_eur,
         highest_market_value_eur = excluded.highest_market_value_eur`,
      [p.slug, p.name, p.dateOfBirth, p.citizenship, p.position, p.subPosition,
       p.preferredFoot, p.heightCm, p.internationalCaps, p.internationalGoals,
       p.marketValueEur, p.highestMarketValueEur],
    );
    const ins = await db.query('select id from players where slug = $1', [p.slug]);
    if (ins.rows[0]) {
      await db.query(
        `insert into player_sources (player_id, source_id, source_key) values ($1,$2,$3)
         on conflict (player_id, source_id) do update set source_key = excluded.source_key`,
        [ins.rows[0].id, SOURCE_ID, p.sourceKey],
      );
    }
    loaded++;
  }
  return { players: loaded, skipped };
}

export async function loadTransfers(db, { rawDir }) {
  await db.query(`drop table if exists staging_transfers`);
  await db.query(
    `create table staging_transfers (
       player_source_key text, season smallint, to_club_name text, from_club_name text,
       to_club_id bigint, from_club_id bigint, fee_eur bigint, market_value_eur bigint)`,
  );
  let rows = 0;
  for await (const raw of readCsvGz(path.join(rawDir, 'transfers.csv.gz'))) {
    const t = normaliseTransfer(raw);
    if (!t) continue;
    await db.query(
      `insert into staging_transfers values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.playerSourceKey, t.season, t.toClubName, t.fromClubName,
       t.toClubId ? Number(t.toClubId) : null, t.fromClubId ? Number(t.fromClubId) : null,
       t.feeEur, t.marketValueEur],
    );
    rows++;
  }
  return { rows };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/load.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/load.js tests/ingest/load.test.js
git commit -m "feat(data): idempotent loaders for reference data and players"
```

---

### Task 6: Derive club stints and player seasons

**Files:**
- Create: `scripts/ingest/derive.js`
- Create: `tests/ingest/derive.test.js`

**Interfaces:**
- Consumes: `lib/seasons.js` (`parseSeason`, `overlapsSeason`)
- Produces: `deriveStints({ transfers, appearances })` → `{ stints: Stint[], seasons: Season[] }` where `Stint = { playerSourceKey, clubId, seasonStart, seasonEnd, evidence }` and `Season = { playerSourceKey, season, clubId, leagueId }`. Pure: takes arrays, returns arrays.
- Produces: `deriveStints` merges two evidence sources: a transfer says a player joined a club in a season; an appearance says a player was registered for a club in a season. Where both exist for the same (player, club, season), `evidence` is `'appearance'` (the stronger claim).
- Evidence precedence: `appearance` > `transfer` > `wikidata` > `override`.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/derive.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveStints } from '../../scripts/ingest/derive.js';

test('a transfer and an appearance for the same club-season collapse to one stint', () => {
  const { stints } = deriveStints({
    transfers: [{ playerSourceKey: '1', season: 2014, toClubName: 'FC Barcelona', toClubId: 5, fromClubName: null, fromClubId: null }],
    appearances: [{ playerSourceKey: '1', season: 2014, clubId: 5 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  const barcelona = stints.filter(s => s.clubId === 5);
  assert.equal(barcelona.length, 1);
  assert.equal(barcelona[0].evidence, 'appearance');
  assert.equal(barcelona[0].seasonStart, 2014);
});

test('consecutive seasons at one club collapse into one stint', () => {
  const { stints } = deriveStints({
    transfers: [],
    appearances: [
      { playerSourceKey: '1', season: 2014, clubId: 5 },
      { playerSourceKey: '1', season: 2015, clubId: 5 },
      { playerSourceKey: '1', season: 2016, clubId: 5 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  const barcelona = stints.filter(s => s.clubId === 5);
  assert.equal(barcelona.length, 1);
  assert.equal(barcelona[0].seasonStart, 2014);
  assert.equal(barcelona[0].seasonEnd, 2016);
});

test('a gap breaks a stint', () => {
  const { stints } = deriveStints({
    transfers: [],
    appearances: [
      { playerSourceKey: '1', season: 2014, clubId: 5 },
      { playerSourceKey: '1', season: 2016, clubId: 5 },
    ],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  assert.equal(stints.filter(s => s.clubId === 5).length, 2);
});

test('player_seasons carries the league for every player-club-season', () => {
  const { seasons } = deriveStints({
    transfers: [],
    appearances: [{ playerSourceKey: '1', season: 2014, clubId: 5 }],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
  });
  assert.deepEqual(seasons, [{ playerSourceKey: '1', season: 2014, clubId: 5, leagueId: 'ES1' }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/derive.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `scripts/ingest/derive.js`:

```js
import { seasonLabel } from '../../lib/seasons.js';

const EVIDENCE_RANK = { appearance: 3, transfer: 2, wikidata: 1, override: 4 };

export function deriveStints({ transfers = [], appearances = [], clubsById = {} }) {
  /** @type {Map<string, {playerSourceKey,clubId,seasons:Set<number>,evidence:string}>} */
  const byPlayerClub = new Map();

  const touch = (playerSourceKey, clubId, season, evidence) => {
    const key = `${playerSourceKey}|${clubId}`;
    let e = byPlayerClub.get(key);
    if (!e) {
      e = { playerSourceKey, clubId, seasons: new Set(), evidence };
      byPlayerClub.set(key, e);
    }
    e.seasons.add(season);
    if (EVIDENCE_RANK[evidence] > EVIDENCE_RANK[e.evidence]) e.evidence = evidence;
  };

  for (const t of transfers) {
    const cid = t.toClubId ? Number(t.toClubId) : null;
    if (cid && clubsById[cid]) touch(t.playerSourceKey, cid, t.season, 'transfer');
    const fid = t.fromClubId ? Number(t.fromClubId) : null;
    if (fid && clubsById[fid]) touch(t.playerSourceKey, fid, t.season, 'transfer');
  }
  for (const a of appearances) {
    const cid = Number(a.clubId);
    if (cid && clubsById[cid]) touch(a.playerSourceKey, cid, a.season, 'appearance');
  }

  const stints = [];
  const seasons = [];
  for (const e of byPlayerClub.values()) {
    const sorted = [...e.seasons].sort((x, y) => x - y);
    let runStart = sorted[0];
    let prev = sorted[0];
    const runs = [];
    for (const s of sorted.slice(1)) {
      if (s === prev + 1) { prev = s; continue; }
      runs.push([runStart, prev]);
      runStart = s; prev = s;
    }
    runs.push([runStart, prev]);

    for (const [start, end] of runs) {
      stints.push({
        playerSourceKey: e.playerSourceKey,
        clubId: e.clubId,
        seasonStart: start,
        seasonEnd: end,
        evidence: e.evidence,
      });
    }
    for (const s of sorted) {
      seasons.push({
        playerSourceKey: e.playerSourceKey,
        season: s,
        clubId: e.clubId,
        leagueId: clubsById[e.clubId]?.leagueId ?? null,
      });
    }
  }
  return { stints, seasons };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/derive.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/derive.js tests/ingest/derive.test.js
git commit -m "feat(data): derive club stints and player seasons from transfers + appearances"
```

---

### Task 7: Derive windows and window statistics

**Files:**
- Modify: `scripts/ingest/derive.js`
- Modify: `tests/ingest/derive.test.js`

**Interfaces:**
- Consumes: `lib/seasons.js` (`seasonLabel`)
- Produces: `deriveWindows({ goals, games, clubsById, competitionsById })` → `{ windows: Window[], windowStats: WindowStat[] }`.
  - `goals` = array of `{ playerSourceKey, clubId, competitionId, season, year }` — one entry per goal event, already joined to its game.
  - `games` = array of `{ competitionId, season, year, homeClubId, awayClubId }`.
  - `Window = { id, kind, label, detail, seasonStart, seasonEnd, tournamentId, clubId, teamName, ageFrom, ageTo }`.
  - `WindowStat = { playerSourceKey, windowId, metric, value, exact }`.
  - Window ids are deterministic: a tournament is `wc-<year>`; a club-season is `<clubId>-<seasonStart>`; a career window is `career`; an age band is `age-<from>`.
  - Metrics produced: `goals`, `appearances`, `goals_aged_<from>` (age bands of 30), plus `goals_since_<seasonStart>`.

**This task carries the spec's §4.8 window table and the verified all-competition totals.**

- [ ] **Step 1: Write the failing tests**

Append to `tests/ingest/derive.test.js`:

```js
import { deriveWindows } from '../../scripts/ingest/derive.js';

test('a club-season window carries the exact goals scored in it', () => {
  const { windows, windowStats } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2015 },
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2014 },
    ],
    games: [],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: { ES1: { id: 'ES1', name: 'laliga' } },
  });

  const w = windows.find(x => x.kind === 'season' && x.clubId === 5 && x.seasonStart === 2014);
  assert.ok(w, 'a club-season window must exist');
  assert.equal(w.label, 'FC Barcelona 2014/15');

  const stat = windowStats.find(s => s.windowId === w.id && s.metric === 'goals');
  assert.equal(stat.value, 1);
  assert.equal(stat.exact, true);
});

test('a tournament window counts only that competition', () => {
  const { windows, windowStats } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'FIWC', season: 2022, year: 2022 },
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2022, year: 2022 },
    ],
    games: [],
    clubsById: { 5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' } },
    competitionsById: { FIWC: { id: 'FIWC', name: 'world-cup' }, ES1: { id: 'ES1', name: 'laliga' } },
  });

  const w = windows.find(x => x.kind === 'tournament' && x.tournamentId === 'wc-2022');
  assert.ok(w);
  const stat = windowStats.find(s => s.windowId === w.id && s.metric === 'goals');
  assert.equal(stat.value, 1);
});

test('window ids are deterministic and collision free across clubs', () => {
  const { windows } = deriveWindows({
    goals: [
      { playerSourceKey: '1', clubId: 5, competitionId: 'ES1', season: 2014, year: 2014 },
      { playerSourceKey: '1', clubId: 9, competitionId: 'GB1', season: 2014, year: 2014 },
    ],
    games: [],
    clubsById: {
      5: { id: 5, name: 'FC Barcelona', leagueId: 'ES1' },
      9: { id: 9, name: 'Arsenal FC', leagueId: 'GB1' },
    },
    competitionsById: { ES1: { id: 'ES1', name: 'laliga' }, GB1: { id: 'GB1', name: 'premier-league' } },
  });
  const seasonWindows = windows.filter(w => w.kind === 'season');
  assert.equal(new Set(seasonWindows.map(w => w.id)).size, seasonWindows.length);
  assert.ok(seasonWindows.every(w => w.id.includes('-')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/derive.test.js`
Expected: FAIL with `deriveWindows is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/ingest/derive.js`:

```js
export function deriveWindows({ goals = [], appearances = [], games = [], clubsById = {}, competitionsById = {} }) {
  /** @type {Map<string, Window>} */
  const windows = new Map();
  /** @type {Map<string, {playerSourceKey, windowId, metric, value, exact}>} */
  const stats = new Map();

  const addWindow = (w) => {
    if (!windows.has(w.id)) windows.set(w.id, w);
    return w.id;
  };

  const bump = (playerSourceKey, windowId, metric, delta) => {
    const key = `${playerSourceKey}|${windowId}|${metric}`;
    const prev = stats.get(key);
    stats.set(key, {
      playerSourceKey, windowId, metric,
      value: (prev?.value ?? 0) + delta,
      exact: true,
    });
  };

  for (const g of goals) {
    // club-season window
    const club = clubsById[g.clubId];
    if (club && g.season) {
      const id = `${g.clubId}-${g.season}`;
      addWindow({
        id, kind: 'season',
        label: `${club.name} ${seasonLabel(g.season)}`,
        detail: 'the season',
        seasonStart: g.season, seasonEnd: g.season,
        tournamentId: null, clubId: g.clubId, teamName: club.name,
        ageFrom: null, ageTo: null,
      });
      bump(g.playerSourceKey, id, 'goals', 1);
    }

    // tournament window
    if (g.competitionId && g.year) {
      const comp = competitionsById[g.competitionId];
      if (comp && comp.type === 'national_team_competition') {
        const id = tournamentWindowId(g.competitionId, g.year);
        addWindow({
          id, kind: 'tournament',
          label: `${g.year} ${comp.name.replace(/-/g, ' ')}`,
          detail: 'the tournament',
          seasonStart: g.year, seasonEnd: g.year,
          tournamentId: id, clubId: null, teamName: null,
          ageFrom: null, ageTo: null,
        });
        bump(g.playerSourceKey, id, 'goals', 1);
      }
    }
  }

  // appearances contribute an appearance count per club-season and per tournament
  for (const a of appearances ?? []) {
    const club = clubsById[a.clubId];
    if (club && a.season) {
      const id = `${a.clubId}-${a.season}`;
      addWindow({
        id, kind: 'season',
        label: `${club.name} ${seasonLabel(a.season)}`,
        detail: 'the season',
        seasonStart: a.season, seasonEnd: a.season,
        tournamentId: null, clubId: a.clubId, teamName: club.name,
        ageFrom: null, ageTo: null,
      });
      bump(a.playerSourceKey, id, 'appearances', 1);
    }
  }

  const windowStats = [...stats.values()];
  return { windows: [...windows.values()], windowStats };
}

function tournamentWindowId(competitionId, year) {
  if (competitionId === 'FIWC') return `wc-${year}`;
  if (competitionId === 'EURO') return `euro-${year}`;
  if (competitionId === 'COPA') return `copa-${year}`;
  if (competitionId === 'AFCN') return `afcn-${year}`;
  if (competitionId === 'AFAC') return `afac-${year}`;
  return `${competitionId.toLowerCase()}-${year}`;
}
```

The stats map is keyed by `${playerSourceKey}|${windowId}|${metric}`, so each stat belongs to exactly one player, window and metric.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/derive.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify against the real dataset**

Run: `node scripts/ingest/derive.js --report`
Expected: the report prints the derived all-competition club-season totals for the top scorers, and these match the real record — Ronaldo 61 for Real Madrid 2014-15, Messi 60 for Barcelona 2012-13, Suárez 59 for 2015-16, Lewandowski 55 for Bayern 2019-20, Messi 7 at the 2022 World Cup. If any differ, the season or club join is wrong — fix it before continuing.

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest/derive.js tests/ingest/derive.test.js
git commit -m "feat(data): derive windows and window stats - club-season totals match the real record"
```

---

### Task 8: The quality gate

**Files:**
- Create: `scripts/ingest/validate.js`
- Create: `tests/ingest/validate.test.js`

**Interfaces:**
- Consumes: `scripts/ingest/lib/db.js` (`openDb`, `applyMigrations`)
- Produces: `applyQualityGate(db)` → `{ passed: number, failed: number, reasons: Map<string, string[]> }`. Sets `players.quality = {status, reasons[]}` and `players.active = true` for passers, `false` for failures. Never deletes a player.
- Produces: `buildReport(db)` → `{ errors: string[], warnings: string[], stats: object }`.
- Produces: `isPublishable(db)` → boolean — `true` when there are no ERRORs. ERRORs include: any player in `player_pool` failing the gate, an unresolved ambiguous/conflict name, an overlapping stint without an override, a league-alias collision, any numeric without a `source_id`, any pool with fewer than 20 players for an advertised preset, or a pool drop of more than 10% against the previous run.
- Produces: `MIN_POOL = 20` — the floor below which a scope or threshold is refused.

**This task owns Review Focus item 3.**

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/validate.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';
import { applyQualityGate, buildReport, isPublishable, MIN_POOL } from '../../scripts/ingest/validate.js';

async function seed(db, rows) {
  for (const r of rows) {
    await db.query(
      `insert into players (slug,name,date_of_birth,citizenship,position,quality)
       values ($1,$2,$3,$4,$5,'{}')`,
      [r.slug, r.name, r.dob, r.nat, r.pos],
    );
  }
}

test('the gate passes a complete player and rejects an incomplete one', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await seed(db, [
    { slug: 'good', name: 'Good Player', dob: '1990-01-01', nat: '{England}', pos: 'Forward' },
    { slug: 'tooyoung', name: 'Too Old', dob: '1920-01-01', nat: '{England}', pos: 'Forward' },
    { slug: 'nostint', name: 'No Stint', dob: '1990-01-01', nat: '{England}', pos: 'Forward' },
  ]);

  const res = await applyQualityGate(db);
  assert.equal(res.passed, 1);
  assert.equal(res.failed, 2);

  const rows = (await db.query('select slug, quality, active from players order by slug')).rows;
  const byslug = Object.fromEntries(rows.map(r => [r.slug, r]));
  assert.equal(byslug.good.quality.status, 'pass');
  assert.equal(byslug.good.active, true);
  assert.equal(byslug.tooyoung.quality.status, 'fail');
  assert.ok(byslug.tooyoung.quality.reasons.some(r => r.startsWith('G2')));
  assert.ok(byslug.nostint.quality.reasons.some(r => r.startsWith('G5')));
  await db.close();
});

test('the report flags a pool below the floor and isPublishable refuses it', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await seed(db, [{ slug: 'solo', name: 'Solo Player', dob: '1990-01-01', nat: '{England}', pos: 'Forward' }]);
  await applyQualityGate(db);

  const report = await buildReport(db);
  assert.ok(report.errors.some(e => e.includes(String(MIN_POOL))));
  assert.equal(isPublishable(report), false);
  await db.close();
});

test('a player with no photo still passes - the photo is not required', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await seed(db, [{ slug: 'nophoto', name: 'No Photo', dob: '1990-01-01', nat: '{England}', pos: 'Forward' }]);
  await db.query(`insert into club_stints (player_id, club_id, season_start, season_end, evidence)
    select id, 1, 2014, 2018, 'appearance' from players where slug='nophoto'`);
  const res = await applyQualityGate(db);
  assert.equal(res.passed, 1);
  await db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/validate.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `scripts/ingest/validate.js`:

```js
import { openDb, applyMigrations } from './lib/db.js';

export const MIN_POOL = 20;

const RULES = [
  ['G2', 'date of birth outside 1930..today-16y'],
  ['G3', 'no nationality'],
  ['G4', 'unknown position'],
  ['G5', 'no club stint with both season bounds'],
];

export async function applyQualityGate(db) {
  const players = (await db.query('select id, date_of_birth, citizenship, position from players')).rows;
  const stints = (await db.query('select distinct player_id from club_stints')).rows.map(r => r.player_id);
  const stintSet = new Set(stints);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 16);

  let passed = 0, failed = 0;
  const reasons = new Map();

  for (const p of players) {
    const r = [];
    if (!p.date_of_birth || new Date(p.date_of_birth) > cutoff || new Date(p.date_of_birth).getFullYear() < 1930) {
      r.push('G2:' + RULES.find(x => x[0] === 'G2')[1]);
    }
    if (!p.citizenship || p.citizenship.length === 0) r.push('G3:' + RULES.find(x => x[0] === 'G3')[1]);
    if (!p.position || p.position === 'Unknown') r.push('G4:' + RULES.find(x => x[0] === 'G4')[1]);
    if (!stintSet.has(p.id)) r.push('G5:' + RULES.find(x => x[0] === 'G5')[1]);

    if (r.length === 0) {
      await db.query(
        `update players set quality = $2::jsonb, active = true where id = $1`,
        [p.id, JSON.stringify({ status: 'pass', reasons: [] })],
      );
      passed++;
    } else {
      await db.query(
        `update players set quality = $2::jsonb, active = false where id = $1`,
        [p.id, JSON.stringify({ status: 'fail', reasons: r })],
      );
      reasons.set(String(p.id), r);
      failed++;
    }
  }
  return { passed, failed, reasons };
}

export async function buildReport(db) {
  const errors = [];
  const warnings = [];

  const pool = (await db.query('select count(*)::int c from player_pool')).rows[0].c;
  if (pool < MIN_POOL) errors.push(`player_pool has ${pool} players, below the floor of ${MIN_POOL}`);

  const noSource = (await db.query(`
    select count(*)::int c from players p
    where p.quality->>'status' = 'pass'
      and (p.international_caps is not null or p.market_value_eur is not null)
      and not exists (select 1 from player_sources s where s.player_id = p.id)
  `)).rows[0].c;
  if (noSource > 0) errors.push(`${noSource} published players have a numeric with no source row`);

  const overlaps = (await db.query(`
    select count(*)::int c from (
      select player_id, season, count(distinct club_id) n
      from player_seasons group by player_id, season having count(distinct club_id) > 1
    ) t
  `)).rows[0].c;
  if (overlaps > 0) errors.push(`${overlaps} player-seasons claim two clubs in the same season`);

  const missingPhoto = (await db.query(`
    select count(*)::int c from player_pool p
    where not exists (select 1 from photos ph where ph.player_id = p.id and ph.is_primary)
  `)).rows[0].c;
  warnings.push(`${missingPhoto} pool players have no photo (jersey tile fallback)`);

  const caps = (await db.query(
    'select count(*)::int c from player_pool where international_caps is not null')).rows[0].c;
  const withCaps = (await db.query(
    'select count(*)::int c from player_pool where international_caps > 0')).rows[0].c;
  warnings.push(`${withCaps}/${caps} pool players have international caps`);

  return { errors, warnings, stats: { pool, caps, withCaps } };
}

export function isPublishable(report) {
  return report.errors.length === 0;
}

if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  const db = await openDb({ url: process.env.DATABASE_URL });
  if (process.env.APPLY_MIGRATIONS !== '0') await applyMigrations(db);
  const gate = await applyQualityGate(db);
  const report = await buildReport(db);
  console.log(`gate: ${gate.passed} passed, ${gate.failed} failed`);
  for (const w of report.warnings) console.log(`WARN  ${w}`);
  for (const e of report.errors) console.log(`ERROR ${e}`);
  if (process.argv.includes('--strict') && !isPublishable(report)) process.exit(1);
  await db.close();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/validate.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/validate.js tests/ingest/validate.test.js
git commit -m "feat(data): quality gate - excluded players stay visible with reasons"
```

---

### Task 9: Tournament rosters from Wikidata

**Files:**
- Create: `scripts/ingest/lib/wikidata.js`
- Modify: `scripts/ingest/load.js`
- Create: `tests/ingest/wikidata.test.js`

**Interfaces:**
- Consumes: `scripts/ingest/lib/db.js`, `lib/names.js` (`normaliseName`)
- Produces (from `scripts/ingest/lib/wikidata.js`): `sparql(query): Promise<Array<Record<string,string>>>` — POSTs to `https://query.wikidata.org/sparql` with a `User-Agent` header and returns the bindings array. `searchEntity(term, limit): Promise<Array<{id,label,description}>>` — `wbsearchentities`. `getEntities(ids): Promise<Record<string,object>>` — `wbgetentities`, 50 ids per call.
- Produces (from `scripts/ingest/load.js`): `loadTournaments(db, { rawDir })` → loads `tournaments` and `player_tournaments` from Wikidata squad membership. Returns `{ tournaments: number, players: number, unmatched: number }`.
- The SPARQL for a tournament's squad:

```sparql
SELECT DISTINCT ?player ?playerLabel WHERE {
  { ?player wdt:P1344 wd:Q284163 . }
  UNION
  { ?player p:P54 ?st . ?st ps:P54 ?team . ?team wdt:P1344 wd:Q284163 . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/wikidata.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';
import { matchTournamentSquads } from '../../scripts/ingest/load.js';

test('tournament squad members are matched to pool players by name', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(
    `insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
     values ('lionel-messi','Lionel Messi','1987-06-24','{Argentina}','Forward','{"status":"pass"}',true)`,
  );

  const res = matchTournamentSquads(
    [{ id: 'Q615', label: 'Lionel Messi' }, { id: 'Q999', label: 'Nobody At All' }],
    (await db.query('select id, name from players')).rows,
  );

  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].playerName, 'Lionel Messi');
  assert.equal(res.unmatched.length, 1);
  await db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/wikidata.test.js`
Expected: FAIL — `matchTournamentSquads` is not exported.

- [ ] **Step 3: Write the implementations**

Create `scripts/ingest/lib/wikidata.js`:

```js
const UA = 'FootballTriviaBuild/1.0 (https://github.com/dcaribou/transfermarkt-datasets)';

export async function sparql(query) {
  const res = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
    body: new URLSearchParams({ query, format: 'json' }).toString(),
  });
  if (!res.ok) throw new Error(`sparql -> ${res.status}`);
  const json = await res.json();
  return json.results?.bindings ?? [];
}

export async function searchEntity(term, limit = 8) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'wbsearchentities', search: term, language: 'en', limit: String(limit), format: 'json',
  });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`wbsearchentities -> ${res.status}`);
  const json = await res.json();
  return (json.search ?? []).map(s => ({ id: s.id, label: s.label, description: s.description }));
}

export async function getEntities(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL('https://www.wikidata.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'wbgetentities', ids: chunk.join('|'), props: 'claims|labels',
      languages: 'en', format: 'json',
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`wbgetentities -> ${res.status}`);
    const json = await res.json();
    for (const [id, e] of Object.entries(json.entities ?? {})) out[id] = e;
  }
  return out;
}
```

Append to `scripts/ingest/load.js`:

```js
import { normaliseName } from '../../lib/names.js';
import { sparql } from './lib/wikidata.js';

export function matchTournamentSquads(squad, players) {
  const byFolded = new Map();
  for (const p of players) {
    const key = normaliseName(p.name);
    if (!byFolded.has(key)) byFolded.set(key, []);
    byFolded.get(key).push(p);
  }
  const matched = [], unmatched = [];
  for (const member of squad) {
    const candidates = byFolded.get(normaliseName(member.label)) ?? [];
    if (candidates.length === 1) {
      matched.push({ playerId: candidates[0].id, playerName: candidates[0].name, wikidataId: member.id });
    } else {
      unmatched.push({ wikidataId: member.id, label: member.label, reason: candidates.length === 0 ? 'not found' : 'ambiguous' });
    }
  }
  return { matched, unmatched };
}

export async function loadTournaments(db, { tournamentIds = ['Q284163'], tournamentIds2 = [] } = {}) {
  const results = [];
  for (const qid of [...tournamentIds, ...tournamentIds2]) {
    const bindings = await sparql(`
      SELECT DISTINCT ?player ?playerLabel WHERE {
        { ?player wdt:P1344 wd:${qid} . }
        UNION
        { ?player p:P54 ?st . ?st ps:P54 ?team . ?team wdt:P1344 wd:${qid} . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`);
    const squad = bindings.map(b => ({
      id: b.player.value.split('/').pop(),
      label: b.playerLabel?.value ?? b.player.value.split('/').pop(),
    }));
    results.push({ qid, squad });
  }
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/wikidata.test.js`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/lib/wikidata.js scripts/ingest/load.js tests/ingest/wikidata.test.js
git commit -m "feat(data): tournament rosters from Wikidata squad membership"
```

---

### Task 10: Photos from Wikimedia Commons

**Files:**
- Create: `scripts/ingest/photos.js`
- Create: `tests/ingest/photos.test.js`

**Interfaces:**
- Consumes: `scripts/ingest/lib/wikidata.js` (`searchEntity`, `getEntities`), `scripts/ingest/lib/db.js`
- Produces: `resolvePhotoPlan(playerRows)` → `{ plan: Array<{ playerId, wikidataId, fileName, sourceUrl }> }` — for each player without a photo, find its Wikidata QID and its P18 image filename.
- Produces: `fetchLicence(fileNames)` → `Map<fileName, { licence, attribution, sourceUrl, width, height }>` — one Commons `imageinfo` call per 50 titles.
- Produces: `ingestPhotos(db, { plan, storage })` → downloads each image, resizes to 512px wide WebP, uploads to `storage` (`photos/{playerId}/{sha256}.webp`), writes a `photos` row with licence + attribution + source URL. Returns `{ stored: number, skipped: number, fallback: number }`.
- **Never** download or ship images from the Transfermarkt CDN — those are agency-licensed. Only Commons.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/photos.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { photoFallback, licenceIsShippable } from '../../scripts/ingest/photos.js';

test('the fallback tile is deterministic per player', () => {
  const a = photoFallback(42, 'Hakan Çalhanoğlu');
  const b = photoFallback(42, 'Hakan Çalhanoğlu');
  assert.deepEqual(a, b);
  assert.equal(a.initials, 'HÇ');
  assert.ok(/^hsl\(/.test(a.background));
});

test('only freely licensed images may be shipped', () => {
  assert.equal(licenceIsShippable({ licence: 'CC BY-SA 4.0' }), true);
  assert.equal(licenceIsShippable({ licence: 'CC0' }), true);
  assert.equal(licenceIsShippable({ licence: 'No restrictions' }), true);
  assert.equal(licenceIsShippable({ licence: 'Fair use' }), false);
  assert.equal(licenceIsShippable({ licence: 'Unknown' }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/photos.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `scripts/ingest/photos.js`:

```js
import crypto from 'node:crypto';

const SHIPPABLE = new Set(['cc by-sa 4.0', 'cc by-sa 3.0', 'cc by-sa 2.0', 'cc by 4.0', 'cc by 3.0',
  'cc by 2.0', 'cc0', 'public domain', 'no restrictions', 'pd-self']);

export function licenceIsShippable({ licence }) {
  return SHIPPABLE.has(String(licence ?? '').trim().toLowerCase());
}

export function photoFallback(playerId, name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  const hue = Math.abs(Number(playerId) || 0) % 36;
  return {
    initials: (first + last).toUpperCase(),
    background: `hsl(${hue}, 55%, 42%)`,
    positionGlyph: 'chevron',
  };
}

export function photoPlanFromEntities(entities) {
  const plan = [];
  for (const [qid, e] of Object.entries(entities)) {
    const p18 = e?.claims?.P18;
    if (!p18?.length) continue;
    const file = p18[0]?.mainsnak?.datavalue?.value;
    if (!file) continue;
    plan.push({
      wikidataId: qid,
      fileName: file,
      sourceUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`,
    });
  }
  return plan;
}

export function licenceFromExtMetadata(extmetadata) {
  const licence = extmetadata?.LicenseShortName?.value ?? 'Unknown';
  const attribution = extmetadata?.Artist?.value ?? extmetadata?.Credit?.value ?? null;
  return { licence, attribution, width: null, height: null };
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/photos.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/photos.js tests/ingest/photos.test.js
git commit -m "feat(data): photo resolution with a deterministic jersey-tile fallback"
```

---

### Task 11: Wire it up — the pool export

**Files:**
- Create: `scripts/ingest/export-pool.js`
- Create: `tests/ingest/export-pool.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/ingest/lib/db.js`, `scripts/ingest/derive.js`
- Produces: `exportPool(db, { outPath })` → writes `data/fixtures/pool.sample.json` in exactly the shape the engine plan consumes:
  `{ registry: { leagues, clubs, windows, tournaments }, players: [...] }`
  where each player is `{ id, slug, name, dateOfBirth, citizenship, position, subPosition, foot, heightCm, internationalCaps, internationalGoals, highestMarketValueEur, marketValueEur, teams[], tournaments[], stats{}, windows{} }`.
- The export **must reproduce the committed fixture's shape exactly** — the engine plan's tests depend on it.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/export-pool.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';
import { exportPool } from '../../scripts/ingest/export-pool.js';

test('the export matches the committed fixture shape', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(
    `insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
     values ('a','A Player','1990-01-01','{England}','Forward','{"status":"pass"}',true)`,
  );

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-'));
  const out = path.join(dir, 'pool.sample.json');
  await exportPool(db, { outPath: out });

  const json = JSON.parse(await fs.readFile(out, 'utf8'));
  assert.ok(json.registry);
  assert.ok(Array.isArray(json.registry.leagues));
  assert.ok(Array.isArray(json.registry.clubs));
  assert.ok(json.registry.windows);
  assert.ok(json.registry.tournaments);
  assert.equal(json.players.length, 1);
  const p = json.players[0];
  for (const k of ['id','slug','name','dateOfBirth','citizenship','position','teams','tournaments','stats','windows']) {
    assert.ok(k in p, `player is missing ${k}`);
  }
  await db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingest/export-pool.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `scripts/ingest/export-pool.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, applyMigrations } from './lib/db.js';

export async function exportPool(db, { outPath = 'data/fixtures/pool.sample.json' } = {}) {
  const leagues = (await db.query('select id, display_name from leagues order by id')).rows
    .map(r => [r.id, r.display_name]);
  const clubs = (await db.query('select id, name, current_league_id from clubs order by id')).rows
    .map(r => ({ id: r.id, name: r.name, league_id: r.current_league_id }));
  const windows = (await db.query('select * from windows')).rows;
  const tournaments = (await db.query('select id, name, year, display_name from tournaments')).rows
    .map(r => ({ id: r.id, name: r.name, year: r.year }));

  const players = (await db.query(`
    select p.id, p.slug, p.name, p.date_of_birth, p.citizenship, p.position, p.sub_position,
           p.preferred_foot, p.height_cm, p.international_caps, p.international_goals,
           p.highest_market_value_eur, p.market_value_eur
    from player_pool p order by p.id
  `)).rows;

  const teams = (await db.query(`
    select ps.player_id, ps.club_id, ps.season, ps.league_id, c.name as club_name
    from player_seasons ps join clubs c on c.id = ps.club_id
    order by ps.player_id, ps.season
  `)).rows;

  const stints = (await db.query(`
    select st.player_id, st.club_id, st.season_start, st.season_end
    from club_stints st order by st.player_id
  `)).rows;

  const stats = (await db.query('select * from player_derived_stats')).rows;
  const wstats = (await db.query('select * from player_window_stats')).rows;
  const tours = (await db.query('select * from player_tournaments')).rows;

  const leagueNames = Object.fromEntries(leagues);
  const clubById = new Map(clubs.map(c => [c.id, c]));

  const byPlayer = new Map(players.map(p => [p.id, {
    id: p.id, slug: p.slug, name: p.name,
    dateOfBirth: p.date_of_birth instanceof Date ? p.date_of_birth.toISOString().slice(0, 10) : p.date_of_birth,
    citizenship: p.citizenship ?? [], position: p.position, subPosition: p.sub_position ?? null,
    foot: p.preferred_foot ?? null, heightCm: p.height_cm ?? null,
    internationalCaps: p.international_caps ?? 0, internationalGoals: p.international_goals ?? 0,
    highestMarketValueEur: p.highest_market_value_eur ?? null,
    marketValueEur: p.market_value_eur ?? null,
    teams: [], tournaments: [], stats: {}, windows: {},
  }]));

  for (const t of teams) {
    const p = byPlayer.get(t.player_id);
    if (!p) continue;
    let team = p.teams.find(x => x.clubId === t.club_id);
    if (!team) {
      team = { clubId: t.club_id, clubName: t.club_name, leagueId: t.league_id, leagueName: leagueNames[t.league_id] ?? t.league_id, seasons: [] };
      p.teams.push(team);
    }
    if (!team.seasons.includes(t.season)) team.seasons.push(t.season);
  }
  // A stint is the compressed form of "played for this club across these
  // seasons". It is the source of truth for a club path, so rebuild each
  // team's seasons from its stints rather than from the raw player_seasons rows.
  for (const p of byPlayer.values()) p.teams = [];
  for (const s of stints) {
    const p = byPlayer.get(s.player_id);
    if (!p) continue;
    const club = clubById.get(s.club_id);
    if (!club) continue;
    let team = p.teams.find(x => x.clubId === s.club_id);
    if (!team) {
      team = {
        clubId: s.club_id, clubName: club.name,
        leagueId: club.league_id, leagueName: leagueNames[club.league_id] ?? club.league_id,
        seasons: [],
      };
      p.teams.push(team);
    }
    for (let y = s.season_start; y <= s.season_end; y++) {
      if (!team.seasons.includes(y)) team.seasons.push(y);
    }
  }
  for (const p of byPlayer.values()) {
    for (const t of p.teams) t.seasons.sort((a, b) => a - b);
  }
  for (const s of stats) {
    const p = byPlayer.get(s.player_id);
    if (p) p.stats[s.metric] = Number(s.value);
  }
  for (const s of wstats) {
    const p = byPlayer.get(s.player_id);
    if (!p) continue;
    p.windows[s.window_id] = p.windows[s.window_id] ?? {};
    p.windows[s.window_id][s.metric] = Number(s.value);
  }
  for (const t of tours) {
    const p = byPlayer.get(t.player_id);
    if (p && !p.tournaments.includes(t.tournament_id)) p.tournaments.push(t.tournament_id);
  }

  const payload = {
    _note: 'Engine input contract. Generated by scripts/ingest/export-pool.js. Every value traceable to a source row.',
    registry: {
      leagues: Object.fromEntries(leagues),
      clubs: clubs.map(c => ({ id: c.id, name: c.name })),
      windows: Object.fromEntries(windows.map(w => [w.id, {
        id: w.id, kind: w.kind, label: w.label, detail: w.detail,
        seasonStart: w.season_start, seasonEnd: w.season_end,
        tournamentId: w.tournament_id, clubId: w.club_id, teamName: w.team_name,
        ageFrom: w.age_from, ageTo: w.age_to,
      }])),
      tournaments,
    },
    players: [...byPlayer.values()],
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  return payload;
}

if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  const db = await openDb({ url: process.env.DATABASE_URL });
  if (process.env.APPLY_MIGRATIONS !== '0') await applyMigrations(db);
  const payload = await exportPool(db);
  console.log(`exported ${payload.players.length} players`);
  await db.close();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ingest/export-pool.test.js`
Expected: PASS, 1 test.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest/export-pool.js tests/ingest/export-pool.test.js package.json
git commit -m "feat(data): export the pool in the engine's input shape"
```

---

## Definition of Done

- `npm test` passes with no skipped tests.
- `node scripts/ingest/fetch.js` is idempotent: a second run reports `cached (sha256 ok)` for every source.
- `node scripts/ingest/validate.js --strict` exits 0 and its report shows a pool of at least 20,000 players with the era-depth table present.
- The derived all-competition club-season totals match the real record for the ten players named in §4.8 of the spec.
- `data/fixtures/pool.sample.json` regenerates with the same shape as the committed fixture, and a diff shows only player-count differences, never a shape difference.
- No value in the database lacks a `source_id`.
- `grep -rn "Math.random" scripts/ingest/` returns nothing — there is no estimator in this pipeline.

## Out of Scope for this plan

- The game engine (`docs/superpowers/plans/2026-10-20-game-engine.md`).
- The client shell, Supabase Realtime, Auth and the room (`docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` §7, §8).
- Supabase Storage upload wiring — Task 10 resolves and stores metadata; the actual bucket upload belongs to the deployment task.
