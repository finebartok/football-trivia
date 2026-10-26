import { planQuiz } from './planner.js';
import { scoreRound } from './scoring.js';
import { normaliseName } from '../../lib/names.js';

export { planQuiz } from './planner.js';
export { scopePool, playerInScope, statMatches } from './scope.js';
export { resolveWindow, windowLabel } from './window.js';
export { METRICS, formatMetric, metricsFor } from './stats.js';
export { buildHints, hintOrder, identityHook } from './hints.js';
export { careerClubs, careerTeams } from './career.js';
export { RECIPES, recipesFor } from './recipes.js';
export { composeRound, candidateSubjects } from './questions.js';
export { numericDistractors, nameDistractors, buildOptions } from './distractors.js';
export { scoreRound, STAGE_MULTIPLIERS } from './scoring.js';
export { makeRng } from './rng.js';

export function generateQuiz({ scope, pool, registry, seed = 1, rounds = 10, difficulty = 'medium' }) {
  return planQuiz({ scope, pool, registry, seed, rounds, difficulty });
}

export function answerRound(round, { answer, stage, elapsedMs }) {
  let correct = false;
  if (round.template === 'stat_value') {
    // Decision: numeric equality for stat_value rounds.
    // An option's label carries its unit ("4 goals"); its value carries the
    // number. Validate against the value, never the decorated label.
    correct = String(answer).trim() === String(round.answer).trim();
  } else {
    // Decision: identify rounds use normalised name matching.
    const given = normaliseName(answer ?? '');
    const truth = normaliseName(round.answer ?? '');
    correct = given === truth;
  }
  const scored = scoreRound({ correct, stage, elapsedMs });
  return { correct, ...scored };
}
