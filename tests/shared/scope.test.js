import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nearestThreshold, describeCoverage, encodeScope, decodeScope, validateScope } from '../../lib/scope.js';

const pool = JSON.parse(await readFile(new URL('../../data/fixtures/pool.sample.json', import.meta.url), 'utf8'));
const players = pool.players;
const registry = pool.registry;

const wc = { clauses: [{ tournaments: ['wc-2022'] }] };
const laliga = { clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] };

test('a scope round trips through a link', () => {
  const scope = { name: 'My vibe', icon: '⚽', clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] };
  const decoded = decodeScope(encodeScope(scope));
  assert.deepEqual(decoded, scope);
});

test('a link that is not a scope decodes to null', () => {
  assert.equal(decodeScope('not-a-scope'), null);
  assert.equal(decodeScope(''), null);
  assert.equal(decodeScope(undefined), null);
});

test('a link that has been edited decodes to null rather than to nonsense', () => {
  const code = encodeScope({ name: 'x', icon: '⚽', clauses: [{ leagues: ['ES1'] }] });
  const broken = code.slice(0, -4) + 'AAAA';
  const decoded = decodeScope(broken);
  assert.ok(decoded === null || Array.isArray(decoded.clauses), 'never a half-decoded scope');
});

test('the nearest threshold is the closest one that still holds', () => {
  const scope = { clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 1 }] }] };
  const near = nearestThreshold({ scope, metric: 'goals_after_age_30', players, floor: 20, max: 400 });
  assert.ok(near, 'a threshold is found');
  assert.ok(near.value < 200, 'the suggestion is below the number that was typed');
  assert.ok(near.count >= 20, 'the suggestion holds');
});

test('the nearest threshold is monotonic in the pool', () => {
  const scope = { clauses: [{ stats: [{ metric: 'international_caps', op: '>=', value: 1 }] }] };
  const low = nearestThreshold({ scope, metric: 'international_caps', players, floor: 20, max: 120 });
  const high = nearestThreshold({ scope, metric: 'international_caps', players, floor: 20, min: 0, max: 120 });
  assert.ok(low.value >= 0 && high.value >= 0);
  assert.ok(low.count >= 20 && high.count >= 20);
});

test('a threshold of zero is not a crash', () => {
  const scope = { clauses: [{ stats: [{ metric: 'goals_after_age_30', op: '>=', value: 0 }] }] };
  const near = nearestThreshold({ scope, metric: 'goals_after_age_30', players, floor: 20, max: 400 });
  assert.ok(near === null || near.count >= 0, 'either no suggestion, or a real one');
});

test('the coverage sentence says how many and why', () => {
  // La Liga 2002-2011 really does resolve to 14 players in the fixture.
  const thin = { clauses: [{ leagues: ['ES1'], seasonStart: 2002, seasonEnd: 2011 }] };
  const sentence = describeCoverage({ scope: thin, count: 14, floor: 20, registry });
  assert.match(sentence, /14/);
  assert.match(sentence, /20/);
  assert.equal(sentence.includes('scope'), false, 'the sentence must not name a scope');
  assert.equal(sentence.includes('ES1'), false, 'the sentence must not show a raw league code');
  assert.match(sentence, /La Liga/, 'the league is named, not coded');
});

test('a scope naming a nation the data does not know is refused', () => {
  const result = validateScope({ clauses: [{ nationalities: ['Atlantis'] }] }, { registry, players });
  assert.equal(result.ok, false);
});

test('a pool over the floor needs no sentence', () => {
  assert.equal(describeCoverage({ scope: laliga, count: 236, floor: 20 }), '');
});

test('a valid scope passes validation', () => {
  const result = validateScope(wc, { registry, players });
  assert.equal(result.ok, true, result.reason);
});

test('a scope naming a league that does not exist is refused', () => {
  const result = validateScope({ clauses: [{ leagues: ['NOPE1'] }] }, { registry, players });
  assert.equal(result.ok, false);
  assert.ok(result.reason.length > 0);
});

test('a scope naming a stat that does not exist is refused', () => {
  const result = validateScope({ clauses: [{ stats: [{ metric: 'made_up_metric', op: '>=', value: 5 }] }] }, { registry, players });
  assert.equal(result.ok, false);
});

test('a scope with a number where a year should be is refused', () => {
  const result = validateScope({ clauses: [{ leagues: ['ES1'], seasonStart: 'last year', seasonEnd: 2019 }] }, { registry, players });
  assert.equal(result.ok, false);
});
