import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow, windowLabel } from '../../js/engine/window.js';

const registry = {
  leagues: { ES1: 'La Liga', GB1: 'Premier League' },
  clubs: [{ id: 12, name: 'FC Barcelona' }],
  windows: {
    'wc-2022': { id: 'wc-2022', kind: 'tournament', label: '2022 World Cup', detail: 'the tournament', tournamentId: 'wc-2022', seasonStart: 2022, seasonEnd: 2022, clubId: null, teamName: null, ageFrom: null, ageTo: null },
  },
  tournaments: [{ id: 'wc-2022', name: '2022 FIFA World Cup', year: 2022 }],
};

test('a tournament clause resolves to that tournament window', () => {
  const w = resolveWindow({ clauses: [{ tournaments: ['wc-2022'] }] }, registry);
  assert.equal(w.kind, 'tournament');
  assert.equal(w.id, 'wc-2022');
  assert.equal(windowLabel(w), '2022 World Cup');
});

test('a league and era clause resolves to a season_range window', () => {
  const w = resolveWindow({ clauses: [{ leagues: ['ES1'], seasonStart: 2010, seasonEnd: 2019 }] }, registry);
  assert.equal(w.kind, 'season_range');
  assert.equal(w.seasonStart, 2010);
  assert.equal(w.seasonEnd, 2019);
  assert.match(windowLabel(w), /2010.*2019/);
});

test('an explicit scope window wins over the derived one', () => {
  const w = resolveWindow({ clauses: [{ tournaments: ['wc-2022'] }], window: 'wc-2022' }, registry);
  assert.equal(w.id, 'wc-2022');
});

test('a scope with no derivable window resolves to null', () => {
  assert.equal(resolveWindow({ clauses: [{ positions: ['Forward'] }] }, registry), null);
});
