import { buildHints, hintOrder } from './hints.js';
import { metricDescriptor, metricsFor } from './stats.js';
import { RECIPES } from './recipes.js';
import { numericDistractors, nameDistractors, buildOptions } from './distractors.js';

export function informativeness(value, values) {
  if (value === undefined || value === null) return 0;
  const present = values.filter(v => v !== undefined && v !== null);
  if (present.length === 0) return 0;
  // Share of the pool whose value differs from this one: a value everybody
  // shares scores 0; a value only this player has scores ~1.
  return present.filter(v => v !== value).length / present.length;
}

function metricValue(subject, metric, window) {
  if (metric === 'identity') return subject.name;
  if (metric === 'international_caps') return subject.internationalCaps;
  if (metric === 'international_goals') return subject.internationalGoals;
  if (metric === 'highest_market_value_eur') return subject.highestMarketValueEur;
  if (metric === 'scarcity_peers') return subject.stats?.scarcity_peers;
  if (metric === 'tournament_goals') {
    return window?.id ? (subject.windows?.[window.id]?.goals) : undefined;
  }
  if (metric === 'club_goals') {
    // A windowed metric never falls back to a career total: "61 goals in
    // 2014-15" and "300 career goals" are different facts. No window id, no
    // value — missing stays undefined, it never becomes 0.
    return window?.id && subject.windows?.[window.id]?.goals !== undefined
      ? subject.windows[window.id].goals
      : undefined;
  }
  if (metric === 'goals_after_age_30') return subject.stats?.goals_after_age_30;
  return undefined;
}

export function candidateSubjects({ scope, pool, registry, window, metric }) {
  // An identify round can ask about any player in the pool. What makes one
  // better than another is how many real facts the hints can carry, because
  // that is what makes the question discriminable rather than a coin flip.
  if (metric === 'identity') {
    return (pool ?? [])
      .map(subject => ({ subject, value: subject.name, score: 1 + metricsFor(subject, window).length }))
      .sort((a, b) => b.score - a.score);
  }

  const values = (pool ?? []).map(s => metricValue(s, metric, window)).filter(v => v !== undefined && v !== null && v > 0);
  const out = [];
  for (const subject of pool ?? []) {
    const value = metricValue(subject, metric, window);
    if (value === undefined || value === null || value <= 0) continue;
    const score = informativeness(value, values);
    if (score <= 0) continue;
    out.push({ subject, value, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function composeRound({ subject, metric, window, scope, registry, pool, rng, difficulty = 'medium', roundMs = 20000, stages = 4 }) {
  const recipe = RECIPES.find(r => r.metric === metric && r.windowKinds.includes(window?.kind ?? 'career'));
  if (!recipe) {
    throw new Error(`composeRound: no recipe for metric "${metric}" in window kind "${window?.kind ?? 'career'}"`);
  }

  const value = metricValue(subject, metric, window);
  if (value === undefined || value === null) {
    throw new Error(`composeRound: no value for metric "${metric}" on subject ${subject.id}`);
  }

  const spoken = recipe.speak({ subject, window, value, pool, registry });

  // Never let the hint ladder reveal the answer. A hint whose value contains
  // the answer's number gives the stat away: a club_goals hint "60 goals
  // (since 2012)" shares the same windows[id].goals as a tournament_goals=60
  // round under a different metric id, so we match by the answer's number,
  // not by metric id.
  const answerToken = new RegExp(`\\b${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const hints = hintOrder(buildHints(subject, window, registry))
    .filter(h => !answerToken.test(String(h.value ?? '')));
  const clues = hints.slice(0, Math.max(1, stages));

  const isNumeric = recipe.template === 'stat_value';
  const distractors = isNumeric
    ? numericDistractors({ value, pool, subject, metric, window, rng, count: 3 }).map(String)
    : nameDistractors({ pool, subject, scope, rng, count: 3 });

  const options = buildOptions({ answer: spoken.answer, distractors, rng });

  // Stages land at 2.0s, 6.5s, 11.0s and 15.5s, so the last clue always
  // arrives before the round closes at 20s.
  const revealSchedule = clues.map((_, i) => ({
    stage: i + 1,
    revealAtMs: Math.min(roundMs - 500, 2000 + i * 4500),
  }));

  return {
    template: recipe.template,
    metric: recipe.metric,
    family: recipe.family ?? metricDescriptor(metric)?.family ?? 'career',
    prompt: spoken.prompt,
    context: spoken.context ?? null,
    subjectId: subject.id,
    subjectName: subject.name,
    answer: spoken.answer,
    unit: spoken.unit ?? null,
    options,
    clues: clues.map(c => ({ id: c.id, label: c.label, value: c.value, iconKey: c.iconKey })),
    revealSchedule,
    difficulty,
  };
}
