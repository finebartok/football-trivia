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
  assert.equal(s, '204 caps');
});

test('metric families are assigned for the planner', () => {
  assert.equal(metricDescriptor('international_caps').family, 'career');
  assert.equal(metricDescriptor('club_goals').family, 'window');
  assert.equal(metricDescriptor('goals_after_age_30').family, 'window');
  assert.equal(metricDescriptor('scarcity_peers').family, 'scarcity');
});

test('metricsFor only returns metrics the player has a value for', () => {
  const player = { windows: { 'wc-2022': { goals: 7 } }, stats: { international_caps: 204 } };
  const m = metricsFor(player, { id: 'wc-2022' });
  const ids = m.map(x => x.id);
  assert.ok(ids.includes('tournament_goals'));
  assert.ok(!ids.includes('club_appearances'));
  assert.equal(metricDescriptor('nope'), null);
});

test('every metric declares a family and an exactness', () => {
  for (const [id, m] of Object.entries(METRICS)) {
    assert.ok(m.label, `${id} needs a label`);
    assert.ok(['career', 'window', 'scarcity', 'roster', 'identity'].includes(m.family), `${id} needs a family`);
    assert.equal(typeof m.exact, 'boolean', `${id} needs an exact flag`);
  }
});
