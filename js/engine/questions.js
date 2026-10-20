import { buildHints, hintOrder } from './hints.js';
import { metricDescriptor, metricsFor } from './stats.js';
import { RECIPES } from './recipes.js';
import { numericDistractors, nameDistractors, buildOptions } from './distractors.js';

export function informativeness(value, values) {
  if (value === undefined || value === null) return 0;
  const distinct = new Set(values.filter(v => v !== undefined && v !== null));
  if (distinct.size <= 1) return 0;
  return 1 - (1 / distinct.size);
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
    if (window?.id && subject.windows?.[window.id]?.goals !== undefined) return subject.windows[window.id].goals;
    return subject.stats?.club_goals;
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
  const descriptor = metricDescriptor(metric);
  const recipe = RECIPES.find(r => r.metric === metric && r.windowKinds.includes(window?.kind ?? 'career'))
    ?? RECIPES.find(r => r.metric === 'identity');

  const value = metricValue(subject, metric, window);
  const spoken = recipe.speak({ subject, window, value, pool, registry });

  const hints = hintOrder(buildHints(subject, window, registry));
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
    metric,
    family: recipe.family ?? descriptor?.family ?? 'career',
    prompt: spoken.prompt,
    context: spoken.context ?? null,
    subjectId: subject.id,
    subjectName: subject.name,
    answer: spoken.answer,
    unit: spoken.unit ?? descriptor?.unit ?? null,
    options,
    clues: clues.map(c => ({ id: c.id, label: c.label, value: c.value, iconKey: c.iconKey })),
    revealSchedule,
    difficulty,
  };
}
