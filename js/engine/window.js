export function windowLabel(window) {
  if (!window) return '';
  if (window.label) return window.label;
  if (window.kind === 'season_range') return `${window.leagueName ?? ''} ${window.seasonStart}-${window.seasonEnd}`.trim();
  return window.id ?? '';
}

export function resolveWindow(scope, registry) {
  if (scope?.window) {
    const explicit = registry?.windows?.[scope.window];
    if (explicit) return explicit;
  }
  for (const clause of scope?.clauses ?? []) {
    if (clause.tournaments?.length) {
      const id = clause.tournaments[0];
      const w = registry?.windows?.[id];
      if (w) return w;
      const t = registry?.tournaments?.find(x => x.id === id);
      if (t) {
        return {
          id, kind: 'tournament', label: `${t.year} ${t.name.replace(/^\d{4}\s*/, '')}`,
          detail: 'the tournament', seasonStart: t.year, seasonEnd: t.year,
          tournamentId: id, clubId: null, teamName: null, ageFrom: null, ageTo: null,
        };
      }
    }
    if (clause.leagues?.length && (clause.seasonStart != null || clause.seasonEnd != null)) {
      const leagueId = clause.leagues[0];
      const leagueName = registry?.leagues?.[leagueId] ?? leagueId;
      return {
        id: `range-${leagueId}-${clause.seasonStart ?? '*'}-${clause.seasonEnd ?? '*'}`,
        kind: 'season_range',
        label: `${leagueName} ${clause.seasonStart ?? ''}${clause.seasonEnd != null ? `-${clause.seasonEnd}` : ''}`.trim(),
        detail: 'the era', seasonStart: clause.seasonStart ?? null, seasonEnd: clause.seasonEnd ?? null,
        tournamentId: null, clubId: null, teamName: null, ageFrom: null, ageTo: null,
        leagueId, leagueName,
      };
    }
    if (clause.stats?.length) {
      const s = clause.stats[0];
      if (s.metric?.startsWith('goals_after_age_')) {
        const age = Number(s.metric.replace('goals_after_age_', ''));
        return {
          id: `age-${age}`, kind: 'age_band', label: `players aged ${age}+`, detail: 'the age band',
          seasonStart: null, seasonEnd: null, tournamentId: null, clubId: null, teamName: null,
          ageFrom: age, ageTo: null,
        };
      }
    }
  }
  return null;
}

export function windowsForPlayer(player, registry) {
  return Object.keys(player.windows ?? {})
    .map(id => registry?.windows?.[id])
    .filter(Boolean);
}

export function windowForPlayer(player, window) {
  if (!window) return null;
  if (window.kind === 'tournament') {
    return registrySafe(player, window) ? window : null;
  }
  return window;
}

function registrySafe(player, window) {
  return Object.prototype.hasOwnProperty.call(player.windows ?? {}, window.id);
}
