import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHints, hintOrder } from '../../js/engine/hints.js';
import { loadFixture } from '../../js/engine/fixture.js';

test('hints are built for a real player', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const hints = buildHints(messi, registry.windows['wc-2022'], registry);
  assert.ok(hints.length >= 4, 'a player must yield at least four hints');
  for (const h of hints) {
    assert.ok(h.label, 'a hint needs a label');
    assert.ok(h.value && h.value !== 'null' && h.value !== 'undefined', 'a hint value must never be null-ish');
    assert.ok(h.iconKey, 'a hint needs an iconKey');
  }
});

test('window facts are ordered before career surface facts', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  const hints = hintOrder(buildHints(messi, registry.windows['wc-2022'], registry));
  const surfaceIdx = hints.findIndex(h => h.id === 'nationality' || h.id === 'position');
  const windowIdx = hints.findIndex(h => h.family === 'window' || h.family === 'roster');
  assert.ok(windowIdx >= 0 && surfaceIdx >= 0);
  assert.ok(windowIdx < surfaceIdx, 'a window fact must come before a surface fact');
});

test('no hint ever renders a missing value as zero', () => {
  const { players, registry } = loadFixture();
  const withNulls = players.find(p => p.internationalCaps === 0 || p.internationalCaps == null);
  const hints = buildHints(withNulls, null, registry);
  assert.ok(!hints.some(h => /^0 /.test(h.value)), 'a missing stat must not render as "0 ..."');
});
