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

test('nationality hint fires from citizenship (real player contract)', () => {
  const { players, registry } = loadFixture();
  const messi = players.find(p => p.name === 'Lionel Messi');
  assert.equal(messi.nationality, undefined, 'fixture player uses citizenship, not nationality');
  const hints = buildHints(messi, registry.windows['wc-2022'], registry);
  const nat = hints.find(h => h.id === 'nationality');
  assert.ok(nat, 'nationality hint must fire from citizenship');
  assert.equal(nat.value, 'Argentina', 'nationality value is the first citizenship');
});

test('nationality hint does not fire when neither nationality nor citizenship', () => {
  const hints = buildHints({ name: 'Unknown' }, null, {});
  assert.ok(!hints.some(h => h.id === 'nationality'), 'no nationality hint without nationality or citizenship');
});

test('a small limit keeps window/roster facts and drops surface facts', () => {
  const subject = {
    citizenship: ['Argentina'],
    position: 'Attack',
    foot: 'left',
    dateOfBirth: '1987-06-24',
    teams: [{ clubName: 'FC Barcelona', leagueName: 'La Liga' }],
    internationalCaps: 204,
    internationalGoals: 125,
    highestMarketValueEur: 180000000,
    windows: { 'wc-2022': { goals: 7 } },
    stats: { goals_after_age_30: 285 },
  };
  const window = { id: 'wc-2022', kind: 'tournament', label: '2022 World Cup' };
  const hints = buildHints(subject, window, {}, { limit: 4 });
  assert.ok(hints.length > 0, 'limit still yields hints');
  assert.ok(!hints.some(h => h.id === 'nationality' || h.id === 'position' || h.id === 'age'),
    'surface facts are dropped before window/roster facts');
  assert.ok(hints.some(h => h.family === 'window' || h.family === 'roster'),
    'window and roster facts survive a small limit');
  // ranking holds within the trimmed list: no window/roster hint after a path/surface one
  let sawPathOrSurface = false;
  for (const h of hints) {
    const isHard = h.family === 'window' || h.family === 'roster';
    if (!isHard) sawPathOrSurface = true;
    if (sawPathOrSurface && isHard) assert.fail('easier fact precedes a harder one after limit');
  }
});
