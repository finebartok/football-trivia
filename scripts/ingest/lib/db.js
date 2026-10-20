import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ingest/lib -> scripts/ingest -> scripts -> repo root
const DB_DIR = path.resolve(__dirname, '../../../db');

export async function openDb({ url } = {}) {
  if (url) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    return {
      async query(sql, params) { return pool.query(sql, params); },
      // A migration file holds many statements. node-postgres runs them in one
      // simple-query round trip; PGlite needs exec() for the same thing.
      async exec(sql) { return pool.query(sql); },
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
    async exec(sql) {
      await pg.exec(sql);
      return { rows: [], rowCount: 0 };
    },
    async close() { await pg.close(); },
  };
}

export async function applyMigrations(db) {
  const files = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    await db.exec(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
  }
  return files;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const db = await openDb({ url: process.env.DATABASE_URL });
  const files = await applyMigrations(db);
  console.log(`applied ${files.length} migrations`);
  await db.close();
}
