import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';

const DB_PATH = path.join(process.cwd(), 'data/football.db');
const RAW_DATA_DIR = path.join(process.cwd(), 'data/raw');
const GOLD_STANDARD_PATH = path.join(process.cwd(), 'data/gold_standard.json');

const POSITION_MAP = {
  'Goalkeeper': 'Goalkeeper',
  'GK': 'Goalkeeper',
  'Defender': 'Defender',
  'CB': 'Defender',
  'LB': 'Defender',
  'RB': 'Defender',
  'LWB': 'Defender',
  'RWB': 'Defender',
  'Midfielder': 'Midfielder',
  'CM': 'Midfielder',
  'CDM': 'Midfielder',
  'CAM': 'Midfielder',
  'LM': 'Midfielder',
  'RM': 'Midfielder',
  'Forward': 'Forward',
  'ST': 'Forward',
  'CF': 'Forward',
  'LW': 'Forward',
  'RW': 'Forward'
};

function normalizePosition(pos) {
  if (!pos) return 'Unknown';
  const upperPos = pos.toUpperCase();
  for (const [key, value] of Object.entries(POSITION_MAP)) {
    if (upperPos.includes(key.toUpperCase())) return value;
  }
  return 'Unknown';
}

async function importDatasets() {
  console.log("🚀 Starting Professional Transfermarkt Data Import...");

  const db = new DatabaseSync(DB_PATH);

  // 1. Schema Setup
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tm_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      dob DATE,
      nationality TEXT,
      position TEXT,
      preferred_foot TEXT,
      relevance_score REAL DEFAULT 0,
      is_gold_standard BOOLEAN DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tm_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      league TEXT,
      country TEXT
    );

    CREATE TABLE IF NOT EXISTS career_paths (
      player_id INTEGER,
      team_id INTEGER,
      season_start INTEGER,
      season_end INTEGER,
      appearances INTEGER DEFAULT 0,
      goals INTEGER DEFAULT 0,
      PRIMARY KEY (player_id, team_id, season_start),
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS market_values (
      player_id INTEGER,
      value_eur INTEGER,
      recorded_date DATE,
      PRIMARY KEY (player_id, recorded_date),
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS honors (
      player_id INTEGER,
      trophy_name TEXT,
      year INTEGER,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
  `);

  // Load Gold Standard for overrides
  let goldStandard = [];
  if (fs.existsSync(GOLD_STANDARD_PATH)) {
    goldStandard = JSON.parse(fs.readFileSync(GOLD_STANDARD_PATH, 'utf8'));
  }

  // 2. Import Teams
  const teamsCsvPath = path.join(RAW_DATA_DIR, 'clubs.csv');
  if (fs.existsSync(teamsCsvPath)) {
    console.log("📦 Importing teams...");
    const teamsData = parse(fs.readFileSync(teamsCsvPath), { columns: true, skip_empty_lines: true });
    const insertTeam = db.prepare(`INSERT OR IGNORE INTO teams (tm_id, name, league, country) VALUES (?, ?, ?, ?)`);

    db.exec('BEGIN TRANSACTION');
    for (const t of teamsData) {
      insertTeam.run(t.id, t.name, t.league, t.country);
    }
    db.exec('COMMIT');
  } else {
    console.warn("⚠️ clubs.csv not found in data/raw. Skipping teams import.");
  }

  // 3. Import Players
  const playersCsvPath = path.join(RAW_DATA_DIR, 'players.csv');
  if (fs.existsSync(playersCsvPath)) {
    console.log("📦 Importing players...");
    const playersData = parse(fs.readFileSync(playersCsvPath), { columns: true, skip_empty_lines: true });
    const insertPlayer = db.prepare(`INSERT OR IGNORE INTO players (tm_id, name, dob, nationality, position, preferred_foot) VALUES (?, ?, ?, ?, ?, ?)`);

    db.exec('BEGIN TRANSACTION');
    for (const p of playersData) {
      // Strict Validation
      if (!p.name || !p.nationality || !p.position) continue;

      insertPlayer.run(
        p.id,
        p.name,
        p.dob,
        p.nationality,
        normalizePosition(p.position),
        p.preferred_foot
      );
    }
    db.exec('COMMIT');
  } else {
    console.warn("⚠️ players.csv not found in data/raw. Skipping players import.");
  }

  // 4. Import Career Paths
  const pathsCsvPath = path.join(RAW_DATA_DIR, 'transfers.csv');
  if (fs.existsSync(pathsCsvPath)) {
    console.log("📦 Importing career paths...");
    const pathsData = parse(fs.readFileSync(pathsCsvPath), { columns: true, skip_empty_lines: true });

    const getPlayerId = db.prepare(`SELECT id FROM players WHERE tm_id = ?`);
    const getTeamId = db.prepare(`SELECT id FROM teams WHERE tm_id = ?`);
    const insertPath = db.prepare(`INSERT OR IGNORE INTO career_paths (player_id, team_id, season_start, season_end, appearances, goals) VALUES (?, ?, ?, ?, ?, ?)`);

    db.exec('BEGIN TRANSACTION');
    for (const row of pathsData) {
      const pId = getPlayerId.get(row.player_id)?.id;
      const tId = getTeamId.get(row.team_id)?.id;
      if (pId && tId) {
        insertPath.run(pId, tId, row.season_start, row.season_end, row.appearances, row.goals);
      }
    }
    db.exec('COMMIT');
  }

  // 5. Import Market Values
  const mvCsvPath = path.join(RAW_DATA_DIR, 'market_values.csv');
  if (fs.existsSync(mvCsvPath)) {
    console.log("📦 Importing market values...");
    const mvData = parse(fs.readFileSync(mvCsvPath), { columns: true, skip_empty_lines: true });
    const getPlayerId = db.prepare(`SELECT id FROM players WHERE tm_id = ?`);
    const insertMV = db.prepare(`INSERT OR IGNORE INTO market_values (player_id, value_eur, recorded_date) VALUES (?, ?, ?)`);

    db.exec('BEGIN TRANSACTION');
    for (const row of mvData) {
      const pId = getPlayerId.get(row.player_id)?.id;
      if (pId) {
        insertMV.run(pId, row.value_eur, row.recorded_date);
      }
    }
    db.exec('COMMIT');
  }

  // 6. Apply Gold Standard Overrides
  console.log("✨ Applying Gold Standard overrides...");
  const updatePlayer = db.prepare(`UPDATE players SET is_gold_standard = 1, position = ?, preferred_foot = ? WHERE name = ?`);

  db.exec('BEGIN TRANSACTION');
  for (const gp of goldStandard) {
    updatePlayer.run(gp.position, gp.preferredFoot, gp.name);
  }
  db.exec('COMMIT');

  // 7. Calculate Relevance Scores
  console.log("📈 Calculating relevance scores...");
  db.exec(`
    UPDATE players SET relevance_score = (
      SELECT (
        COALESCE((SELECT MAX(value_eur) FROM market_values WHERE player_id = players.id), 0) * 0.000001 +
        COALESCE((SELECT SUM(appearances) FROM career_paths WHERE player_id = players.id), 0) * 10
      )
    );
  `);

  console.log(`\n✅ Import complete! Database synchronized at ${DB_PATH}`);
  db.close();
}

importDatasets().catch(console.error);
