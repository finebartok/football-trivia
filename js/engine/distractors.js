import { shuffle } from './rng.js';

export function numericDistractors({ value, pool, subject, metric, rng, count = 3 }) {
  const values = new Set();
  for (const p of pool ?? []) {
    if (subject && p.id === subject.id) continue;
    let v;
    if (metric === 'international_caps') v = p.internationalCaps;
    else if (metric === 'tournament_goals') v = Object.values(p.windows ?? {}).reduce((s, w) => s + (w.goals ?? 0), 0);
    else if (metric === 'club_goals') v = Object.values(p.windows ?? {}).reduce((s, w) => s + (w.goals ?? 0), 0);
    else v = p.internationalCaps;
    if (v === undefined || v === null || v === 0) continue;
    if (v === value) continue;
    values.add(v);
    if (values.size >= count * 4) break;
  }
  const pool2 = shuffle(rng, [...values]).slice(0, count);
  while (pool2.length < count) {
    const bump = value + (pool2.length + 1) * 2;
    if (!pool2.includes(bump) && bump !== value) pool2.push(bump);
    else break;
  }
  return pool2;
}

export function nameDistractors({ pool, subject, scope, rng, count = 3 }) {
  const candidates = (pool ?? []).filter(p => !subject || p.id !== subject.id);
  return shuffle(rng, candidates).slice(0, count);
}

export function buildOptions({ answer, distractors, rng }) {
  const all = [
    { id: 'opt-0', label: String(answer), correct: true },
    ...(distractors ?? []).map((d, i) => ({
      id: `opt-${i + 1}`,
      label: typeof d === 'object' && d !== null ? d.name : String(d),
      correct: false,
    })),
  ];
  return shuffle(rng, all);
}
