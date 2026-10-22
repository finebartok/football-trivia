import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, formatMetric, metricsFor, metricDescriptor } from '../../js/engine/stats.js';

test('a windowed metric always states its window', () => {
  const s = formatMetric('club_goals', 61, { kind: 'season', seasonStart: 2014, seasonEnd: 2014, label: 'Real Madrid 2014/15' });
  assert.match(s, /61/);
  assert.match(s, /2014|since/i, 'a windowed value must name its window');
});

test('an exact metric never gets a window qualifier', () => {
  const s = formatMetric('international_caps', 204, { kind: 'season', seasonStart: 2014, label: 'x' });
  assert.equal(s, '204');
});

test('a metric value does not repeat the unit its label already carries', () => {
  // "International caps / 204" - not "International caps / 204 caps".
  assert.equal(metricDescriptor('international_caps').label, 'International caps');
  assert.equal(metricDescriptor('international_caps').format(204), '204');
  assert.equal(metricDescriptor('international_goals').format(52), '52');
  assert.equal(metricDescriptor('goals_after_age_30').format(50), '50+');
  assert.equal(metricDescriptor('club_goals').format(60), '60');
});

test('metric families are assigned for the planner', () => {
  assert.equal(metricDescriptor('international_caps').family, 'career');
  assert.equal(metricDescriptor('club_goals').family, 'window');
  assert.equal(metricDescriptor('goals_after_age_30').family, 'window');
  assert.equal(metricDescriptor('scarcity_peers').family, 'scarcity');
});

test('metricsFor only returns metrics the player has a value for', () => {
  const player = { windows: { 'wc-2022': { goals: 7 } }, stats: { international_caps: 204 } };
  const m = metricsFor(player, { id: 'wc-2022', kind: 'tournament' });
  const ids = m.map(x => x.id);
  assert.ok(ids.includes('tournament_goals'));
  assert.ok(!ids.includes('club_appearances'));
  assert.equal(metricDescriptor('nope'), null);
});

test('a tournament metric does not answer for a club window', () => {
  const player = { windows: { 'rm-2014': { goals: 61 } }, stats: {} };
  const ids = metricsFor(player, { id: 'rm-2014', kind: 'season' }).map((m) => m.id);
  assert.ok(!ids.includes('tournament_goals'), 'a club season is not a tournament');
});

test('the stat a scope is about is a clue, with its own window', () => {
  // "50+ goals aged 30+" is the same fact whatever era the scope is
  // about, so it resolves without a window - and it says where the data
  // starts.
  const player = { stats: { goals_after_age_30: 50, international_caps: 12 } };
  const ids = metricsFor(player, null).map((m) => m.id);
  assert.ok(ids.includes('goals_after_age_30'), 'the stat is a clue');
  assert.equal(formatMetric('goals_after_age_30', 50, null), '50+ (since 2012)');
});

test('every metric declares a family and an exactness', () => {
  for (const [id, m] of Object.entries(METRICS)) {
    assert.ok(m.label, `${id} needs a label`);
    assert.ok(['career', 'window', 'scarcity', 'roster', 'identity'].includes(m.family), `${id} needs a family`);
    assert.equal(typeof m.exact, 'boolean', `${id} needs an exact flag`);
  }
});
