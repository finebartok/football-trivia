import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, recipesFor } from '../../js/engine/recipes.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('every recipe has an id, a template and a speak function', () => {
  for (const r of RECIPES) {
    assert.ok(r.id, 'recipe needs an id');
    assert.ok(r.template, 'recipe needs a template');
    assert.equal(typeof r.speak, 'function', `${r.id} needs a speak function`);
    assert.ok(Array.isArray(r.windowKinds) && r.windowKinds.length, `${r.id} needs window kinds`);
  }
});

test('a stat recipe speaks a sentence with the subject named', () => {
  const { players } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const r = RECIPES.find(x => x.id === 'caps_total');
  const out = r.speak({ subject: messi, window: null, value: 204, pool: players, registry: { windows: {} } });
  assert.match(out.prompt, /Lionel Messi/);
  assert.match(out.prompt, /caps/i);
  assert.equal(out.answer, 204);
});

test('recipesFor returns only recipes available for the pool', () => {
  const { players, registry } = loadFixture();
  const recipes = recipesFor({
    template: 'stat_value',
    window: registry.windows['wc-2022'],
    pool: players,
    phases: ['v1.1'],
  });
  assert.ok(recipes.length >= 1);
  assert.ok(recipes.every(r => r.template === 'stat_value'));
});
