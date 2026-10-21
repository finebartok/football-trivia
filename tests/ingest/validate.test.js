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
  await db.query(`insert into clubs (id, name) values (1, 'Test FC')`);
  await seed(db, [
    { slug: 'good', name: 'Good Player', dob: '1990-01-01', nat: '{England}', pos: 'Forward' },
    { slug: 'tooyoung', name: 'Too Old', dob: '1920-01-01', nat: '{England}', pos: 'Forward' },
    { slug: 'nostint', name: 'No Stint', dob: '1990-01-01', nat: '{England}', pos: 'Forward' },
  ]);
  // G5 requires a club stint with both season bounds, so the passing player
  // needs one and the failing ones must not have it.
  await db.query(`insert into club_stints (player_id, club_id, season_start, season_end, evidence)
    select id, 1, 2014, 2018, 'appearance' from players where slug in ('good','tooyoung')`);

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
  await db.query(`insert into clubs (id, name) values (1, 'Test FC')`);
  await seed(db, [{ slug: 'nophoto', name: 'No Photo', dob: '1990-01-01', nat: '{England}', pos: 'Forward' }]);
  await db.query(`insert into club_stints (player_id, club_id, season_start, season_end, evidence)
    select id, 1, 2014, 2018, 'appearance' from players where slug='nophoto'`);
  const res = await applyQualityGate(db);
  assert.equal(res.passed, 1);
  await db.close();
});
