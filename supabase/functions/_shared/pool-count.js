/**
 * How many players does a vibe resolve to?
 *
 * This function exists to prove the engine runs on the server before the
 * room is built on top of it. It answers with a number and nothing else.
 */
import { scopePool } from './vendor/js/engine/index.js';
import { presetById } from './vendor/js/presets.js';
import { makeClients } from '../_shared/supabase.js';
import { loadPool } from '../_shared/pool.js';

export async function handlePoolCount(req, { createClient, env }) {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const url = new URL(req.url);
    const scopeId = url.searchParams.get('scope_id') ?? '';
    const preset = presetById(scopeId);
    if (!preset) {
      return json({ error: 'unknown vibe' }, 400);
    }

    const admin = makeClients({ createClient, env }).serviceClient();
    const { data: file, error } = await admin.storage
      .from('pool')
      .createSignedUrl('pool.json', 600);
    if (error) throw error;

    const pool = await loadPool(file.signedUrl);
    const players = scopePool({ clauses: preset.clauses }, pool.players ?? []);
    return json({ scope_id: scopeId, count: players.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

/**
 * A JSON response. The same shape in Deno and in Node.
 *
 * The game is served from its own origin, so every answer - including the
 * error answers - has to let the browser read it. The local runner adds
 * these headers itself, but the hosted runtime does not.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/** The browser's preflight, answered before the handler reads the request. */
export function preflight(req) {
  if (req.method !== 'OPTIONS') return null;
  // A browser rejects the call if any header it asked about is missing
  // from the answer. The Supabase client adds headers of its own, so
  // allow exactly what this request asked for rather than a fixed list.
  const asked = req.headers.get('access-control-request-headers');
  return new Response(null, {
    status: 204,
    headers: asked
      ? { ...CORS, 'Access-Control-Allow-Headers': asked }
      : CORS,
  });
}
