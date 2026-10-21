import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8080;
const dbPath = path.join(__dirname, 'data/football.db');

// Check DB
let db;
try {
  db = new DatabaseSync(dbPath);
} catch (e) {
  console.warn("Database not initialized yet. Run 'node scripts/sync-live-data.js' to populate.");
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // REST API Endpoints
  if (pathname === '/api/health') {
    if (!db) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Database disconnected' }));
      return;
    }
    const playerCount = db.prepare('SELECT COUNT(*) as count FROM players').get().count;
    const teamCount = db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', source: 'SQLite (data/football.db)', playerCount, teamCount }));
    return;
  }

  if (pathname === '/api/players') {
    try {
      const jsonPath = path.join(__dirname, 'data/players.json');
      if (fs.existsSync(jsonPath)) {
        const jsonData = fs.readFileSync(jsonPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(jsonData);
        return;
      }

      if (!db) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database disconnected and data/players.json not found' }));
        return;
      }

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

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fullData));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Prevent path traversal
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(__dirname))) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 Forbidden</h1>');
    return;
  }
  filePath = resolvedPath;

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Football Trivia Backend Server running on http://localhost:${PORT}`);
  console.log(`   REST API Health: http://localhost:${PORT}/api/health`);
  console.log(`   REST API Players: http://localhost:${PORT}/api/players`);
});
