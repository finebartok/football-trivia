import { generateId } from './utils.js';

export function createScope(name, filters, teams = [], nationalities = []) {
  return {
    name,
    id: generateId(),
    filters: filters || [],
    teams: teams || [],
    nationalities: nationalities || [],
    createdAt: Date.now()
  };
}

export function saveScope(scope) {
  const scopes = loadScopes();
  const existingIndex = scopes.findIndex(s => s.id === scope.id);
  if (existingIndex >= 0) {
    scopes[existingIndex] = scope;
  } else {
    scopes.push(scope);
  }
  localStorage.setItem('football-trivia-scopes', JSON.stringify(scopes));
}

export function loadScopes() {
  const data = localStorage.getItem('football-trivia-scopes');
  return data ? JSON.parse(data) : [];
}

export function deleteScope(scopeId) {
  const scopes = loadScopes();
  const filtered = scopes.filter(s => s.id !== scopeId);
  localStorage.setItem('football-trivia-scopes', JSON.stringify(filtered));
}

export function getScopeById(scopeId) {
  const scopes = loadScopes();
  return scopes.find(s => s.id === scopeId);
}

export function createQuickPlayScope() {
  return createScope("Quick Play", [], [], []);
}

export function getScopeSummary(scope) {
  const leagueAbbr = {
    "Premier League": "PL",
    "La Liga": "La Liga",
    "Bundesliga": "BuLi",
    "Serie A": "Serie A",
    "Ligue 1": "L1"
  };

  if (!scope.filters || scope.filters.length === 0) return "All Leagues, All Eras";
  
  const summaries = scope.filters.map(f => {
    const abbr = leagueAbbr[f.league] || f.league;
    return `${abbr} ${f.seasonStart}-${f.seasonEnd.toString().slice(2)}`;
  });
  
  let result = summaries.join(" + ");
  if (scope.teams && scope.teams.length > 0) {
    result += ` | ${scope.teams.length} Teams`;
  }
  if (scope.nationalities && scope.nationalities.length > 0) {
    result += ` | ${scope.nationalities.length} Nations`;
  }
  
  return result;
}

export function validateScope(scope, playerPool) {
  const count = playerPool.length;
  if (count < 10) {
    return { valid: false, playerCount: count, message: `Only found ${count} players. Need at least 10.` };
  }
  return { valid: true, playerCount: count, message: `${count} players match this scope.` };
}
