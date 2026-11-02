import { planQuiz } from './planner.js';
import { scoreRound } from './scoring.js';
import { normaliseName } from '../../lib/names.js';

export { planQuiz, planIqQuiz, iqFormatSchedule } from './planner.js';
export { IQ_FORMATS, FORMAT_LABELS, composeFormatRound, buildClubRound, buildTeammateRound, buildComparisonRound, buildRangeRound } from './formats.js';
export { scopePool, playerInScope, statMatches } from './scope.js';
export { resolveWindow, windowLabel } from './window.js';
export { METRICS, formatMetric, metricsFor } from './stats.js';
export { buildHints, hintOrder, identityHook, recordHints, profileHints, teammateHints, familyClues, CLUE_FAMILIES, CLUE_FAMILY_LABELS } from './hints.js';
export { careerClubs, careerTeams } from './career.js';
export { RECIPES, recipesFor } from './recipes.js';
export { composeRound, candidateSubjects } from './questions.js';
export { numericDistractors, nameDistractors, buildOptions } from './distractors.js';
export { scoreRound, scoreBreakdown, STAGE_MULTIPLIERS } from './scoring.js';
export { makeRng } from './rng.js';

export function generateQuiz({ scope, pool, registry, seed = 1, rounds = 10, difficulty = 'medium', phases = [], statRounds = 0, mode = 'guess_player' }) {
  return planQuiz({ scope, pool, registry, seed, rounds, difficulty, phases, statRounds, mode });
}

export function answerRound(round, { answer, stage, elapsedMs }) {
  let correct = false;
  if (round.template === 'stat_value' || round.template === 'range') {
    // Exact templates answer with the raw value, never the decorated label:
    // an option reads "10-24 goals" and stores "10-24".
    correct = String(answer).trim() === String(round.answer).trim();
  } else {
    // Identify and every Football IQ format that answers with a name use
    // normalised name matching.
    const given = normaliseName(answer ?? '');
    const truth = normaliseName(round.answer ?? '');
    correct = given === truth;
  }
  const scored = scoreRound({ correct, stage, elapsedMs });
  return { correct, ...scored };
}
