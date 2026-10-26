/**
 * The player data the site actually serves.
 *
 * The fixture holds everything the engine can use. The browser does not
 * need all of it: a preset only ever looks at its own players, and v1 never
 * reads the club list or the club-season windows. Those two are most of the
 * registry, so the published files leave them out.
 *
 * This module is pure on purpose. The publish script writes what it builds,
 * and the tests check that a trimmed file plans the same quiz as the full
 * fixture.
 */

import { scopePool } from '../js/engine/index.js';

function clauseValue(clauses, field) {
  return new Set((clauses ?? []).flatMap((clause) => clause[field] ?? []));
}

/**
 * Keep the registry entries a v1 scope can resolve: league names and
 * tournament windows. A preset passes its own tournament ids; the full pool
 * keeps every tournament window.
 */
export function trimRegistry(registry, tournamentIds = null) {
  const windows = {};
  for (const [id, window] of Object.entries(registry?.windows ?? {})) {
    if (window?.kind !== 'tournament') continue;
    if (tournamentIds && !tournamentIds.has(id)) continue;
    windows[id] = window;
  }
  return {
    leagues: { ...(registry?.leagues ?? {}) },
    // Kept so the registry keeps its shape for anything that reads it.
    clubs: [],
    windows,
    tournaments: [...(registry?.tournaments ?? [])],
  };
}

/** One pool per preset, holding only that preset's players. */
export function buildPresetSlices(pool, presets) {
  const players = pool.players ?? [];
  return presets.map((preset) => {
    const scoped = scopePool({ clauses: preset.clauses }, players);
    return {
      id: preset.id,
      count: scoped.length,
      data: {
        _note: pool._note,
        registry: trimRegistry(pool.registry, clauseValue(preset.clauses, 'tournaments')),
        players: scoped,
      },
    };
  });
}

/** The pool a hand-built vibe can draw from. */
export function buildLeanPool(pool) {
  return {
    _note: pool._note,
    registry: trimRegistry(pool.registry),
    players: pool.players ?? [],
  };
}

/** What the home screen needs before it has any players. */
export function buildMeta(slices) {
  return {
    counts: Object.fromEntries(slices.map((slice) => [slice.id, slice.count])),
  };
}
