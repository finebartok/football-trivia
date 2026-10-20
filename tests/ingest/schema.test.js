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
  await db.query(`insert into players (slug, name, date_of_birth, citizenship, position, quality, active)
    values ('a','A Pass','1990-01-01','{"England"}','Forward','{"status":"pass"}',true),
           ('b','B Fail','1990-01-01','{"England"}','Forward','{"status":"fail"}',false)`);
  const rows = (await db.query('select slug from player_pool')).rows;
  assert.deepEqual(rows.map(r => r.slug), ['a']);
  await db.close();
});
