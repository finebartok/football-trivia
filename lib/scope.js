/**
 * The advice around a scope.
 *
 * The engine decides which players a scope matches. This module decides
 * what to tell a person about that scope: the nearest threshold that
 * still works, the sentence that explains a thin pool, the link that
 * carries it, and whether the server will accept it.
 *
 * Pure, and shared by the browser, the Node scripts and the server.
 */
import { scopePool } from '../js/engine/scope.js';
import { METRICS } from '../js/engine/stats.js';
import { MIN_POOL } from '../js/engine/planner.js';

const OPS = new Set(['>=', '>', '<=', '<', '=', '!=']);

/** The players a scope resolves to, with one stat threshold replaced. */
function poolFor(scope, metric, value, players, op = '>=') {
  const clauses = scope.clauses.map((c) => {
    if (!c.stats) return { ...c };
    return {
      ...c,
      stats: c.stats.map((s) => (s.metric === metric ? { ...s, op, value } : { ...s })),
    };
  });
  return scopePool({ clauses }, players);
}

/**
 * The nearest threshold that still clears the floor.
 *
 * A ">= threshold" pool shrinks monotonically as the threshold rises, so
 * this is a binary search rather than a scan. It looks downward first:
 * the largest threshold at or below the typed one whose pool still holds,
 * and failing that, the smallest one above it that does.
 */
export function nearestThreshold({ scope, metric, op = '>=', players, floor = MIN_POOL, min = 0, max = 5000 }) {
  const countAt = (value) => poolFor(scope, metric, value, players, op).length;

  // A threshold that already holds needs no suggestion.
  const typed = thresholdIn(scope, metric);
  if (typed !== null && countAt(typed) >= floor) {
    return { value: typed, count: countAt(typed) };
  }

  const search = (lo, hi) => {
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (countAt(mid) >= floor) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi;
  };

  const below = search(min, Math.min(max, typed ?? max));
  if (below >= min && countAt(below) >= floor) {
    return { value: below, count: countAt(below) };
  }

  const above = search(Math.max(min, (typed ?? min) + 1), max);
  if (above <= max && countAt(above) >= floor) {
    return { value: above, count: countAt(above) };
  }

  return null;
}

/** The threshold the scope already carries for this metric, or null. */
function thresholdIn(scope, metric) {
  for (const clause of scope.clauses ?? []) {
    for (const stat of clause.stats ?? []) {
      if (stat.metric === metric) return Number(stat.value);
    }
  }
  return null;
}

/** How a threshold reads in a sentence: "goals aged 30+", never a metric id. */
export function metricLabel(metric) {
  switch (metric) {
    case 'goals_after_age_30': return 'goals aged 30+';
    case 'international_caps': return 'international caps';
    case 'club_goals': return 'goals since 2012';
    case 'international_goals': return 'international goals';
    default: return 'the stat';
  }
}

/**
 * The sentence a player reads when the pool is too thin.
 *
 * It says how many players there are and what the floor is. It never says
 * "scope", "predicate" or a metric id.
 */
export function describeCoverage({ scope, count, floor = MIN_POOL, registry }) {
  if (count >= floor) return '';
  const what = describeScope(scope, registry);
  return `Only ${count} ${count === 1 ? 'player' : 'players'} fit ${what}. A vibe needs at least ${floor}.`;
}

/** A short description of what a scope points at, in words. */
export function describeScope(scope, registry) {
  const clause = scope?.clauses?.[0] ?? {};
  if (clause.tournaments?.length) {
    const name = clause.tournaments.map((id) => tournamentName(id, registry)).join(' or ');
    return name ? `${name}` : 'that tournament';
  }
  if (clause.clubs?.length) {
    return clause.clubs.length === 1 ? 'that club' : 'those clubs';
  }
  if (clause.nationalities?.length) {
    return clause.nationalities.length === 1 ? `players from ${clause.nationalities[0]}` : 'those nations';
  }
  if (clause.leagues?.length) {
    const names = clause.leagues.map((id) => leagueName(id, registry)).filter(Boolean);
    const years = clause.seasonStart && clause.seasonEnd ? `, ${clause.seasonStart}-${clause.seasonEnd}` : '';
    return `${names.join(' or ') || 'that competition'}${years}`;
  }
  if (clause.stats?.length) {
    const stat = clause.stats[0];
    return `${stat.value}+ ${metricLabel(stat.metric)}`;
  }
  return 'that vibe';
}

/** The league's name. The registry holds names, never the code. */
function leagueName(id, registry) {
  const name = registry?.leagues?.[id];
  if (typeof name === 'string') return name;
  return name?.name ?? '';
}

function tournamentName(id, registry) {
  const list = registry?.tournaments ?? [];
  const found = Array.isArray(list) ? list.find((t) => t.id === id) : list?.[id];
  return found?.name ?? '';
}

/** The scope's clauses, name and icon, as a link payload. */
export function encodeScope(scope) {
  const payload = { name: scope.name ?? '', icon: scope.icon ?? '', clauses: scope.clauses ?? [] };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * The scope a link carries, or null.
 *
 * A link that has been edited, truncated or is not a scope at all
 * decodes to null. It never decodes to half a scope.
 */
export function decodeScope(code) {
  if (!code || typeof code !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!Array.isArray(parsed.clauses)) return null;
  return { name: parsed.name ?? '', icon: parsed.icon ?? '', clauses: parsed.clauses };
}

/**
 * Is this a scope the server will accept?
 *
 * The shape, not the size: the floor is checked where the size is known.
 */
export function validateScope(scope, { registry = {}, players = [] } = {}) {
  if (!scope || !Array.isArray(scope.clauses) || scope.clauses.length === 0) {
    return { ok: false, reason: 'That vibe has nothing in it.' };
  }

  const knownNations = new Set();
  for (const p of players ?? []) {
    for (const c of p.citizenship ?? []) knownNations.add(c);
  }

  const knownTournaments = new Set(
    (Array.isArray(registry?.tournaments) ? registry.tournaments : []).map((t) => t.id),
  );

  for (const clause of scope.clauses) {
    for (const id of clause.leagues ?? []) {
      if (!registry?.leagues?.[id]) return { ok: false, reason: 'That competition is not one the data knows.' };
    }
    for (const id of clause.clubs ?? []) {
      if (!registry?.clubs?.[id]) return { ok: false, reason: 'That club is not one the data knows.' };
    }
    for (const id of clause.nationalities ?? []) {
      if (!knownNations.has(id)) return { ok: false, reason: 'That nation is not one the data knows.' };
    }
    for (const id of clause.tournaments ?? []) {
      if (!knownTournaments.has(id)) return { ok: false, reason: 'That tournament is not one the data knows.' };
    }
    for (const stat of clause.stats ?? []) {
      if (!METRICS[stat.metric]) return { ok: false, reason: 'That stat is not one the data knows.' };
      if (!OPS.has(stat.op)) return { ok: false, reason: 'That comparison is not one the data knows.' };
      if (typeof stat.value !== 'number' || !Number.isFinite(stat.value)) {
        return { ok: false, reason: 'That number is not a number.' };
      }
    }
    for (const key of ['seasonStart', 'seasonEnd']) {
      if (clause[key] !== undefined && typeof clause[key] !== 'number') {
        return { ok: false, reason: 'That era is not a pair of years.' };
      }
    }
  }

  return { ok: true };
}
