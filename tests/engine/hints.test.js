import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHints, hintOrder, identityHook } from '../../js/engine/hints.js';
import { careerClubs } from '../../js/engine/career.js';
import { loadFixture } from '../../js/engine/fixture.js';

function messiAndPool() {
  const { players, registry } = loadFixture();
  const messi = players.find((p) => p.name === 'Lionel Messi');
  return { messi, players, registry, window: registry.windows['wc-2022'] };
}

test('hints are built for a real player, in story order', () => {
  const { messi, players, registry, window } = messiAndPool();
  const hints = buildHints(messi, window, registry, { pool: players });

  assert.ok(hints.length >= 4, 'a player must yield at least four hints');
  assert.deepEqual(hints.map((h) => h.role), ['stage', 'trail', 'record', 'profile', 'home']);
  for (const h of hints) {
    assert.ok(h.label, 'a hint needs a label');
    assert.ok(h.value && h.value !== 'null' && h.value !== 'undefined', 'a hint value must never be null-ish');
    assert.ok(h.iconKey, 'a hint needs an iconKey');
  }
});

test('the stage names the vibe’s own number and its window', () => {
  const { messi, players, registry, window } = messiAndPool();
  const stage = buildHints(messi, window, registry, { pool: players })
    .find((h) => h.role === 'stage');
  assert.equal(stage.label, 'The stage');
  assert.equal(stage.value, '7 goals at the 2022 World Cup.');
  assert.equal(stage.metric, 'tournament_goals');
});

test('the trail is the same chronological path the reveal shows', () => {
  const { players, registry } = loadFixture();
  const salah = players.find((p) => p.name === 'Mohamed Salah');
  const trail = buildHints(salah, null, registry, { pool: players })
    .find((h) => h.role === 'trail');
  assert.equal(trail.label, 'The trail');
  assert.equal(trail.value, careerClubs(salah).join(' → '));
});

test('a pool-aware record only says what the pool proves', () => {
  const { messi, players, registry, window } = messiAndPool();
  const record = buildHints(messi, window, registry, { pool: players })
    .find((h) => h.role === 'record');
  assert.equal(record.label, 'The record');
  assert.equal(record.metric, 'international_goals');
  assert.equal(record.value, '125 international goals — only 1 player here has more.');

  // A smaller pool can make the same player the leader.
  const other = players.find((p) => p.name === 'Sergio Busquets');
  const small = buildHints(messi, window, registry, { pool: [messi, other] })
    .find((h) => h.role === 'record');
  assert.equal(small.value, '125 international goals — the most in this quiz.');
});

test('the hook is true, rare, and never repeats a clue’s metric', () => {
  const subject = {
    id: 1, name: 'Synthetic', internationalCaps: 120, internationalGoals: 40,
    stats: { goals_after_age_30: 10, club_goals: 100 },
    windows: { 'wc-2022': { goals: 3 } },
    teams: [{ leagueId: 'A' }, { leagueId: 'B' }],
  };
  const other = {
    id: 2, name: 'Other', internationalCaps: 2, internationalGoals: 0,
    stats: {}, windows: {}, teams: [{ leagueId: 'C' }],
  };

  assert.equal(identityHook(subject, [subject, other]),
    'A centurion with a World Cup goal.');
  assert.equal(identityHook(subject, [subject, other], { excludeMetrics: ['international_caps'] }),
    'A World Cup scorer.');
  assert.equal(identityHook(other, [subject, other]), null,
    'a player with no rare trait gets no hook');
});

test('no hint ever renders a missing value as zero', () => {
  const { players, registry } = loadFixture();
  const withNulls = players.find((p) => p.internationalCaps === 0 || p.internationalCaps == null);
  const hints = buildHints(withNulls, null, registry, { pool: players });
  assert.ok(!hints.some((h) => /^0 /.test(h.value)), 'a missing stat must not render as "0 ..."');
});

test('the home hint fires from citizenship (real player contract)', () => {
  const { messi, players, registry, window } = messiAndPool();
  assert.equal(messi.nationality, undefined, 'fixture player uses citizenship, not nationality');
  const home = buildHints(messi, window, registry, { pool: players })
    .find((h) => h.role === 'home');
  assert.ok(home, 'the home hint must fire from citizenship');
  assert.equal(home.value, 'From Argentina.');
});

test('the home hint does not fire when neither nationality nor citizenship', () => {
  const hints = buildHints({ name: 'Unknown' }, null, {});
  assert.ok(!hints.some((h) => h.role === 'home'), 'no home hint without a nationality');
});

test('a limit keeps the story order and drops the surface facts first', () => {
  const { messi, players, registry, window } = messiAndPool();
  const hints = buildHints(messi, window, registry, { limit: 3, pool: players });
  assert.deepEqual(hints.map((h) => h.role), ['stage', 'trail', 'record']);
  assert.ok(!hints.some((h) => h.surface), 'surface facts are the first to go');
});

test('hintOrder puts the same roles in the same order', () => {
  const hints = [
    { role: 'home' }, { role: 'record' }, { role: 'stage' },
    { role: 'profile' }, { role: 'trail' },
  ];
  assert.deepEqual(hintOrder(hints).map((h) => h.role),
    ['stage', 'trail', 'record', 'profile', 'home']);
});
