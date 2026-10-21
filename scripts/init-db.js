import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/football.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function initDatabase() {
  const db = new DatabaseSync(dbPath);

  // Enable WAL mode for high performance
  db.exec('PRAGMA journal_mode = WAL;');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nationality TEXT NOT NULL,
      position TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      league TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      season_start INTEGER NOT NULL,
      season_end INTEGER NOT NULL,
      UNIQUE(player_id, team_id),
      FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_players_nationality ON players(nationality);
    CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
    CREATE INDEX IF NOT EXISTS idx_teams_league ON teams(league);
    CREATE INDEX IF NOT EXISTS idx_player_teams ON player_teams(player_id, team_id);
  `);

  return db;
}

if (process.argv[1] === __filename) {
  const db = initDatabase();
  console.log("Database initialized successfully at:", dbPath);
  db.close();
}
