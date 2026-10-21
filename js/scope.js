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
  try {
    const data = localStorage.getItem('football-trivia-scopes');
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Corrupted scopes in localStorage, clearing...", e);
    localStorage.removeItem('football-trivia-scopes');
    return [];
  }
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

export const PRESET_SCOPES = [
  {
    id: 'preset-clasico',
    name: 'El Clásico Rivals',
    description: 'Barcelona & Real Madrid stars',
    icon: '🇪🇸',
    filters: [{ league: 'La Liga', seasonStart: 2020, seasonEnd: 2025 }],
    teams: ['FC Barcelona', 'Real Madrid'],
    nationalities: []
  },
  {
    id: 'preset-prem',
    name: 'Premier League Stars',
    description: 'All top England Premier League players',
    icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    filters: [{ league: 'Premier League', seasonStart: 2020, seasonEnd: 2025 }],
    teams: [],
    nationalities: []
  },
  {
    id: 'preset-latam',
    name: 'South American Stars',
    description: 'Argentine, Brazilian & Uruguayan superstars in Europe',
    icon: '🌎',
    filters: [],
    teams: [],
    nationalities: ['Argentina', 'Brazil', 'Uruguay', 'Colombia']
  },
  {
    id: 'preset-buli-seriea',
    name: 'Bundesliga & Serie A Mix',
    description: 'German and Italian top league mashup',
    icon: '⚽',
    filters: [
      { league: 'Bundesliga', seasonStart: 2020, seasonEnd: 2025 },
      { league: 'Serie A', seasonStart: 2020, seasonEnd: 2025 }
    ],
    teams: [],
    nationalities: []
  }

];

export function encodeScopeToHash(scope) {
  try {
    const jsonStr = JSON.stringify({
      n: scope.name,
      f: scope.filters,
      t: scope.teams,
      nat: scope.nationalities
    });
    return 'scope=' + encodeURIComponent(btoa(jsonStr));
  } catch (e) {
    return '';
  }
}

export function decodeScopeFromHash(hash) {
  try {
    if (!hash || !hash.includes('scope=')) return null;
    const param = hash.split('scope=')[1].split('&')[0];
    const jsonStr = atob(decodeURIComponent(param));
    const data = JSON.parse(jsonStr);
    return createScope(data.n || 'Shared Scope', data.f || [], data.t || [], data.nat || []);
  } catch (e) {
    return null;
  }
}

export function validateScope(scope, playerPool) {
  const count = playerPool.length;
  if (count < 10) {
    return { valid: false, playerCount: count, message: `Only found ${count} players. Need at least 10.` };
  }
  return { valid: true, playerCount: count, message: `${count} players match this scope.` };
}
