import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeason, seasonLabel, overlapsSeason } from '../../lib/seasons.js';

test('parseSeason reads Transfermarkt two-digit seasons in the right century', () => {
  assert.equal(parseSeason('25/26'), 2025);
  assert.equal(parseSeason('99/00'), 1999);
  assert.equal(parseSeason('00/01'), 2000);
  assert.equal(parseSeason('12/13'), 2012);
  assert.equal(parseSeason('2014/15'), 2014);
  assert.equal(parseSeason('2020'), 2020);
  assert.equal(parseSeason('nonsense'), null);
  assert.equal(parseSeason(''), null);
});

test('seasonLabel renders a start year as a season', () => {
  assert.equal(seasonLabel(2014), '2014/15');
  assert.equal(seasonLabel(1999), '1999/00');
  assert.equal(seasonLabel(2000), '2000/01');
});

test('overlapsSeason is inclusive at both ends and unbounded with nulls', () => {
  assert.equal(overlapsSeason([2019], 2010, 2019), true);
  assert.equal(overlapsSeason([2019], 2010, 2018), false);
  assert.equal(overlapsSeason([2005], null, null), true);
  assert.equal(overlapsSeason([2005], 2010, null), false);
});
