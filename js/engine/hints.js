import { formatMetric, metricsFor } from './stats.js';

const ICONS = {
  nat: 'nat', pos: 'pos', path: 'path', shirt: 'shirt', honors: 'honors',
  value: 'value', age: 'age', league: 'league', team: 'team', name: 'name',
};

export function buildHints(subject, window, registry, { limit } = {}) {
  const hints = [];

  const nationality = subject.nationality ?? subject.citizenship?.[0];
  if (nationality) {
    hints.push({ id: 'nationality', label: 'Nationality', value: nationality, iconKey: ICONS.nat, family: 'career', surface: true });
  }
  if (subject.position) {
    const foot = subject.foot ? ` (${subject.foot.toLowerCase()}-footed)` : '';
    hints.push({ id: 'position', label: 'Position', value: `${subject.position}${foot}`, iconKey: ICONS.pos, family: 'career', surface: true });
  }
  if (subject.dateOfBirth) {
    hints.push({ id: 'age', label: 'Born', value: `Born ${subject.dateOfBirth.slice(0, 4)}`, iconKey: ICONS.age, family: 'career', surface: true });
  }

  const path = (subject.teams ?? []).map(t => t.clubName).filter(Boolean);
  if (path.length) {
    hints.push({ id: 'clubs', label: 'Career clubs', value: path.join(' → '), iconKey: ICONS.path, family: 'career', surface: false });
  }

  const leagues = [...new Set((subject.teams ?? []).map(t => t.leagueName).filter(Boolean))];
  if (leagues.length) {
    hints.push({ id: 'leagues', label: 'Leagues', value: leagues.join(', '), iconKey: ICONS.league, family: 'career', surface: false });
  }

  for (const m of metricsFor(subject, window)) {
    hints.push({
      id: m.id,
      label: m.label,
      // The reading's window, so the clue says which window the number
      // belongs to.
      value: formatMetric(m.id, m.value, m.window ?? window),
      iconKey: m.family === 'roster' ? ICONS.honors : m.id === 'highest_market_value_eur' ? ICONS.value : ICONS.honors,
      family: m.family,
      surface: false,
      metric: m.id,
      window: window?.id ?? null,
    });
  }

  return hintOrder(hints).slice(0, limit);
}

const RANK = { window: 0, roster: 1, path: 2, surface: 3 };

export function hintRank(hint) {
  if (hint.family === 'window' || hint.family === 'roster') return RANK.window;
  if (hint.surface) return RANK.surface;
  return RANK.path;
}

export function hintOrder(hints) {
  return [...hints].sort((a, b) => {
    const d = hintRank(a) - hintRank(b);
    if (d !== 0) return d;
    return 0;
  });
}
