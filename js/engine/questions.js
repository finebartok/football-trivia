import { buildHints, hintOrder, identityHook, familyClues } from './hints.js';
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

export function metricValue(subject, metric, window) {
  if (metric === 'identity') return subject.name;
  if (metric === 'international_caps') return subject.internationalCaps;
  if (metric === 'international_goals') return subject.internationalGoals;
  if (metric === 'highest_market_value_eur') return subject.highestMarketValueEur;
  if (metric === 'scarcity_peers') return subject.stats?.scarcity_peers;
  if (metric === 'tournament_goals') {
    return window?.id ? (subject.windows?.[window.id]?.goals) : undefined;
  }
  if (metric === 'club_goals') {
    // A season reads that season's window. A career reading is the
    // dataset's own total, which starts in 2012/13.
    if (window?.kind === 'season') {
      return subject.windows?.[window.id]?.goals;
    }
    if (window?.kind === 'tournament') return undefined;
    return subject.stats?.club_goals;
  }
  if (metric === 'club_appearances') {
    if (window?.kind === 'season') {
      const entry = subject.windows?.[window.id];
      return entry?.appearances ?? entry?.club_appearances;
    }
    if (window?.kind === 'tournament') return undefined;
    return subject.stats?.club_appearances;
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

function dedupeById(hints) {
  const seen = new Set();
  return hints.filter((hint) => {
    if (!hint?.id || seen.has(hint.id)) return false;
    seen.add(hint.id);
    return true;
  });
}

/** The v1.2 mixed ladder: the vibe's number, the trail, a record, then a surface fact. */
function mixedOrder(ladder, n) {
  const hard = ladder.filter((h) => h.role === 'stage' || h.role === 'trail' || h.role === 'record');
  const profile = ladder.find((h) => h.role === 'profile');
  const home = ladder.find((h) => h.role === 'home');
  const ordered = [...hard];
  if (profile) ordered.push(profile);
  if (home) ordered.push(home);
  return home && n > 1
    ? [...ordered.filter((h) => h !== home).slice(0, n - 1), home]
    : ordered.slice(0, n);
}

export function composeRound({ subject, metric, window, scope, registry, pool, rng, difficulty = 'medium', roundMs = 20000, stages = 4, clueFamily = 'mixed' }) {
  const recipe = RECIPES.find(r => r.metric === metric && r.windowKinds.includes(window?.kind ?? 'career'));
  if (!recipe) {
    throw new Error(`composeRound: no recipe for metric "${metric}" in window kind "${window?.kind ?? 'career'}"`);
  }

  const value = metricValue(subject, metric, window);
  if (value === undefined || value === null) {
    throw new Error(`composeRound: no value for metric "${metric}" on subject ${subject.id}`);
  }

  const spoken = recipe.speak({ subject, window, value, pool, registry });

  // Extract every number rendered in a hint's value so we compare numerically
  // rather than with a word-boundary regex. A word boundary fails against
  // adjacent word characters: "€80M" does not match \b80\b even though 80 is
  // the answer, while "204 caps" must not be treated as an 80-caps answer.
  function numbersIn(text) {
    return (String(text ?? '').match(/\d+/g) ?? []).map(Number);
  }
  function hintRevealsAnswer(hint, answer) {
    if (answer === undefined || answer === null) return false;
    const answerNumber = Number(answer);
    if (!Number.isFinite(answerNumber)) return false; // name-based answer: no numeric leak
    return numbersIn(hint.value).some(n => n === answerNumber);
  }

  const allHints = hintOrder(buildHints(subject, window, registry, { pool, scope }));
  const safeHints = allHints.filter(h => !hintRevealsAnswer(h, value));
  // Degrade safely: if every hint would reveal the answer, keep the round
  // usable and non-crashing instead of emitting zero clues.
  const baseLadder = safeHints.length ? safeHints : allHints;

  const own = clueFamily && clueFamily !== 'mixed'
    ? (familyClues(clueFamily, subject, window, registry, { pool, scope, rng }) ?? [])
    : [];
  const ownSafe = own.filter(h => !hintRevealsAnswer(h, value));
  const ownIds = new Set(ownSafe.map(h => h.id));
  const merged = dedupeById([...ownSafe, ...baseLadder]);

  const n = Math.max(1, stages);
  let clues = ownSafe.length >= 2 ? merged.slice(0, n) : mixedOrder(baseLadder, n);

  // The label is always honest: a family that could not put two of its own
  // clues on the ladder is a mixed round.
  if (clueFamily !== 'mixed' && clues.filter(h => ownIds.has(h.id)).length < 2) {
    clues = mixedOrder(baseLadder, n);
  }
  const effectiveFamily = clueFamily !== 'mixed'
    && clues.filter(h => ownIds.has(h.id)).length >= 2
    ? clueFamily
    : 'mixed';
  const usedMetrics = clues.map(c => c.metric).filter(Boolean);

  const teammateIds = [...new Set(clues.map(c => c.teammateId).filter(Boolean))];
  const isNumeric = recipe.template === 'stat_value';
  const distractors = isNumeric
    ? numericDistractors({ value, pool, subject, metric, window, rng, count: 3 }).map(String)
    : nameDistractors({ pool, subject, scope, rng, count: 3, excludeIds: teammateIds });

  const options = buildOptions({
    answer: spoken.answer,
    distractors,
    rng,
    unit: spoken.unit ?? null,
  });

  // One true line under the question, when the player has a trait worth
  // saying. A stat round already names its subject, so it gets no hook.
  const hook = recipe.template === 'identify'
    ? identityHook(subject, pool, { excludeMetrics: usedMetrics })
    : null;

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
    clueFamily: effectiveFamily,
    prompt: spoken.prompt,
    hook,
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
