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

function leagueIds(player) {
  return new Set((player.teams ?? []).map((team) => team.leagueId).filter(Boolean));
}

function careerSpan(player) {
  const seasons = (player.teams ?? []).flatMap((team) => team.seasons ?? []);
  if (!seasons.length) return null;
  return { start: Math.min(...seasons), end: Math.max(...seasons) };
}

function sharedLeagues(a, b) {
  const other = leagueIds(b);
  let shared = 0;
  for (const id of leagueIds(a)) if (other.has(id)) shared += 1;
  return shared;
}

function eraOverlap(a, b) {
  const one = careerSpan(a);
  const two = careerSpan(b);
  if (!one || !two) return 0;
  return Math.max(0, Math.min(one.end, two.end) - Math.max(one.start, two.start) + 1);
}

/**
 * How plausible a wrong answer is.
 *
 * A name from the same position, the same kind of role, the same leagues
 * and the same years looks like a real option. A name picked at random
 * looks like a lottery.
 */
const MIN_LOOKALIKE = 4;

function lookalikeScore(subject, candidate) {
  if (!subject) return 0;
  let score = 0;
  if (subject.position && subject.position === candidate.position) score += 4;
  if (subject.subPosition && subject.subPosition === candidate.subPosition) score += 3;
  score += Math.min(2, sharedLeagues(subject, candidate));
  const overlap = eraOverlap(subject, candidate);
  if (overlap >= 3) score += 2;
  else if (overlap >= 1) score += 1;
  if (subject.foot && candidate.foot
    && subject.foot.toLowerCase() === candidate.foot.toLowerCase()) score += 1;
  if ((subject.tournaments ?? []).some((id) => (candidate.tournaments ?? []).includes(id))) score += 1;
  return score;
}

export function nameDistractors({ pool, subject, scope, rng, count = 3 }) {
  const candidates = (pool ?? []).filter(p => !subject || p.id !== subject.id);
  if (!candidates.length) return [];

  const scored = candidates
    .map(p => ({ p, score: lookalikeScore(subject, p) }))
    .filter(x => x.score >= MIN_LOOKALIKE)
    .sort((a, b) => b.score - a.score);

  // Take a shortlist of the most plausible names, then shuffle it. The
  // right answer should look like its neighbours, not be surrounded by
  // the same three players every time.
  const shortlist = scored.slice(0, Math.max(count * 4, count)).map(x => x.p);
  const picked = shuffle(rng, shortlist).slice(0, count);

  if (picked.length < count) {
    const rest = shuffle(rng, candidates.filter(p => !picked.includes(p)));
    picked.push(...rest.slice(0, count - picked.length));
  }
  return picked;
}


/** "4 goals", "1 goal" - a bare number tells the player nothing. */
export function withUnit(value, unit) {
  if (!unit) return String(value);
  const n = Number(value);
  const u = (n === 1 && unit.endsWith('s')) ? unit.slice(0, -1) : unit;
  return `${value} ${u}`;
}

export function buildOptions({ answer, distractors, rng, unit = null }) {
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

  // Each option carries the raw value it stands for, so an answer is validated
  // against the value and not against its decorated label.
  const all = [
    { id: 'opt-0', label: withUnit(answer, unit), value: answer, correct: true },
    ...uniqueWrong.map((label, i) => ({
      id: `opt-${i + 1}`,
      label: unit ? withUnit(label, unit) : label,
      value: label,
      correct: false,
    })),
  ];
  return shuffle(rng, all).slice(0, OPTION_COUNT);
}
