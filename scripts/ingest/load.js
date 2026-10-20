// Loads the raw Transfermarkt snapshots into Postgres. Reference data first
// (leagues, then clubs, so the league FK holds), then players. Every loader is
// idempotent: re-running produces the same rows, never duplicates. A missing
// source value stays NULL - this file never invents one.
import path from 'node:path';
import { readCsvGz } from './lib/csv.js';
import { normalisePlayer, normaliseTransfer } from './normalize.js';

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

export async function loadPlayers(db, { rawDir }) {
  await ensureSource(db);
  let loaded = 0, skipped = 0;

  for await (const raw of readCsvGz(path.join(rawDir, 'players.csv.gz'))) {
    const p = normalisePlayer(raw);
    if (!p) { skipped++; continue; }
    const { rows } = await db.query(
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
         highest_market_value_eur = excluded.highest_market_value_eur
       returning id`,
      [p.slug, p.name, p.dateOfBirth, p.citizenship, p.position, p.subPosition,
       p.preferredFoot, p.heightCm, p.internationalCaps, p.internationalGoals,
       p.marketValueEur, p.highestMarketValueEur],
    );
    await db.query(
      `insert into player_sources (player_id, source_id, source_key) values ($1,$2,$3)
       on conflict (player_id, source_id) do update set source_key = excluded.source_key`,
      [rows[0].id, SOURCE_ID, p.sourceKey],
    );
    loaded++;
  }
  return { players: loaded, skipped };
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
