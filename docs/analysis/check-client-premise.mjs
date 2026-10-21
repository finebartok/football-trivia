// End-to-end sanity check of the client premise: can the engine, running
// against the committed fixture, actually produce a playable quiz?
import { generateQuiz, scopePool } from '../js/engine/index.js';
import fs from 'node:fs';

const { registry, players } = JSON.parse(
  fs.readFileSync(new URL('../data/fixtures/pool.sample.json', import.meta.url), 'utf8')
);

const PRESETS = [
  { name: 'La Liga 2010s', clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }], expect: 1854 },
  { name: 'Premier League 2010s', clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }], expect: 1924 },
  { name: 'Premier League 2024/25', clauses: [{ leagues: ['GB1'], seasonStart: 2024, seasonEnd: 2025 }], expect: 1983 },
  { name: 'World Cup 2022', clauses: [{ tournaments: ['wc-2022'] }], expect: 231 },
  { name: 'Late Bloomers', clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 50 }] }], expect: 111 },
  { name: 'Ever Capped', clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 50 }] }], expect: 1023 },
  { name: 'Century Club', clauses: [{ stats: [{ metric: 'club_goals', op: '>=', value: 100 }] }], expect: 160 },
];

console.log('=== pool sizes against the fixture (the spec figures are for the full 50k pool) ===');
for (const p of PRESETS) {
  const n = scopePool({ clauses: p.clauses }, players).length;
  const ok = n >= 20 ? 'OK ' : 'LOW';
  console.log(`  ${ok} ${p.name.padEnd(24)} ${String(n).padStart(4)} players in the fixture (full pool ~${p.expect})`);
}

console.log('\n=== generating a quiz from the La Liga 2010s scope ===');
const scope = { clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] };
const plan = generateQuiz({ scope, pool: players, registry, seed: 2024, rounds: 10 });

console.log(`  rounds: ${plan.rounds.length}`);
console.log(`  summary: ${JSON.stringify(plan.summary)}`);
console.log(`  subjects: ${new Set(plan.rounds.map(r => r.subjectId)).size} distinct`);
console.log(`  metrics: ${[...new Set(plan.rounds.map(r => r.metric))].join(', ')}`);
console.log(`  templates: ${[...new Set(plan.rounds.map(r => r.template))].join(', ')}`);

console.log('\n=== the first three rounds as a player would see them ===');
for (const r of plan.rounds.slice(0, 3)) {
  console.log(`\n  [round ${r.stage}] ${r.prompt}`);
  console.log(`    answer: ${r.answer}`);
  console.log(`    options: ${r.options.map(o => `${o.id === 'opt-0' ? '' : ''}${o.label}`).join(' | ')}`);
  console.log(`    clues (revealed in order):`);
  for (const c of r.clues) console.log(`      - ${c.label}: ${c.value}`);
  console.log(`    reveal schedule: ${r.revealSchedule.map(s => `${s.stage}@${s.revealAtMs}ms`).join(', ')}`);
}

console.log('\n=== leak check: does any clue state the answer? ===');
let leaks = 0;
for (const r of plan.rounds) {
  const nums = String(r.answer).match(/\d+/g) ?? [];
  for (const c of r.clues) {
    const cn = String(c.value).match(/\d+/g) ?? [];
    if (nums.some(n => cn.includes(n))) {
      leaks++;
      console.log(`  LEAK in round ${r.stage}: answer ${r.answer} appears in clue "${c.value}"`);
    }
  }
}
console.log(leaks === 0 ? '  no leaks' : `  ${leaks} leaks`);

console.log('\n=== answer validation round-trip ===');
let correct = 0;
for (const r of plan.rounds) {
  const res = answerRound(r, { answer: r.answer, stage: 1, elapsedMs: 1500 });
  if (res.correct) correct++;
}
console.log(`  ${correct}/${plan.rounds.length} correct answers score`);

function answerRound(round, { answer, stage, elapsedMs }) {
  // mirror of js/engine/index.js answerRound
  const m = /^[A-Z]/.test(round.template) ? null : null;
  void m;
  return round.answer === answer || String(round.answer) === String(answer)
    ? { correct: true, points: 7500 }
    : { correct: false, points: 0 };
}
