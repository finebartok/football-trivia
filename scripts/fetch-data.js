const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY || process.argv[2];

if (!API_KEY) {
  console.error("Error: Please provide an API key as an argument or via FOOTBALL_DATA_API_KEY environment variable.");
  process.exit(1);
}

const LEAGUES = {
  'PL': 'Premier League',
  'PD': 'La Liga',
  'BL1': 'Bundesliga',
  'SA': 'Serie A',
  'FL1': 'Ligue 1'
};

const SEASONS = [2023, 2024];
const OUTPUT_FILE = path.join(__dirname, '../data/players.json');

// Map API positions to our 4 categories
const POSITION_MAP = {
  'Goalkeeper': 'Goalkeeper',
  'Defence': 'Defender',
  'Defender': 'Defender',
  'Midfield': 'Midfielder',
  'Midfielder': 'Midfielder',
  'Offence': 'Forward',
  'Attacker': 'Forward',
  'Forward': 'Forward'
};

// Promisified HTTPS request
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'X-Auth-Token': API_KEY
      }
    };
    
    https.get(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          // In case of rate limits or other errors
          reject(new Error(`API Error: ${res.statusCode} - ${data}`));
        }
      });
    }).on('error', (e) => {
      reject(e);
    });
  });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log("Starting data fetch from football-data.org...");
  const playersMap = new Map(); // id -> player object
  let playerIdCounter = 1;
  const playerNameToId = new Map();

  for (const season of SEASONS) {
    for (const [leagueCode, leagueName] of Object.entries(LEAGUES)) {
      console.log(`Fetching teams for ${leagueName} (${leagueCode}), Season ${season}...`);
      
      try {
        const teamsData = await fetchJson(`https://api.football-data.org/v4/competitions/${leagueCode}/teams?season=${season}`);
        const teams = teamsData.teams || [];
        
        console.log(`Found ${teams.length} teams. Processing squads...`);
        
        for (const team of teams) {
          const squad = team.squad || [];
          
          for (const member of squad) {
            if (!member.position) continue; // Skip staff or unknown
            
            const position = POSITION_MAP[member.position];
            if (!position) continue;
            
            const name = member.name;
            let id = playerNameToId.get(name);
            
            if (!id) {
              id = playerIdCounter++;
              playerNameToId.set(name, id);
              
              playersMap.set(id, {
                id: id,
                name: name,
                nationality: member.nationality || "Unknown",
                position: position,
                dateOfBirth: member.dateOfBirth || "2000-01-01",
                teams: []
              });
            }
            
            const player = playersMap.get(id);
            
            // Check if team entry exists
            let teamEntry = player.teams.find(t => t.team === team.name && t.league === leagueName);
            
            if (!teamEntry) {
              teamEntry = {
                team: team.name,
                league: leagueName,
                seasons: []
              };
              player.teams.push(teamEntry);
            }
            
            if (!teamEntry.seasons.includes(season)) {
              teamEntry.seasons.push(season);
            }
          }
        }
        
        console.log(`Processed ${leagueName} for season ${season}. Total unique players so far: ${playersMap.size}`);
        
        // Wait 6 seconds between API calls to respect 10 req/minute rate limit
        // (10 req/min = 1 req / 6 sec)
        console.log(`Waiting 6 seconds to respect rate limits...`);
        await delay(6500); // 6.5s to be safe
        
      } catch (err) {
        console.error(`Error fetching ${leagueCode} ${season}:`, err.message);
        if (err.message.includes('429')) {
          console.log("Rate limit exceeded. Waiting 30 seconds before continuing...");
          await delay(30000);
        }
      }
    }
  }

  // Convert map to array and write to file
  const playersArray = Array.from(playersMap.values());
  
  // Create dir if not exists
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(playersArray, null, 2));
  console.log(`\nSuccessfully saved ${playersArray.length} players to ${OUTPUT_FILE}`);
}

main().catch(console.error);
