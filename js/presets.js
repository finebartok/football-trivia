/**
 * The vibes a player can pick.
 *
 * This module is shared. The browser shows these; the server resolves a
 * room's scope from one by id, so a client cannot hand the server a scope
 * of its own making.
 */

export const PRESETS = [
  { id: 'laliga-2010s', name: 'La Liga 2010s', desc: 'A decade of Spanish football', icon: '🇪🇸', clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }], pool: 1854 },
  { id: 'premier-2010s', name: 'Premier League 2010s', desc: 'A decade of English football', icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }], pool: 1924 },
  { id: 'premier-2425', name: 'Premier League 2024/25', desc: 'Last season, right now', icon: '🆕', clauses: [{ leagues: ['GB1'], seasonStart: 2024, seasonEnd: 2025 }], pool: 1983 },
  { id: 'wc-2022', name: 'World Cup 2022', desc: 'Every squad in Qatar', icon: '🏆', clauses: [{ tournaments: ['wc-2022'] }], pool: 231 },
  { id: 'late-bloomers', name: 'Late Bloomers', desc: '50+ goals aged 30+', icon: '🎯', clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 50 }] }], pool: 111 },
  { id: 'ever-capped', name: 'Ever Capped', desc: '50+ international caps', icon: '🎽', clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 50 }] }], pool: 1023 },
  { id: 'centurion-club', name: 'Century Club', desc: '100+ goals since 2012', icon: '💯', clauses: [{ stats: [{ metric: 'club_goals', op: '>=', value: 100 }] }], pool: 160 },
];

/** The preset with this id, or null. The server uses it to resolve a scope. */
export function presetById(id) {
  return PRESETS.find((p) => p.id === id) ?? null;
}
