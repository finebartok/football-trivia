import { scopePool } from '/js/engine/index.js';
import { fetchWithTimeout } from './fetch.js';

export { PRESETS, presetById, presetMatchesScope } from '/js/presets.js';

const FULL_POOL_URL = '/data/fixtures/pool.sample.json';
const META_URL = '/data/pools/meta.json';

let players = [];
let registry = null;
let loadedKey = null;

/**
 * Load the whole pool, or the slice for one preset.
 *
 * A preset's slice holds only the players that preset can draw from, so a
 * quick game does not wait for data it will never read. A slice that is not
 * there - local development before `npm run publish` - is handled by the
 * store, which falls back to the full pool.
 */
export async function loadPool(key = 'full') {
  if (loadedKey === key) return { key, registry, players };
  const url = key === 'full'
    ? FULL_POOL_URL
    : `/data/pools/${encodeURIComponent(key)}.json`;
  const res = await fetchWithTimeout(url, {}, 30000);
  if (!res.ok) throw new Error(`failed to load pool: ${res.status} ${res.statusText}`);
  const data = await res.json();
  registry = data.registry;
  players = data.players ?? [];
  loadedKey = key;
  return { key, registry, players };
}

/** The counts every preset had when the site was published. */
export async function loadPoolMeta() {
  const res = await fetchWithTimeout(META_URL, {}, 5000);
  if (!res.ok) return null;
  return res.json();
}

export function poolFor(scope) {
  return scopePool(scope, players);
}

export function countFor(scope) {
  return poolFor(scope).length;
}
