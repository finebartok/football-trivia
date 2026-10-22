import { scopePool } from '/js/engine/index.js';
import { fetchWithTimeout } from './fetch.js';

export { PRESETS } from '/js/presets.js';

let players = [];
let registry = null;
let loaded = false;

export async function loadPool() {
  if (loaded) return { registry, players };
  // The pool is megabytes. It gets more time than a room call, but not
  // forever.
  const res = await fetchWithTimeout('/data/fixtures/pool.sample.json', {}, 30000);
  if (!res.ok) throw new Error(`failed to load pool: ${res.status} ${res.statusText}`);
  const data = await res.json();
  registry = data.registry;
  players = data.players ?? [];
  loaded = true;
  return { registry, players };
}

export function poolFor(scope) {
  return scopePool(scope, players);
}

export function countFor(scope) {
  return poolFor(scope).length;
}
