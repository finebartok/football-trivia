import { scopePool } from './scope.js';
import { resolveWindow } from './window.js';
import { candidateSubjects, composeRound } from './questions.js';
import { recipesFor } from './recipes.js';
import { makeRng, shuffle } from './rng.js';
export const MIN_POOL = 20;

const DIFFICULTY_DEPTH = { easy: 1, medium: 2, hard: 3 };

export function planQuiz({ scope, pool, registry, seed = 1, rounds = 10, difficulty = 'medium', phases = [], statRounds = 0 }) {
  const rng = makeRng(seed);
  const players = scopePool(scope, pool);

  if (players.length < MIN_POOL) {
    throw new Error(`scope resolves to ${players.length} players, below the floor of ${MIN_POOL}`);
  }

  const window = resolveWindow(scope, registry);
  const recipes = recipesFor({ template: null, window, pool: players, phases });
  if (recipes.length === 0) {
    throw new Error('no question recipe is available for this scope');
  }

  // The stat rounds are placed before anything is composed, so the mix is
  // a property of the plan and not of what happened to be available late.
  const statCount = Math.max(0, Math.min(rounds, Math.trunc(Number(statRounds) || 0)));
  const statSlots = statCount === 0
    ? new Set()
    : new Set(shuffle(rng, Array.from({ length: rounds }, (_, i) => i)).slice(0, statCount));

  const usedSubjects = new Set();
  const plan = [];

  for (let i = 0; i < rounds; i++) {
    const depth = DIFFICULTY_DEPTH[difficulty] ?? 2;
    const wanted = statSlots.has(i) ? 'stat_value' : 'identify';
    const preferred = recipes.filter((r) => r.template === wanted);
    const groups = wanted === 'stat_value'
      ? [preferred, recipes.filter((r) => r.template !== 'stat_value')]
      : [preferred];

    let candidates = [];
    for (const group of groups) {
      candidates = [];
      for (const recipe of group) {
        // No metric repeats consecutively - but only when there is another
        // recipe in this group to pick instead. A group with one recipe
        // must still fill the slot.
        if (group.length > 1 && plan.length && plan[plan.length - 1].metric === recipe.metric) continue;
        const cands = candidateSubjects({ scope, pool: players, registry, window, metric: recipe.metric });
        for (const c of cands) {
          // No subject repeats.
          if (usedSubjects.has(c.subject.id)) continue;
          // candidateSubjects already filters out subjects the metric has no
          // value for, so composeRound cannot throw on this pair.
          candidates.push({ ...c, recipe });
        }
      }
      if (candidates.length > 0) break;
    }

    if (candidates.length === 0) break;

    const chosen = candidates[Math.floor(rng() * candidates.length)];

    // The difficulty curve: early rounds reveal fewer stages, later rounds
    // dig deeper. Depth never decreases, so reveal depth never goes backwards.
    const stages = depth >= 3 ? 4 : depth >= 2 ? (i < rounds / 2 ? 3 : 4) : 3;

    const round = composeRound({
      subject: chosen.subject,
      metric: chosen.recipe.metric,
      window,
      scope,
      registry,
      pool: players,
      rng,
      difficulty,
      stages,
    });
    round.stage = i + 1;

    plan.push(round);
    usedSubjects.add(chosen.subject.id);
  }

  const families = new Set(plan.map(r => r.family));
  let hardest = { index: 1, depth: 0 };
  for (const [i, r] of plan.entries()) {
    if (r.clues.length > hardest.depth) hardest = { index: i + 1, depth: r.clues.length };
  }
  return {
    scope,
    seed,
    rounds: plan,
    summary: {
      rounds: plan.length,
      metricFamilies: families.size,
      subjects: new Set(plan.map(r => r.subjectId)).size,
      hardestRound: hardest.index,
    },
  };
}
