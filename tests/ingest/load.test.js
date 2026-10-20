import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';
import { loadPlayers, loadReferenceData, loadTransfers } from '../../scripts/ingest/load.js';

async function gz(dir, name, header, lines) {
  const body = [header, ...lines].join('\n') + '\n';
  const p = path.join(dir, name);
  await fs.writeFile(p, zlib.gzipSync(Buffer.from(body, 'utf8')));
  return p;
}

async function freshDb() {
  const db = await openDb();
  await applyMigrations(db);
  return db;
}

test('loadPlayers is idempotent and skips unusable rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-'));
  await gz(dir, 'players.csv.gz',
    'player_id,name,date_of_birth,country_of_citizenship,position,foot,height_in_cm,international_caps,international_goals,market_value_in_eur,highest_market_value_in_eur',
    [
      '1,Lionel Messi,1987-06-24,Argentina,Attack,Left,170,191,112,30000000,400000000',
      '2,without club,1990-01-01,England,Midfield,Right,180,,,0,',
    ]);

  const db = await freshDb();
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

  const db = await freshDb();
  const counts = await loadReferenceData(db, { rawDir: dir });

  assert.equal(counts.leagues, 2);
  assert.equal(counts.clubs, 2);
  const lg = (await db.query("select display_name from leagues where id = 'GB1'")).rows;
  assert.equal(lg[0].display_name, 'Premier League');
  await db.close();
});

// --- Load-bearing behaviour the brief cannot know about -------------------

test('loadPlayers keeps a real zero cap count and stores an unknown position', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-zero-'));
  await gz(dir, 'players.csv.gz',
    'player_id,name,date_of_birth,country_of_citizenship,position,foot,height_in_cm,international_caps,international_goals,market_value_in_eur,highest_market_value_in_eur',
    ['7,Uncapped Unknown,1990-01-01,Brazil,Missing,,0,0,0,0,']);

  const db = await freshDb();
  const res = await loadPlayers(db, { rawDir: dir });
  assert.equal(res.players, 1, 'a player with an Unknown position is loaded, not filtered');

  const row = (await db.query('select position, international_caps, international_goals, height_cm, market_value_eur from players')).rows[0];
  assert.equal(row.position, 'Unknown', 'the gate (G4) fails this player, not the insert');
  assert.equal(row.international_caps, 0, 'a recorded zero is a fact');
  assert.equal(row.international_goals, 0);
  assert.equal(row.height_cm, null, 'a zero height means the source recorded nothing');
  assert.equal(row.market_value_eur, null, 'a zero market value means nothing recorded');

  const src = (await db.query('select source_key from player_sources')).rows;
  assert.equal(src[0].source_key, '7', 'the source key links the player to its raw row');
  await db.close();
});

test('loadPlayers does not clobber a curated league display name on re-run', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-name-'));
  await gz(dir, 'clubs.csv.gz', 'club_id,name,domestic_competition_id,last_season', []);
  await gz(dir, 'competitions.csv.gz',
    'competition_id,competition_code,name,sub_type,type,domestic_league_code',
    ['ES1,laliga,laliga,,domestic_league,ES1']);

  const db = await freshDb();
  await loadReferenceData(db, { rawDir: dir });
  const lg = (await db.query("select display_name from leagues where id = 'ES1'")).rows[0];
  assert.equal(lg.display_name, 'La Liga', 'the seeded curated name survives the load');
  await db.close();
});

test('loadReferenceData leaves a club in an unknown league without a league pointer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-orphan-'));
  await gz(dir, 'clubs.csv.gz',
    'club_id,name,domestic_competition_id,last_season',
    ['99,Orphan FC,XX1,2025', '10,Arsenal FC,GB1,2025']);
  await gz(dir, 'competitions.csv.gz',
    'competition_id,competition_code,name,sub_type,type,domestic_league_code',
    ['GB1,premier-league,premier-league,,domestic_league,GB1']);

  const db = await freshDb();
  const counts = await loadReferenceData(db, { rawDir: dir });
  assert.equal(counts.clubs, 2, 'a club with a foreign league id is still loaded');
  const orphan = (await db.query('select current_league_id from clubs where id = 99')).rows[0];
  assert.equal(orphan.current_league_id, null, 'an unknown league is null, not a dangling key');
  await db.close();
});

test('loadReferenceData is idempotent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-ref2-'));
  await gz(dir, 'clubs.csv.gz',
    'club_id,name,domestic_competition_id,last_season', ['10,Arsenal FC,GB1,2025']);
  await gz(dir, 'competitions.csv.gz',
    'competition_id,competition_code,name,sub_type,type,domestic_league_code',
    ['GB1,premier-league,premier-league,,domestic_league,GB1']);

  const db = await freshDb();
  await loadReferenceData(db, { rawDir: dir });
  await loadReferenceData(db, { rawDir: dir });
  const clubs = (await db.query('select count(*)::int c from clubs')).rows[0].c;
  assert.equal(clubs, 1, 're-running does not duplicate a club');
  await db.close();
});

