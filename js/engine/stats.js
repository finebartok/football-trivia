function millions(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `€${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
}

function withWindow(text, window) {
  if (!window) return text;
  if (window.kind === 'since') {
    return `${text} (since ${window.seasonStart})`;
  }
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
    // The dataset's club windows start at 2012/13, so the total in the
    // career slot is a "since 2012" figure and not a full career.
    window: { kind: 'since', seasonStart: 2012 },
    format: v => String(v),
  },
  club_appearances: {
    id: 'club_appearances', label: 'Appearances', unit: 'apps', exact: false, family: 'window',
    window: { kind: 'since', seasonStart: 2012 },
    format: v => String(v),
  },
  goals_after_age_30: {
    id: 'goals_after_age_30', label: 'Goals aged 30+', unit: 'goals', exact: false, family: 'window',
    // The data for this one only exists from 2012 onwards, whatever the
    // scope's window is. It carries its own window so the clue can say so.
    window: { kind: 'since', seasonStart: 2012 },
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
  if (m.exact) return text;
  // The window that came with the reading wins over the metric's own: a
  // season's goals are that season's, whatever the metric's window is.
  return withWindow(text, window ?? m.window);
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
    // Whether the value came from the player's own figures rather than
    // from the scope's window.
    let own = false;
    if (m.id === 'international_caps') value = player.internationalCaps;
    else if (m.id === 'international_goals') value = player.internationalGoals;
    else if (m.id === 'highest_market_value_eur') value = player.highestMarketValueEur;
    else if (m.id === 'scarcity_peers') {
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
        // A tournament window holds tournament goals. It is not a club
        // season, so club_goals must not read it - otherwise one number
        // produces two identical clues, one of them mislabelled.
        value = undefined;
      } else if (window?.id) {
        const w = player.windows?.[window.id] ?? {};
        value = m.id === 'club_goals' ? (w.goals ?? w.club_goals) : (w.appearances ?? w.club_appearances);
      } else {
        // No window in play: the dataset's own total, which is the sum of
        // the windows the dataset holds - 2012/13 onwards.
        value = player.stats?.[m.id];
        own = true;
      }
    } else if (m.window) {
      // The metric carries its own window, so its value is the player's
      // own figure and not the scope's. "50+ goals aged 30+" is the same
      // fact whatever era the scope is about.
      value = player.stats?.[m.id];
      own = true;
    } else if (window?.id && player.windows?.[window.id]?.[m.id] !== undefined) {
      value = player.windows[window.id][m.id];
    }
    if (value === undefined || value === null) continue;
    if (value === 0 && ZERO_MEANS_ABSENT.has(m.id)) continue;
    // The reading's window: the scope's, or the metric's own when the
    // value came from the player's own figures.
    out.push({ ...m, value, window: own ? m.window : window });
  }
  return out;
}
