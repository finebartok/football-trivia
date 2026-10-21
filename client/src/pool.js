import { scopePool } from '/js/engine/index.js';

export { PRESETS } from '/js/presets.js';

let players = [];
let registry = null;
let loaded = false;

export async function loadPool() {
  if (loaded) return { registry, players };
  const res = await fetch('/data/fixtures/pool.sample.json');
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
