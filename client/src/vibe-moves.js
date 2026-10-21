import { el } from './ui.js';
import { scopePool } from '/js/engine/index.js';
import { MIN_POOL } from '/js/engine/planner.js';
import { encodeScope } from '/lib/scope.js';

export { MIN_POOL };

/** The named moves a player can make to a vibe. Each is one sentence, not a query. */
export const MOVES = [
  { id: 'era', label: 'Different era' },
  { id: 'competition', label: 'Different competition' },
  { id: 'club', label: 'Add a club' },
  { id: 'nation', label: 'Only these nations' },
  { id: 'tournament', label: 'A tournament' },
  { id: 'stat', label: 'A narrower stat' },
];

/** The stats a threshold can be set on. The label is words, never a metric id. */
export const STAT_METRICS = [
  { id: 'goals_after_age_30', label: 'goals aged 30+' },
  { id: 'international_caps', label: 'international caps' },
  { id: 'club_goals', label: 'goals since 2012' },
  { id: 'international_goals', label: 'international goals' },
];

export function erasFor(players) {
  const set = new Set();
  for (const p of players) {
    for (const t of p.teams ?? []) {
      for (const s of t.seasons ?? []) set.add(s);
    }
  }
  const years = [...set].sort((a, b) => a - b);
  if (!years.length) return [];
  const min = years[0];
  const max = years[years.length - 1];
  const eras = [];
  for (let start = min; start + 9 <= max; start += 5) {
    eras.push({ start, end: start + 9, label: `${start}–${String(start + 9).slice(2)}` });
  }
  if (!eras.length) eras.push({ start: min, end: max, label: `${min}–${max}` });
  return eras;
}

export function competitionsFor(registry, players) {
  const counts = new Map();
  for (const p of players) {
    for (const t of p.teams ?? []) {
      if (!t.leagueId) continue;
      counts.set(t.leagueId, (counts.get(t.leagueId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({
      id,
      name: registry?.leagues?.[id] ?? id,
      players: n,
    }));
}

export function clubsFor(players) {
  const counts = new Map();
  for (const p of players) {
    for (const t of p.teams ?? []) {
      if (!t.clubId) continue;
      counts.set(t.clubId, (counts.get(t.clubId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([id, n]) => ({ id, name: countName(players, id), players: n }));
}

function countName(players, clubId) {
  for (const p of players) {
    for (const t of p.teams ?? []) {
      if (t.clubId === clubId) return t.clubName;
    }
  }
  return `Club ${clubId}`;
}

export function nationsFor(players) {
  const counts = new Map();
  for (const p of players) {
    for (const c of p.citizenship ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: id, players: n }));
}

export const STAT_MOVES = [
  { id: 'goals_after_age_30', label: '50+ goals aged 30+', op: '>=', value: 50 },
  { id: 'goals_after_age_30', label: '30+ goals aged 30+', op: '>=', value: 30 },
  { id: 'international_caps', label: '50+ international caps', op: '>=', value: 50 },
  { id: 'international_caps', label: '100+ international caps', op: '>=', value: 100 },
  { id: 'club_goals', label: '100+ goals since 2012', op: '>=', value: 100 },
];

/** Apply a move to a vibe's clauses, returning a NEW vibe. Never mutates. */
export function applyMove(vibe, move, value, players, registry) {
  const clauses = vibe.clauses.map((c) => ({ ...c }));
  switch (move) {
    case 'era': {
      const era = value;
      for (const c of clauses) {
        c.seasonStart = era.start;
        c.seasonEnd = era.end;
      }
      return { ...vibe, clauses, label: `era ${era.label}` };
    }
    case 'competition': {
      for (const c of clauses) {
        c.leagues = [value.id];
        delete c.tournaments;
        delete c.stats;
      }
      return { ...vibe, clauses, label: value.name };
    }
    case 'club': {
      const ids = clauses.flatMap((c) => c.teams ?? []);
      if (!ids.includes(value.id)) ids.push(value.id);
      for (const c of clauses) {
        c.teams = ids;
        delete c.leagues;
        delete c.tournaments;
        delete c.stats;
      }
      return { ...vibe, clauses, label: value.name };
    }
    case 'nation': {
      const ids = clauses.flatMap((c) => c.nationalities ?? []);
      if (!ids.includes(value.id)) ids.push(value.id);
      for (const c of clauses) {
        c.nationalities = ids;
        delete c.leagues;
        delete c.tournaments;
        delete c.stats;
      }
      return { ...vibe, clauses, label: value.name };
    }
    case 'tournament': {
      for (const c of clauses) {
        c.tournaments = [value.id];
        delete c.leagues;
        delete c.teams;
        delete c.nationalities;
        delete c.stats;
      }
      return { ...vibe, clauses, label: value.name };
    }
    case 'stat': {
      // A stat move's value is either a quick pick ({id, label, op, value})
      // or a threshold the player typed ({metric, op, value}).
      const metric = value.metric ?? value.id;
      const op = value.op ?? '>=';
      // A threshold refines the vibe - "La Liga, and 50+ goals" - the way
      // the era refines it. It does not throw the competition away.
      const stats = clauses.flatMap((c) => c.stats ?? []);
      const same = stats.find((s) => s.metric === metric);
      if (same) { same.value = value.value; same.op = op; }
      else stats.push({ metric, op, value: value.value });
      for (const c of clauses) {
        c.stats = stats;
      }
      return { ...vibe, clauses, label: value.label };
    }
    default:
      return vibe;
  }
}

export function moveRow(vibe, move, options, players, onPick) {
  if (!options.length) {
    return el('div', { className: 'move move--empty' }, [
      el('span', { className: 'move__label', text: move.label }),
      el('span', { className: 'muted-note', text: 'nothing to change here yet' }),
    ]);
  }
  const select = el('select', {
    className: 'move__select',
    attrs: { 'aria-label': move.label },
    on: {
      change: (e) => {
        const raw = e.target.value;
        const option = options.find((o) => String(o.key) === raw);
        if (option) onPick(move, option.value);
      },
    },
  }, [
    el('option', { text: '—', attrs: { value: '' } }),
    ...options.map((o) => el('option', { text: o.label, attrs: { value: String(o.key) } })),
  ]);

  return el('div', { className: 'move' }, [
    el('label', { className: 'move__label', text: move.label }),
    select,
  ]);
}


/** The tournaments the data knows, with how many players each has. */
export function tournamentsFor(registry, players) {
  const list = Array.isArray(registry?.tournaments) ? registry.tournaments : [];
  const counts = new Map();
  for (const p of players) {
    for (const id of p.tournaments ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return list
    .map((t) => ({ id: t.id, name: t.name, players: counts.get(t.id) ?? 0 }))
    .filter((t) => t.players > 0)
    .sort((a, b) => b.players - a.players);
}

/** The link that carries a vibe. */
export function shareLink(scope) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#vibe?c=${encodeScope(scope)}`;
}
