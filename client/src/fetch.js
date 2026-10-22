/**
 * A fetch that gives up.
 *
 * A network that hangs is worse than one that fails: the button says
 * "Joining…" and the player waits forever, with nothing to tell them
 * that anything is wrong. A request that takes longer than it should is
 * a failed request.
 */

/**
 * @param {string|Request} url
 * @param {object} init
 * @param {number} timeoutMs
 */
export function fetchWithTimeout(url, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}
