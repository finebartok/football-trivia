import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planQuiz } from '../../js/engine/index.js';
import { PRESETS } from '../../js/presets.js';
import {
  buildPresetSlices, buildLeanPool, buildMeta, trimRegistry,
} from '../../scripts/pool-artifacts.mjs';

const pool = JSON.parse(await readFile(
  new URL('../../data/fixtures/pool.sample.json', import.meta.url),
  'utf8',
));
const slices = buildPresetSlices(pool, PRESETS);
const byId = new Map(slices.map((slice) => [slice.id, slice]));

const CUSTOM_SCOPES = [
  { clauses: [{ leagues: ['GB1'], seasonStart: 2024, seasonEnd: 2025 }] },
  { clauses: [{ tournaments: ['wc-2022'] }] },
  { clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 50 }] }] },
  { clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 50 }] }] },
  { clauses: [{ nationalities: ['Argentina'] }] },
];

function plan(scope, data, seed) {
  return planQuiz({
    scope,
    pool: data.players,
    registry: data.registry,
    seed,
    rounds: 10,
  });
}

test('every preset gets a slice with its true count', () => {
  for (const preset of PRESETS) {
    const slice = byId.get(preset.id);
    assert.ok(slice, `${preset.id} has a slice`);
    assert.equal(slice.count, slice.data.players.length);
    assert.ok(slice.count >= 20, `${preset.id} has enough players to plan a quiz`);
  }
});

test('the counts the home screen shows come from the same pool', () => {
  const meta = buildMeta(slices);
  assert.deepEqual(Object.keys(meta.counts), PRESETS.map((p) => p.id));
  for (const preset of PRESETS) {
    assert.equal(meta.counts[preset.id], byId.get(preset.id).count);
  }
});

test('a preset slice plans the same quiz as the full pool', () => {
  for (const preset of PRESETS) {
    const scope = { clauses: preset.clauses };
    const slice = byId.get(preset.id);
    for (const seed of [1, 12345]) {
      assert.deepEqual(
        plan(scope, slice.data, seed),
        plan(scope, pool, seed),
        `${preset.id} seed ${seed} plans differently from the full pool`,
      );
    }
  }
});

test('the lean full pool plans the same quiz as the fixture', () => {
  const lean = buildLeanPool(pool);
  assert.equal(lean.players.length, pool.players.length);
  assert.equal(lean.registry.clubs.length, 0);
  for (const window of Object.values(lean.registry.windows)) {
    assert.equal(window.kind, 'tournament');
  }
  for (const scope of CUSTOM_SCOPES) {
    for (const seed of [7, 999]) {
      assert.deepEqual(
        plan(scope, lean, seed),
        plan(scope, pool, seed),
        `${JSON.stringify(scope.clauses)} seed ${seed} plans differently`,
      );
    }
  }
});

test('a slice keeps only the tournament windows it can resolve', () => {
  const wc = byId.get('wc-2022');
  assert.ok(wc.data.registry.windows['wc-2022']);
  const league = byId.get('premier-2425');
  assert.deepEqual(league.data.registry.windows, {});
  const trimmed = trimRegistry(pool.registry);
  assert.ok(Object.keys(trimmed.windows).length > 0);
  assert.ok(Object.keys(trimmed.windows).length < Object.keys(pool.registry.windows).length);
});
