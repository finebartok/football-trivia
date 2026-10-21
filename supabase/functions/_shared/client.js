/**
 * The Supabase clients a function may use.
 *
 * `serviceClient` bypasses row-level security. It is the only thing that
 * may read the quiz plan and the answer key, and it is used only where
 * the caller has already been checked.
 *
 * `callerClient` carries the caller's own JWT, so the database applies
 * the caller's permissions. Use it for anything that reads a room's
 * members.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function callerClient(req) {
  const auth = req.headers.get('Authorization') ?? '';
  return createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: auth } },
    },
  );
}
