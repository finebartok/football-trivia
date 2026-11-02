import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from '../../js/engine/fixture.js';
import { makeRng } from '../../js/engine/rng.js';
import {
  IQ_FORMATS,
  FORMAT_LABELS,
  buildClubRound,
  buildTeammateRound,
  buildComparisonRound,
  buildRangeRound,
} from '../../js/engine/formats.js';
import { answerRound } from '../../js/engine/index.js';
import { formatMetric } from '../../js/engine/stats.js';

const { players, registry } = loadFixture();

function build(builder, seed = 1) {
  return builder({
    pool: players,
    registry,
    window: null,
    scope: { clauses: [] },
    rng: makeRng(seed),
    difficulty: 'medium',
    stages: 4,
  });
}

function seasonStart(label) {
  return Number.parseInt(String(label).split('/')[0], 10);
}

function valuesOf(round, key) {
  return round.options.map((option) => option[key]);
}

const RANGE_CASES = {
  club_goals: {
    labels: ['0-9', '10-24', '25-49', '50+'],
    upper: [9, 24, 49, Infinity],
  },
  international_goals: {
    labels: ['0-9', '10-24', '25-49', '50+'],
    upper: [9, 24, 49, Infinity],
  },
  goals_after_age_30: {
    labels: ['0-9', '10-24', '25-49', '50+'],
    upper: [9, 24, 49, Infinity],
  },
  tournament_goals: {
    labels: ['0-9', '10-24', '25-49', '50+'],
    upper: [9, 24, 49, Infinity],
  },
  international_caps: {
    labels: ['0-24', '25-49', '50-99', '100+'],
    upper: [24, 49, 99, Infinity],
  },
  club_appearances: {
    labels: ['0-49', '50-149', '150-299', '300+'],
    upper: [49, 149, 299, Infinity],
  },
  highest_market_value_eur: {
    labels: ['<€10M', '€10-29M', '€30-59M', '€60M+'],
    upper: [9_999_999, 29_999_999, 59_999_999, Infinity],
  },
};

test('the four formats and their labels are exported', () => {
  assert.deepEqual([...IQ_FORMATS], ['club', 'teammate', 'comparison', 'range']);
  assert.deepEqual(FORMAT_LABELS, {
    club: 'Club in a season',
    teammate: 'Teammate',
    comparison: 'Most in the pool',
    range: 'Stat range',
  });
});

test('a club round asks about a season with exactly one club', () => {
  const round = build(buildClubRound);
  assert.ok(round, 'the fixture supplies a club round');
  assert.equal(round.template, 'club');
  assert.equal(round.family, 'club');
  assert.equal(round.clueFamily, null);

  const subject = players.find((p) => p.id === round.subjectId);
  assert.ok(subject, 'the subject is in the pool');
  const start = seasonStart(round.reveal.season);
  const entries = (subject.teams ?? []).filter((team) => (team.seasons ?? []).includes(start));
  assert.equal(entries.length, 1, 'the season has one club, so the answer is unambiguous');
  assert.equal(entries[0].clubName, round.answer);
  assert.equal(round.reveal.club, round.answer);
  assert.ok(valuesOf(round, 'value').includes(round.answer), 'the answer is an option');

  for (const clue of round.clues) {
    assert.ok(
      !clue.value.toLowerCase().includes(round.answer.toLowerCase()),
      `the clue "${clue.value}" names the answer club`,
    );
  }
});

test('a teammate round shares a club-season and never offers the subject', () => {
  const round = build(buildTeammateRound);
  assert.ok(round, 'the fixture supplies a teammate round');
  assert.equal(round.template, 'teammate');
  assert.notEqual(round.answerPlayerId, round.subjectId);

  const subject = players.find((p) => p.id === round.subjectId);
  const teammate = players.find((p) => p.id === round.answerPlayerId);
  assert.ok(subject && teammate);
  assert.equal(round.answer, teammate.name);

  const start = seasonStart(round.reveal.season);
  const shared = (subject.teams ?? []).some((team) => (teammate.teams ?? []).some(
    (other) => other.clubId === team.clubId
      && (team.seasons ?? []).includes(start)
      && (other.seasons ?? []).includes(start),
  ));
  assert.ok(shared, 'the teammate shares the club-season in the prompt');

  assert.ok(!valuesOf(round, 'value').includes(round.subjectName), 'the subject is not an option');
  assert.ok(valuesOf(round, 'value').includes(round.answer), 'the answer is an option');
  for (const clue of round.clues) {
    assert.ok(
      !clue.value.includes(round.subjectName),
      `the clue "${clue.value}" describes the subject, not the teammate`,
    );
  }
});

