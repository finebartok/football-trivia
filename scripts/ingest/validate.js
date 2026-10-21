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