test('loadTransfers stages every usable transfer with a start-year season', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-tx-'));
  await gz(dir, 'transfers.csv.gz',
    'player_id,transfer_date,transfer_season,from_club_id,to_club_id,from_club_name,to_club_name,transfer_fee,market_value_in_eur,player_name',
    [
      '467994,2030-06-30,25/26,5621,749,Reggiana,FC Empoli,0.000,700000.000,Luca Belardinelli',
      '467995,2030-06-30,15/16,1,2,without club,,0.000,0,Filler Name',
      '467996,2030-06-30,,1,2,Reggiana,FC Empoli,0.000,0,No Season',
    ]);

  const db = await freshDb();
  const res = await loadTransfers(db, { rawDir: dir });

  assert.equal(res.rows, 1, 'a transfer with no season or two junk endpoints is dropped');
  const row = (await db.query('select * from staging_transfers')).rows[0];
  assert.equal(row.player_source_key, '467994');
  assert.equal(row.season, 2025, 'the season key is the start year');
  assert.equal(row.to_club_id, 749);
  assert.equal(row.fee_eur, null, 'a zero fee is not a fee');
  assert.equal(row.market_value_eur, 700000);
  await db.close();
});

test('two footballers who share a name and date of birth both survive, with distinct slugs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-dup-'));
  await gz(dir, 'players.csv.gz',
    'player_id,name,date_of_birth,country_of_citizenship,position,foot,height_in_cm,international_caps,international_goals,market_value_in_eur,highest_market_value_in_eur',
    [
      '101,Rafael Silva,1993-05-05,Brazil,Attack,Right,175,3,1,2000000,5000000',
      '202,Rafael Silva,1993-05-05,Portugal,Defender,Left,183,7,0,900000,2500000',
    ]);

  const db = await freshDb();
  const res = await loadPlayers(db, { rawDir: dir });
  assert.equal(res.players, 2, 'no usable source row is silently dropped');

  const rows = (await db.query('select id, slug, name, international_caps from players order by id')).rows;
  assert.equal(rows.length, 2, 'two different players, not one overwritten row');
  assert.notEqual(rows[0].slug, rows[1].slug, 'the slug identifies a player, not a name');
  assert.equal(new Set(rows.map(r => r.slug)).size, 2);
  assert.deepEqual(rows.map(r => r.international_caps).sort(), [3, 7], 'each keeps its own stats');

  const sources = (await db.query('select player_id, source_key from player_sources order by source_key')).rows;
  assert.equal(sources.length, 2, 'each player maps to its own source key');
  assert.equal(new Set(sources.map(s => s.source_key)).size, 2);
  assert.equal(new Set(sources.map(s => s.player_id)).size, 2, 'the source keys resolve to two different players');
  await db.close();
});

test('re-running with duplicate names keeps the same slugs and creates no duplicates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-dup2-'));
  await gz(dir, 'players.csv.gz',
    'player_id,name,date_of_birth,country_of_citizenship,position,foot,height_in_cm,international_caps,international_goals,market_value_in_eur,highest_market_value_in_eur',
    [
      '101,Rafael Silva,1993-05-05,Brazil,Attack,Right,175,3,1,2000000,5000000',
      '202,Rafael Silva,1993-05-05,Portugal,Defender,Left,183,7,0,900000,2500000',
    ]);

  const db = await freshDb();
  const a = await loadPlayers(db, { rawDir: dir });
  const slugsAfterFirst = (await db.query('select slug from players order by slug')).rows.map(r => r.slug);
  const b = await loadPlayers(db, { rawDir: dir });
  const slugsAfterSecond = (await db.query('select slug from players order by slug')).rows.map(r => r.slug);

  assert.equal(a.players, 2);
  assert.equal(b.players, 2, 'the second run updates the same two players');
  const count = (await db.query('select count(*)::int c from players')).rows[0].c;
  assert.equal(count, 2, 're-running creates no duplicate rows');
  assert.deepEqual(slugsAfterSecond, slugsAfterFirst, 'slugs are stable across runs');
  await db.close();
});

test('the same source id is one player even when two rows are otherwise identical', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-same-'));
  await gz(dir, 'players.csv.gz',
    'player_id,name,date_of_birth,country_of_citizenship,position,foot,height_in_cm,international_caps,international_goals,market_value_in_eur,highest_market_value_in_eur',
    [
      '300,Sam Identical,1990-01-01,England,Midfield,Right,180,1,0,100000,200000',
      '300,Sam Identical,1990-01-01,England,Midfield,Right,180,2,0,150000,250000',
    ]);

  const db = await freshDb();
  const res = await loadPlayers(db, { rawDir: dir });
  assert.equal(res.players, 2, 'both source rows are processed');

  const rows = (await db.query('select slug, international_caps from players')).rows;
  assert.equal(rows.length, 1, 'one source id is one player, updated not duplicated');
  assert.equal(rows[0].international_caps, 2, 'the later row updates the same player');
  await db.close();
});
