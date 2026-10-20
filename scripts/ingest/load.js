// Loads the raw Transfermarkt snapshots into Postgres. Reference data first
// (leagues, then clubs, so the league FK holds), then players. Every loader is
// idempotent: re-running produces the same rows, never duplicates. A missing
// source value stays NULL - this file never invents one.
import path from 'node:path';
import crypto from 'node:crypto';
import { readCsvGz } from './lib/csv.js';
import { normalisePlayer, normaliseTransfer } from './normalize.js';
import { normaliseName } from '../../lib/names.js';
import { sparql, searchEntity, tournamentSquadQuery } from './lib/wikidata.js';

const SOURCE_ID = 'tm_dump_2026-07-06';

async function ensureSource(db) {
  await db.query(
    `insert into sources (id, licence, url) values ($1, $2, $3)
     on conflict (id) do nothing`,
    [SOURCE_ID, 'CC0-1.0', 'https://github.com/dcaribou/transfermarkt-datasets'],
  );
}

// The dump sets display names as slugs ('premier-league'). The seed already
// holds curated names ('La Liga'), so on conflict only the slug is refreshed.
function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

export async function loadReferenceData(db, { rawDir }) {
  await ensureSource(db);

  let leagues = 0;
  for await (const row of readCsvGz(path.join(rawDir, 'competitions.csv.gz'))) {
    if (row.type !== 'domestic_league' || !row.competition_id) continue;
    const display = titleCase(row.name);
    await db.query(
      `insert into leagues (id, name, display_name) values ($1,$2,$3)
       on conflict (id) do update set name = excluded.name`,
      [row.competition_id, row.name, display],
    );
    // The display name is also a resolvable alias, but never at the cost of a
    // curated alias the seed already holds.
    await db.query(
      `insert into league_aliases (alias, league_id) values ($1,$2) on conflict (alias) do nothing`,
      [display, row.competition_id],
    );
    leagues++;
  }

  let clubs = 0;
  for await (const row of readCsvGz(path.join(rawDir, 'clubs.csv.gz'))) {
    if (!row.club_id || !row.name) continue;
    // A club's competition id is not always a league we hold (the real dump has
    // 20 clubs in COL1, which no competition row defines). A dangling FK would
    // abort the load, so an unheld league is null: no club is ever dropped.
    const leagueId = (await db.query('select 1 from leagues where id = $1', [row.domestic_competition_id])).rows.length
      ? row.domestic_competition_id : null;
    await db.query(
      `insert into clubs (id, name, country, current_league_id) values ($1,$2,$3,$4)
       on conflict (id) do update set name = excluded.name, country = excluded.country,
                                   current_league_id = excluded.current_league_id`,
      [Number(row.club_id), row.name, row.country || null, leagueId],
    );
    clubs++;
  }
  // clubs.id is bigserial but we insert the TM club id explicitly, so the
  // sequence would hand out a colliding id to any later id-less insert.
  await db.query(`select setval(pg_get_serial_sequence('clubs', 'id'),
                               coalesce((select max(id) from clubs), 1))`);
  return { leagues, clubs };
}

// The slug is derived from the player's name, so two real footballers can share
// one ("Rafael Silva", born 1993-05-05). A slug must identify a player, not a
// name, so a collision is disambiguated by a suffix derived from the source key:
// deterministic, stable across runs, and never overwriting a real player.
function suffixFor(sourceKey) {
  return crypto.createHash('sha1').update(String(sourceKey)).digest('hex').slice(0, 4);
}

