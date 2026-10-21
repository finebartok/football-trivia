/**
 * The player pool, fetched from Storage.
 *
 * The pool is the engine's input contract. It is 3.7MB, so it is fetched
 * once per function instance and held in memory.
 */

let cached = null;

export async function loadPool(url, token) {
  if (cached) return cached;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`could not fetch the player pool: ${res.status} ${res.statusText}`);
  }
  cached = await res.json();
  return cached;
}
