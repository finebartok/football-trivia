import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';
import { matchTournamentSquads, loadTournaments } from '../../scripts/ingest/load.js';

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

  const res = await loadTournaments(db, {
    tournaments: ['wc-2022'],
    squads: { 'wc-2022': [{ id: 'Q615', label: 'Lionel Messi' }, { id: 'Q9', label: 'Ghost' }] },
  });

  assert.deepEqual(res, { tournaments: 1, players: 1, unmatched: 1 });
  const rows = (await db.query('select tournament_id, source_id from player_tournaments')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tournament_id, 'wc-2022', 'the roster keys off the stable id, not a display name');
  assert.equal(rows[0].source_id, 'wikidata');
  await db.close();
});

test('loadTournaments is idempotent and refuses an implausibly large squad', async () => {
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

  // An over-broad query result must never fabricate a roster.
  const huge = Array.from({ length: 200 }, (_, i) => ({ id: `Q${i}`, label: `P${i}` }));
  const res = await loadTournaments(db, { tournaments: ['wc-2022'], squads: { 'wc-2022': huge } });
  assert.equal(res.players, 0);
  assert.equal(res.unmatched, 1, 'the over-broad squad is reported, not written');
  assert.equal((await db.query('select count(*)::int c from player_tournaments')).rows[0].c, 1,
    'the implausible squad wrote nothing');
  await db.close();
});