export async function loadPlayers(db, { rawDir }) {
  await ensureSource(db);
  let loaded = 0, skipped = 0;

  for await (const raw of readCsvGz(path.join(rawDir, 'players.csv.gz'))) {
    const p = normalisePlayer(raw);
    if (!p) { skipped++; continue; }

    // The source key is the player's identity: a row we have already loaded is
    // the same player and must be updated, not inserted a second time.
    const known = (await db.query(
      `select p.id from player_sources s join players p on p.id = s.player_id
       where s.source_id = $1 and s.source_key = $2`,
      [SOURCE_ID, p.sourceKey],
    )).rows[0];

    let playerId = known?.id;
    if (playerId === undefined) {
      const slug = await freeSlug(db, p.slug, p.sourceKey);
      const { rows } = await db.query(
        `insert into players (slug, name, date_of_birth, citizenship, position, sub_position,
                              preferred_foot, height_cm, international_caps, international_goals,
                              market_value_eur, highest_market_value_eur)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning id`,
        [slug, p.name, p.dateOfBirth, p.citizenship, p.position, p.subPosition,
         p.preferredFoot, p.heightCm, p.internationalCaps, p.internationalGoals,
         p.marketValueEur, p.highestMarketValueEur],
      );
      playerId = rows[0].id;
    } else {
      await db.query(
        `update players set
           name = $2, date_of_birth = $3, citizenship = $4, position = $5, sub_position = $6,
           preferred_foot = $7, height_cm = $8, international_caps = $9, international_goals = $10,
           market_value_eur = $11, highest_market_value_eur = $12
         where id = $1`,
        [playerId, p.name, p.dateOfBirth, p.citizenship, p.position, p.subPosition,
         p.preferredFoot, p.heightCm, p.internationalCaps, p.internationalGoals,
         p.marketValueEur, p.highestMarketValueEur],
      );
    }

    await db.query(
      `insert into player_sources (player_id, source_id, source_key) values ($1,$2,$3)
       on conflict (player_id, source_id) do update set source_key = excluded.source_key`,
      [playerId, SOURCE_ID, p.sourceKey],
    );
    loaded++;
  }
  return { players: loaded, skipped };
}

// The bare slug is used when it is free; otherwise a source-key suffix keeps
// both players. The loop only advances if that suffix is itself taken, which
// needs three players with one name - it is deterministic either way.
async function freeSlug(db, base, sourceKey) {
  const taken = async (slug) => (await db.query('select 1 from players where slug = $1', [slug])).rows.length > 0;
  if (!(await taken(base))) return base;
  let candidate = `${base}-${suffixFor(sourceKey)}`;
  for (let n = 2; await taken(candidate); n++) candidate = `${base}-${suffixFor(sourceKey)}-${n}`;
  return candidate;
}

