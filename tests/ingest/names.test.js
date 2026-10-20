import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, matchKey, isJunkName } from '../../lib/names.js';

test('normaliseName folds accents and punctuation but keeps word order', () => {
  assert.equal(normaliseName('Hakan Çalhanoğlu'), 'hakan calhanoglu');
  assert.equal(normaliseName('  Lionel   Messi  '), 'lionel messi');
  assert.equal(normaliseName("Jules Koundé"), 'jules kounde');
  assert.equal(normaliseName('N\'Golo Kanté'), 'ngolo kante');
});

test('matchKey disambiguates two players who fold to the same name', () => {
  assert.notEqual(matchKey('Sadio Mané'), matchKey('Mane'));
  assert.equal(matchKey('Sadio Mané'), matchKey('Sadio Mane'));
});

test('isJunkName rejects placeholder club and player names', () => {
  assert.equal(isJunkName('without club'), true);
  assert.equal(isJunkName(''), true);
  assert.equal(isJunkName('Lionel Messi'), false);
});
