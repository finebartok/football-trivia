let playersData = [];

export async function loadData() {
  try {
    // Try live SQLite REST API endpoint first
    let response = await fetch('/api/players');
    if (!response.ok) {
      response = await fetch('./data/players.json');
    }
    playersData = await response.json();
    console.log(`Loaded ${playersData.length} official real players from database.`);
    return playersData;
  } catch (error) {
    console.error("Could not load players data:", error);
    try {
      const fallback = await fetch('./data/players.json');
      playersData = await fallback.json();
      return playersData;
    } catch (e) {
      return [];
    }
  }
}

export function getAllPlayers() {
  return playersData;
}

export function getPlayersByScope(scope) {
  if (!scope || !scope.filters || scope.filters.length === 0) {
    return playersData;
  }

  return playersData.filter(player => {
    // 1. Check union of league/season filters
    const matchesUnion = scope.filters.some(filter => {
      // Check if player has any team entry that matches this filter
      return player.teams.some(teamEntry => {
        if (teamEntry.league !== filter.league) {
          return false;
        }
        
        // Ensure player played in the league during the filter's season range
        return teamEntry.seasons.some(season => 
          season >= filter.seasonStart && season <= filter.seasonEnd
        );
      });
    });

    if (!matchesUnion) return false;

    // 2. Apply intersection constraints (teams and nationalities)
    if (scope.teams && scope.teams.length > 0) {
      const playedForAnyTeam = player.teams.some(teamEntry => 
        scope.teams.includes(teamEntry.team)
      );
      if (!playedForAnyTeam) return false;
    }

    if (scope.nationalities && scope.nationalities.length > 0) {
      if (!scope.nationalities.includes(player.nationality)) return false;
    }

    return true;
  });
}

export function getLeagues() {
  const leagues = new Set();
  playersData.forEach(player => {
    player.teams.forEach(teamEntry => {
      leagues.add(teamEntry.league);
    });
  });
  return Array.from(leagues).sort();
}

export function getTeams(league) {
  const teams = new Set();
  playersData.forEach(player => {
    player.teams.forEach(teamEntry => {
      if (!league || teamEntry.league === league) {
        teams.add(teamEntry.team);
      }
    });
  });
  return Array.from(teams).sort();
}

export function getNationalities() {
  const nationalities = new Set();
  playersData.forEach(player => {
    nationalities.add(player.nationality);
  });
  return Array.from(nationalities).sort();
}

export function getSeasonRange() {
  let min = Infinity;
  let max = -Infinity;
  
  playersData.forEach(player => {
    player.teams.forEach(teamEntry => {
      teamEntry.seasons.forEach(season => {
        if (season < min) min = season;
        if (season > max) max = season;
      });
    });
  });
  
  if (min === Infinity) return { start: 2020, end: 2025 };
  return { start: min, end: max };
}

export function searchPlayers(query, playerPool) {
  if (!query || query.trim() === '') return [];
  
  const pool = playerPool || playersData;
  const lowerQuery = query.toLowerCase().trim();
  
  return pool
    .filter(player => player.name.toLowerCase().includes(lowerQuery))
    .slice(0, 8);
}