export async function loadTransfers(db, { rawDir }) {
  // A staging table: Task 9 reads it to derive club paths, then it is discarded.
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
      `insert into staging_transfers
         (player_source_key, season, to_club_name, from_club_name, to_club_id, from_club_id, fee_eur, market_value_eur)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.playerSourceKey, t.season, t.toClubName, t.fromClubName,
       t.toClubId ? Number(t.toClubId) : null, t.fromClubId ? Number(t.fromClubId) : null,
       t.feeEur, t.marketValueEur],
    );
    rows++;
  }
  return { rows };
}

// --- Tournament rosters ----------------------------------------------------
// The Transfermarkt dump holds WC2022's fixtures but no squads, so tournament
// rosters come from Wikidata's P1344 (participant in) / P54 (member of sports
// team). The pool is deliberately not "everyone who ever played for a
// participating nation" - see tournamentSquadQuery - and the match is by folded
// name where ONLY a unique match counts: an ambiguous name is reported, never
// attached to the nearest guess.

const WIKIDATA_SOURCE_ID = 'wikidata';
const WIKIDATA_URL = 'https://www.wikidata.org/';

// A tournament squad *pool* is not the exact 26-man list - Wikidata records
// participants, not final squads - so it is larger than one squad but far
// smaller than "everyone who ever played for a participating nation". 231 is
// the 2022 World Cup; the over-broad query gives 6,494. The band rejects both
// directions: too big is a query bug, too small means the shape is wrong.
const MIN_PLAUSIBLE_SQUAD = 50;
const MAX_PLAUSIBLE_SQUAD = 800;

export function squadSizeIsPlausible(n) {
  return n >= MIN_PLAUSIBLE_SQUAD && n <= MAX_PLAUSIBLE_SQUAD;
}

// Tournament ids are stable (`wc-2022`); the QID is what Wikidata knows. Only
// the 2022 World Cup QID is pinned - the rest resolve from the seeded name, so
// no more QIDs than necessary live in this file.
const TOURNAMENT_QIDS = { 'wc-2022': 'Q284163' };
const TOURNAMENT_NAMES = {
  'wc-2022': '2022 FIFA World Cup',
  'wc-2026': '2026 FIFA World Cup',
  'euro-2024': 'UEFA Euro 2024',
  'copa-2024': '2024 Copa América',
};

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

/** The squad pool of one tournament, as `[{ id: QID, label }]`. One query per
 * tournament. The query shape (occupation filter + P54 date window) lives in
 * lib/wikidata.js; the window is the tournament's own year and the year before. */
export async function fetchTournamentSquad(qid, year) {
  const bindings = await sparql(tournamentSquadQuery({ qid, from: year - 1, to: year }));
  return bindings
    .filter(b => b.player?.value)
    .map(b => {
      const id = b.player.value.split('/').pop();
      const label = b.playerLabel?.value;
      // An unlabelled entity comes back as its own QID; that is not a name and
      // must never be matched against, so it is reported as unlabelled.
      return { id, label: label && label !== id ? label : null };
    });
}

/** Resolve a tournament's QID from Wikidata by exact label, so no more QIDs
 * than necessary are hardcoded. Qualification/group/final/bids pages share the
 * label prefix and are never the tournament; only an exact-label hit counts. */
export async function resolveTournamentQid(name) {
  if (!name) return null;
  const hits = await searchEntity(name, 10);
  const exact = hits.find(h => h.label === name
    && !/qualif|group|final|bid|squad/i.test(h.description ?? ''));
  return exact?.id ?? null;
}

/**
 * Load each tournament's roster from Wikidata and attach the members that match
 * a real player row by folded, unique name. Unmatched members are returned for
 * reporting, never inserted. `squads` may be injected so tests stay offline.
 */
export async function loadTournaments(db, { tournaments = [], squads, fetchSquad = fetchTournamentSquad } = {}) {
  await db.query(
    `insert into sources (id, licence, url) values ($1, $2, $3) on conflict (id) do nothing`,
    [WIKIDATA_SOURCE_ID, 'CC0-1.0', WIKIDATA_URL],
  );

  const ids = tournaments.length ? tournaments : Object.keys(TOURNAMENT_NAMES);
  const players = (await db.query('select id, name from players')).rows;
  const years = new Map(
    (await db.query('select id, year from tournaments')).rows.map(r => [r.id, r.year]),
  );

  let loaded = 0;
  const unmatched = [];
  for (const tournamentId of ids) {
    const qid = TOURNAMENT_QIDS[tournamentId]
      ?? await resolveTournamentQid(TOURNAMENT_NAMES[tournamentId]);
    if (!qid) continue;
    const year = years.get(tournamentId);
    if (!year) { unmatched.push({ tournamentId, reason: 'no year for tournament' }); continue; }
    const injected = squads?.[tournamentId];
    let squad;
    if (injected) {
      // A test seam: the caller owns the fixture's validity.
      squad = injected;
    } else {
      squad = await fetchSquad(qid, year);
      // A pool outside the plausible band means the query resolved the wrong
      // set (see tournamentSquadQuery). Report the size and write nothing -
      // writing an over-broad result would fabricate memberships.
      if (!squadSizeIsPlausible(squad.length)) {
        unmatched.push({ tournamentId, reason: `implausible squad size ${squad.length}` });
        continue;
      }
    }
    const { matched, unmatched: missed } = matchTournamentSquads(
      squad.filter(m => m.label), players,
    );
    for (const m of matched) {
      await db.query(
        `insert into player_tournaments (player_id, tournament_id, source_id)
         values ($1,$2,$3) on conflict (player_id, tournament_id) do nothing`,
        [m.playerId, tournamentId, WIKIDATA_SOURCE_ID],
      );
      loaded++;
    }
    unmatched.push(...missed.map(m => ({ ...m, tournamentId })));
  }
  return { tournaments: ids.length, players: loaded, unmatched: unmatched.length };
}
