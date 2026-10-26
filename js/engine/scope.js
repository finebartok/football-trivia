import { overlapsSeason } from '../../lib/seasons.js';

const OPS = {
  '>=': (v, t) => v >= t,
  '>': (v, t) => v > t,
  '<=': (v, t) => v <= t,
  '<': (v, t) => v < t,
  '==': (v, t) => v === t,
  between: (v, t) => v >= t[0] && v <= t[1],
};

// Career metrics live on the player row itself; windowed metrics live in
// `stats`. A predicate must find either, so the matcher resolves both rather
// than assuming one shape.
const CAREER_FIELDS = {
  international_caps: 'internationalCaps',
  international_goals: 'internationalGoals',
  highest_market_value_eur: 'highestMarketValueEur',
};

export function statMatches(pred, stats, player = null) {
  let v = stats?.[pred.metric];
  if ((v === undefined || v === null) && player) {
    const field = CAREER_FIELDS[pred.metric];
    if (field) v = player[field];
  }
  if (v === undefined || v === null) return false;
  const op = OPS[pred.op];
  if (!op) return false;
  return op(v, pred.value);
}

export function clauseMatches(clause, player) {
  const L = clause.leagues?.length ? clause.leagues : null;
  const T = clause.teams?.length ? clause.teams : null;
  const N = clause.nationalities?.length ? clause.nationalities : null;
  const P = clause.positions?.length ? clause.positions : null;
  const R = clause.tournaments?.length ? clause.tournaments : null;
  const S = clause.seasons?.length ? clause.seasons : null;

  if (N && !N.includes(player.nationality) && !(player.citizenship ?? []).some(c => N.includes(c))) return false;
  if (P && !P.includes(player.position)) return false;
  if (R && !(player.tournaments ?? []).some(t => R.includes(t))) return false;

  if (clause.stats?.length) {
    if (!clause.stats.every(p => statMatches(p, player.stats, player))) return false;
  }

  const needsEntry = L || T || S || clause.seasonStart != null || clause.seasonEnd != null;
  if (!needsEntry) return true;

  return (player.teams ?? []).some(e => {
    if (L && !L.includes(e.leagueId)) return false;
    if (T && !T.includes(e.clubId)) return false;
    if (S && !(e.seasons ?? []).some(s => S.includes(s))) return false;
    if (clause.seasonStart != null || clause.seasonEnd != null) {
      if (!overlapsSeason(e.seasons, clause.seasonStart, clause.seasonEnd)) return false;
    }
    return true;
  });
}

export function playerInScope(player, scope) {
  if (!scope || !Array.isArray(scope.clauses) || scope.clauses.length === 0) return true;
  return scope.clauses.some(c => clauseMatches(c, player));
}

export function scopePool(scope, pool) {
  return (pool ?? []).filter(p => playerInScope(p, scope));
}
