import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/football.db');

const TEAMS_LIST = [
  // Premier League
  { id: '133604', name: 'Arsenal', league: 'Premier League' },
  { id: '133610', name: 'Chelsea', league: 'Premier League' },
  { id: '133613', name: 'Liverpool', league: 'Premier League' },
  { id: '133614', name: 'Manchester City', league: 'Premier League' },
  { id: '133615', name: 'Manchester United', league: 'Premier League' },
  { id: '133626', name: 'Tottenham Hotspur', league: 'Premier League' },
  { id: '133605', name: 'Aston Villa', league: 'Premier League' },
  { id: '133616', name: 'Newcastle United', league: 'Premier League' },
  // La Liga
  { id: '133738', name: 'Real Madrid', league: 'La Liga' },
  { id: '133739', name: 'FC Barcelona', league: 'La Liga' },
  { id: '133729', name: 'Atletico Madrid', league: 'La Liga' },
  { id: '133737', name: 'Sevilla', league: 'La Liga' },
  { id: '133741', name: 'Villarreal', league: 'La Liga' },
  // Bundesliga
  { id: '133664', name: 'Bayern Munich', league: 'Bundesliga' },
  { id: '133665', name: 'Borussia Dortmund', league: 'Bundesliga' },
  { id: '133666', name: 'Bayer Leverkusen', league: 'Bundesliga' },
  { id: '133670', name: 'RB Leipzig', league: 'Bundesliga' },
  // Serie A
  { id: '133681', name: 'Inter Milan', league: 'Serie A' },
  { id: '133682', name: 'AC Milan', league: 'Serie A' },
  { id: '133683', name: 'Juventus', league: 'Serie A' },
  { id: '133684', name: 'Napoli', league: 'Serie A' },
  { id: '133685', name: 'Roma', league: 'Serie A' },
  // Ligue 1
  { id: '133702', name: 'Paris Saint-Germain', league: 'Ligue 1' },
  { id: '133704', name: 'Marseille', league: 'Ligue 1' },
  { id: '133705', name: 'Monaco', league: 'Ligue 1' },
  { id: '133703', name: 'Lyon', league: 'Ligue 1' }
];

const POSITION_MAP = {
  'Goalkeeper': 'Goalkeeper',
  'Defender': 'Defender',
  'Centre-Back': 'Defender',
  'Left-Back': 'Defender',
  'Right-Back': 'Defender',
  'Midfield': 'Midfielder',
  'Midfielder': 'Midfielder',
  'Central Midfield': 'Midfielder',
  'Attacking Midfield': 'Midfielder',
  'Defensive Midfield': 'Midfielder',
  'Forward': 'Forward',
  'Attacker': 'Forward',
  'Centre-Forward': 'Forward',
  'Left Winger': 'Forward',
  'Right Winger': 'Forward',
  'Winger': 'Forward'
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'FootballTriviaApp/1.0' }
    };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function syncLiveData() {
  console.log("Starting Live Football API Sync into SQLite database...");
  const db = new DatabaseSync(dbPath);

  // Initialize DB tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nationality TEXT NOT NULL,
      position TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      shirt_number TEXT,
      preferred_foot TEXT
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
      UNIQUE(player_id, team_id)
    );
  `);

  const insertPlayer = db.prepare(`INSERT INTO players (name, nationality, position, date_of_birth, shirt_number, preferred_foot) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertTeam = db.prepare(`INSERT OR IGNORE INTO teams (name, league) VALUES (?, ?)`);
  const getTeamId = db.prepare(`SELECT id FROM teams WHERE name = ?`);
  const getPlayerByName = db.prepare(`SELECT id FROM players WHERE name = ?`);
  const insertPlayerTeam = db.prepare(`INSERT OR IGNORE INTO player_teams (player_id, team_id, season_start, season_end) VALUES (?, ?, ?, ?)`);

  let fetchedCount = 0;

  for (const t of TEAMS_LIST) {
    insertTeam.run(t.name, t.league);
    const teamRecord = getTeamId.get(t.name);
    const teamId = teamRecord.id;

    try {
      const data = await fetchJson(`https://www.thesportsdb.com/api/v1/json/3/lookup_all_players.php?id=${t.id}`);
      const squad = data.player || [];

      for (const p of squad) {
        const rawPos = p.strPosition || '';
        let pos = POSITION_MAP[rawPos];
        if (!pos) {
          if (rawPos.includes('Keeper')) pos = 'Goalkeeper';
          else if (rawPos.includes('Back') || rawPos.includes('Defen')) pos = 'Defender';
          else if (rawPos.includes('Midfield')) pos = 'Midfielder';
          else if (rawPos.includes('Wing') || rawPos.includes('Forw') || rawPos.includes('Striker')) pos = 'Forward';
        }
        if (!pos) continue;

        const name = p.strPlayer;
        if (!name || rawPos.includes('Manager') || rawPos.includes('Coach')) continue;
        // Skip non-active players
        if (p.strStatus && ['Retired', 'Coaching', 'Free Agent'].includes(p.strStatus)) continue;

        const dob = p.dateBorn || '2000-01-01';
        const nat = p.strNationality || 'Unknown';
        const shirtNumber = p.strNumber || null;
        const preferredFoot = p.strSide || null;

        let existingPlayer = getPlayerByName.get(name);
        let playerId;

        if (!existingPlayer) {
          const res = insertPlayer.run(name, nat, pos, dob, shirtNumber, preferredFoot);
          playerId = res.lastInsertRowid;
          fetchedCount++;
        } else {
          playerId = existingPlayer.id;
        }

        // Calculate approximate season from dateSigned
        let seasonStart = 2020;
        if (p.dateSigned) {
          const signedYear = parseInt(p.dateSigned.split('-')[0]);
          if (signedYear >= 2000 && signedYear <= 2026) seasonStart = signedYear;
        }
        const seasonEnd = 2025;
        insertPlayerTeam.run(playerId, teamId, seasonStart, seasonEnd);
      }
      console.log(`Synced ${t.name} (${t.league}) -> Total DB Players: ${fetchedCount}`);
    } catch (e) {
      console.error(`Error syncing ${t.name}:`, e.message);
    }
    await delay(150);
  }

  // Generate JSON dump for frontend caching
  const playersStmt = db.prepare(`
    SELECT p.id, p.name, p.nationality, p.position, p.date_of_birth as dateOfBirth
    FROM players p
  `);
  const allPlayers = playersStmt.all();

  const getPlayerTeams = db.prepare(`
    SELECT t.name as team, t.league, pt.season_start, pt.season_end
    FROM player_teams pt
    JOIN teams t ON pt.team_id = t.id
    WHERE pt.player_id = ?
  `);

  const fullData = allPlayers.map(p => {
    const teams = getPlayerTeams.all(p.id).map(t => {
      const seasons = [];
      for (let s = t.season_start; s <= t.season_end; s++) seasons.push(s);
      return { team: t.team, league: t.league, seasons };
    });
    return { ...p, teams };
  });

  const jsonPath = path.join(__dirname, '../data/players.json');
  fs.writeFileSync(jsonPath, JSON.stringify(fullData, null, 2));

  console.log(`\nSuccessfully synced ${fullData.length} REAL players into SQLite DB & JSON cache!`);
  db.close();
  return fullData.length;
}

if (process.argv[1] === __filename) {
  syncLiveData().catch(console.error);
}
