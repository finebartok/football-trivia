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
  // the registry mirrors the committed fixture: leagues and windows are
  // id-keyed objects, clubs and tournaments are arrays
  assert.equal(typeof json.registry.leagues, 'object');
  assert.ok(!Array.isArray(json.registry.leagues));
  assert.ok(Array.isArray(json.registry.clubs));
  assert.equal(typeof json.registry.windows, 'object');
  assert.ok(Array.isArray(json.registry.tournaments));
  assert.equal(json.players.length, 1);
  const p = json.players[0];
  for (const k of ['id','slug','name','dateOfBirth','citizenship','position','teams','tournaments','stats','windows']) {
    assert.ok(k in p, `player is missing ${k}`);
  }
  await db.close();
});