test('a comparison round has four distinct values and a unique maximum', () => {
  const round = build(buildComparisonRound);
  assert.ok(round, 'the fixture supplies a comparison round');
  assert.equal(round.template, 'comparison');

  const ranked = round.reveal.values;
  assert.equal(ranked.length, 4);
  const values = ranked.map((row) => row.value);
  assert.equal(new Set(values).size, 4, 'the four values are distinct');
  assert.deepEqual(values, [...values].sort((a, b) => b - a), 'the reveal is ranked');
  assert.equal(round.answer, ranked[0].player.name);
  assert.equal(round.answerPlayerId, ranked[0].player.id);
  assert.equal(round.reveal.metric, round.metric);

  const optionNames = valuesOf(round, 'value');
  assert.equal(new Set(optionNames).size, 4);
  assert.ok(optionNames.includes(round.answer));
  for (const row of ranked) assert.ok(optionNames.includes(row.player.name));

  const bounds = round.clues.filter((clue) => /^The (field|shortlist|leader)$/.test(clue.label));
  assert.ok(bounds.length >= 3, 'three bounds narrow the field');
  for (const bound of bounds) assert.match(bound.value, /more than/i);
});

test('a range round buckets the exact value and never prints it in a clue', () => {
  const round = build(buildRangeRound);
  assert.ok(round, 'the fixture supplies a range round');
  assert.equal(round.template, 'range');

  const metric = RANGE_CASES[round.metric];
  assert.ok(metric, `${round.metric} has fixed buckets`);
  const index = metric.upper.findIndex((upper) => round.reveal.value <= upper);
  assert.ok(index >= 0);
  assert.equal(round.answer, metric.labels[index]);
  assert.equal(round.reveal.range, round.answer);
  assert.equal(round.reveal.valueText, formatMetric(round.metric, round.reveal.value, null));

  const optionLabels = valuesOf(round, 'label');
  assert.equal(optionLabels.length, 4);
  assert.equal(new Set(valuesOf(round, 'value')).size, 4);
  assert.ok(valuesOf(round, 'value').includes(round.answer));
  const exact = String(round.reveal.value);
  for (const clue of round.clues) {
    assert.ok(!clue.value.includes(exact), `the clue "${clue.value}" states the exact value`);
  }
});

test('every Football IQ format scores through the same stage ladder', () => {
  const rounds = [
    build(buildClubRound),
    build(buildTeammateRound),
    build(buildComparisonRound),
    build(buildRangeRound),
  ];
  for (const round of rounds) {
    const right = answerRound(round, { answer: round.answer, stage: 1, elapsedMs: 1500 });
    assert.equal(right.correct, true, `${round.template} accepts its answer`);
    assert.equal(right.multiplier, 5);
    assert.equal(right.points, 7500);

    const wrong = answerRound(round, { answer: 'Definitely Not The Answer', stage: 3, elapsedMs: 4000 });
    assert.equal(wrong.correct, false);
    assert.equal(wrong.points, 0);
  }
});

test('club, teammate, and comparison match names without case or accents', () => {
  for (const [builder, seed] of [[buildClubRound, 1], [buildTeammateRound, 1], [buildComparisonRound, 1]]) {
    let round = null;
    for (let s = seed; s < seed + 20 && !round; s += 1) round = build(builder, s);
    assert.ok(round);
    const loose = round.answer.toUpperCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    assert.equal(answerRound(round, { answer: loose, stage: 1, elapsedMs: 1000 }).correct, true);
  }
});

test('range answers are exact labels, not names', () => {
  const round = build(buildRangeRound);
  assert.equal(answerRound(round, { answer: round.answer, stage: 1, elapsedMs: 1000 }).correct, true);
  assert.equal(answerRound(round, { answer: `${round.answer} goals`, stage: 1, elapsedMs: 1000 }).correct, false);
});
