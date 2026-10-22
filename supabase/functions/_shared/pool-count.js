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

/** A JSON response. The same shape in Deno and in Node. */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
