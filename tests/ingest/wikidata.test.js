import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';
import { matchTournamentSquads, loadTournaments, squadSizeIsPlausible } from '../../scripts/ingest/load.js';
import { tournamentSquadQuery, FOOTBALLER } from '../../scripts/ingest/lib/wikidata.js';

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

// --- Load-bearing behaviour the brief cannot know about -------------------

async function freshDb() {
  const db = await openDb();
  await applyMigrations(db);
  return db;
}

test('an ambiguous name is reported, never attached to the nearest player', () => {
  // Two real players fold to one name; neither may claim the squad slot.
  const res = matchTournamentSquads(
    [{ id: 'Q1', label: 'Rafael Silva' }],
    [{ id: 1, name: 'Rafael Silva' }, { id: 2, name: 'Rafael  Silva' }],
  );
  assert.equal(res.matched.length, 0);
  assert.equal(res.unmatched.length, 1);
  assert.equal(res.unmatched[0].reason, 'ambiguous');
});

test('a squad member with no player row is reported as not found', () => {
  const res = matchTournamentSquads([{ id: 'Q7', label: 'Ghost Player' }], []);
  assert.equal(res.unmatched[0].reason, 'not found');
});

test('loadTournaments writes matched memberships against the stable tournament id', async () => {
  const db = await freshDb();
  await db.query(
    `insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
     values ('lionel-messi','Lionel Messi','1987-06-24','{Argentina}','Forward','{"status":"pass"}',true)`,
  );

  // A realistic pool size: the guard must accept 231.
  const pool = [{ id: 'Q615', label: 'Lionel Messi' }, { id: 'Q9', label: 'Ghost' }];
  while (pool.length < 231) pool.push({ id: `Q${pool.length}`, label: `Filler ${pool.length}` });
  const res = await loadTournaments(db, { tournaments: ['wc-2022'], fetchSquad: async () => pool });

  assert.deepEqual(res, { tournaments: 1, players: 1, unmatched: 230 });
  const rows = (await db.query('select tournament_id, source_id from player_tournaments')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tournament_id, 'wc-2022', 'the roster keys off the stable id, not a display name');
  assert.equal(rows[0].source_id, 'wikidata');
  await db.close();
});

test('the squad query requires the occupation filter and the date qualifier', () => {
  // Both are load-bearing: dropping either reintroduces the ~6,500-person
  // "everyone who ever played for a participating nation" result.
  const q = tournamentSquadQuery({ qid: 'Q284163', from: 2021, to: 2022 });
  assert.match(q, new RegExp(`wdt:P106 wd:${FOOTBALLER}`), 'occupation filter');
  assert.match(q, /pq:P580 \?start/, 'the P54 statement needs a start-date qualifier');
  assert.match(q, /YEAR\(\?start\) >= 2021 && YEAR\(\?start\) <= 2022/, 'the year window');
  assert.match(q, /wdt:P1344 wd:Q284163/, 'the tournament QID');
});

test('the year window comes from the tournament, not WC2022', () => {
  const q = tournamentSquadQuery({ qid: 'Q15098367', from: 2023, to: 2024 });
  assert.match(q, /YEAR\(\?start\) >= 2023 && YEAR\(\?start\) <= 2024/);
  assert.match(q, /wd:Q15098367/);
});

test('the size guard accepts a real pool and rejects the over-broad result', () => {
  assert.equal(squadSizeIsPlausible(231), true, 'the 2022 World Cup pool is accepted');
  assert.equal(squadSizeIsPlausible(6494), false, 'the over-broad result is rejected');
  assert.equal(squadSizeIsPlausible(10), false, 'a too-small result means the query shape is wrong');
});

test('an over-broad live result is reported with its size and writes nothing', async () => {
  const db = await freshDb();
  await db.query(
    `insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
     values ('lionel-messi','Lionel Messi','1987-06-24','{Argentina}','Forward','{"status":"pass"}',true)`,
  );
  // Drive the real guard: the injected fetch returns the over-broad 6,494 pool.
  const overBroad = Array.from({ length: 6494 }, (_, i) => ({ id: `Q${i}`, label: `P${i}` }));
  const res = await loadTournaments(db, {
    tournaments: ['wc-2022'],
    fetchSquad: async () => overBroad,
  });
  assert.equal(res.players, 0, 'nothing is written from an over-broad pool');
  assert.equal(res.unmatched, 1, 'the rejection is reported');
  assert.equal((await db.query('select count(*)::int c from player_tournaments')).rows[0].c, 0);
  await db.close();
});

test('loadTournaments is idempotent', async () => {
  const db = await freshDb();
  await db.query(
    `insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
     values ('lionel-messi','Lionel Messi','1987-06-24','{Argentina}','Forward','{"status":"pass"}',true)`,
  );

  const squads = { 'wc-2022': [{ id: 'Q615', label: 'Lionel Messi' }] };
  await loadTournaments(db, { tournaments: ['wc-2022'], squads });
  await loadTournaments(db, { tournaments: ['wc-2022'], squads });
  assert.equal((await db.query('select count(*)::int c from player_tournaments')).rows[0].c, 1,
    're-running does not duplicate a membership');
  await db.close();
});
