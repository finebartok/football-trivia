function millions(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `€${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
}

function withWindow(text, window) {
  if (!window) return text;
  if (window.kind === 'season_range') {
    return `${text} (${window.seasonStart ?? ''}–${window.seasonEnd ?? ''})`;
  }
  if (window.seasonStart != null && window.kind !== 'career') {
    return `${text} (since ${window.seasonStart})`;
  }
  if (window.label) return `${text} — ${window.label}`;
  return text;
}

export const METRICS = Object.freeze({
  international_caps: {
    id: 'international_caps', label: 'International caps', unit: 'caps', exact: true, family: 'career',
    format: v => String(v),
  },
  international_goals: {
    id: 'international_goals', label: 'International goals', unit: 'goals', exact: true, family: 'career',
    format: v => String(v),
  },
  highest_market_value_eur: {
    id: 'highest_market_value_eur', label: 'Peak market value', unit: '€M', exact: true, family: 'career',
    format: v => millions(v),
  },
  club_goals: {
    id: 'club_goals', label: 'Goals', unit: 'goals', exact: false, family: 'window',
    format: v => String(v),
  },
  club_appearances: {
    id: 'club_appearances', label: 'Appearances', unit: 'apps', exact: false, family: 'window',
    format: v => String(v),
  },
  goals_after_age_30: {
    id: 'goals_after_age_30', label: 'Goals aged 30+', unit: 'goals', exact: false, family: 'window',
    format: v => `${v}+`,
  },
  tournament_goals: {
    id: 'tournament_goals', label: 'Tournament goals', unit: 'goals', exact: true, family: 'roster',
    format: v => String(v),
  },
  scarcity_peers: {
    id: 'scarcity_peers', label: 'Players with this', unit: 'players', exact: true, family: 'scarcity',
    format: v => `${v} players`,
  },
});

export function metricDescriptor(id) {
  return METRICS[id] ?? null;
}

export function formatMetric(id, value, window) {
  const m = METRICS[id];
  if (!m) return String(value);
  const text = m.format(value);
  return m.exact ? text : withWindow(text, window);
}

// For these metrics a 0 means "the source recorded nothing", not "the value
// is zero". A player with no caps must not be shown as "0 caps".
const ZERO_MEANS_ABSENT = new Set([
  'international_caps', 'international_goals', 'highest_market_value_eur',
]);

export function metricsFor(player, window) {
  const out = [];
  for (const m of Object.values(METRICS)) {
    let value;
    if (m.id === 'international_caps') value = player.internationalCaps;
    else if (m.id === 'international_goals') value = player.internationalGoals;
    else if (m.id === 'highest_market_value_eur') value = player.highestMarketValueEur;
    else if (m.id === 'tournament_goals') {
      value = window?.id ? (player.windows?.[window.id]?.goals) : undefined;
    } else if (m.id === 'scarcity_peers') {
      value = player.stats?.scarcity_peers;
    } else if (m.id === 'tournament_goals') {
      // A tournament window holds tournament goals. It is not a club season,
      // so club_goals must not read it - otherwise one number produces two
      // identical clues, one of them mislabelled.
      value = (window?.kind === 'tournament' && window?.id)
        ? player.windows?.[window.id]?.goals
        : undefined;
    } else if (m.id === 'club_goals' || m.id === 'club_appearances') {
      if (window?.kind === 'tournament') {
        value = undefined;
      } else if (window?.id) {
        const w = player.windows?.[window.id] ?? {};
        value = m.id === 'club_goals' ? (w.goals ?? w.club_goals) : (w.appearances ?? w.club_appearances);
      }
    } else if (window?.id && player.windows?.[window.id]?.[m.id] !== undefined) {
      value = player.windows[window.id][m.id];
    } else if (!window && player.stats?.[m.id] !== undefined) {
      // A career total is only a valid answer when no window is in play. With
      // a window, the window IS the scope of the claim - a career figure
      // dressed as a windowed one is the "199 goals since 2012" mistake again.
      value = player.stats[m.id];
    }
    if (value === undefined || value === null) continue;
    if (value === 0 && ZERO_MEANS_ABSENT.has(m.id)) continue;
    out.push({ ...m, value });
  }
  return out;
}
