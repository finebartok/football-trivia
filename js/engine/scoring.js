export const STAGE_MULTIPLIERS = Object.freeze({ 1: 5, 2: 3, 3: 2, 4: 1 });

export const ROUND_MS = 20000;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function scoreRound({ correct, stage, elapsedMs, roundMs = ROUND_MS }) {
  const multiplier = STAGE_MULTIPLIERS[stage] ?? 1;
  const span = Math.max(1, roundMs - 1500);
  const timeFactor = clamp(1.5 - (0.5 * (elapsedMs - 1500)) / span, 1, 1.5);
  const points = correct ? Math.round(1000 * multiplier * timeFactor) : 0;
  return { points, multiplier, timeFactor };
}

/**
 * What the reveal says the answer was worth. Solo passes the multiplier and
 * time factor it stored with the answer; a room passes the stage and the
 * response time and gets the same numbers recomputed.
 */
export function scoreBreakdown({ stage, elapsedMs = 0, multiplier, timeFactor }) {
  const scored = scoreRound({ correct: false, stage, elapsedMs });
  return {
    multiplier: multiplier ?? scored.multiplier,
    timeFactor: timeFactor ?? scored.timeFactor,
  };
}
