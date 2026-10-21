import { shuffle } from './rng.js';

// A distractor is only useful if it is the same KIND of number as the truth.
// Reading the truth per-window (e.g. 61 goals in 2014-15) while the distractors
// summed every window in a player's career (300+) would be meaningless.
export function metricValueFor(p, metric, window) {
  switch (metric) {
    case 'international_caps': return p.internationalCaps;
    case 'international_goals': return p.internationalGoals;
    case 'highest_market_value_eur': return p.highestMarketValueEur;
    case 'scarcity_peers': return p.stats?.scarcity_peers;
    case 'tournament_goals':
    case 'club_goals': {
      const wid = window?.id;
      if (!wid) return undefined;
      return p.windows?.[wid]?.goals;
    }
    default: return undefined;
  }
}

export const OPTION_COUNT = 4;

export function numericDistractors({ value, pool, subject, metric, window, rng, count = 3 }) {
  const values = new Set();
  for (const p of pool ?? []) {
    if (subject && p.id === subject.id) continue;
    const v = metricValueFor(p, metric, window);
    if (v === undefined || v === null || v === 0) continue;
    if (v === value) continue;
    values.add(v);
    if (values.size >= count * 4) break;
  }
  const picked = shuffle(rng, [...values]).slice(0, count);
  let bump = 1;
  while (picked.length < count) {
    const candidate = value + bump * 2;
    if (candidate !== value && !picked.includes(candidate)) picked.push(candidate);
    bump++;
    if (bump > 100) break;
  }
  return picked;
}

export function nameDistractors({ pool, subject, scope, rng, count = 3 }) {
  const candidates = (pool ?? []).filter(p => !subject || p.id !== subject.id);
  return shuffle(rng, candidates).slice(0, count);
}

export function buildOptions({ answer, distractors, rng }) {
  const wrong = (distractors ?? [])
    .map(d => (typeof d === 'object' && d !== null ? d.name : String(d)))
    .filter(label => label !== String(answer));
  const uniqueWrong = [...new Set(wrong)].slice(0, OPTION_COUNT - 1);

  // A round always has four options. If the pool could not supply enough
  // distinct wrong answers, pad with clearly-wrong derived values rather
  // than showing the player a three-option round.
  let bump = 1;
  while (uniqueWrong.length < OPTION_COUNT - 1) {
    const candidate = `${String(answer)} (${bump})`;
    if (!uniqueWrong.includes(candidate)) uniqueWrong.push(candidate);
    bump++;
    if (bump > 50) break;
  }

  const all = [
    { id: 'opt-0', label: String(answer), correct: true },
    ...uniqueWrong.map((label, i) => ({ id: `opt-${i + 1}`, label, correct: false })),
  ];
  return shuffle(rng, all).slice(0, OPTION_COUNT);
}
