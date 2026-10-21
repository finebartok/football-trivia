/**
 * The local Supabase stack, when it is running.
 *
 * The integration tests skip themselves when it is not, so `npm test`
 * stays green on a machine without Docker.
 */
import { createClient } from '@supabase/supabase-js';

export const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

export const ANON_KEY = process.env.SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Where the edge functions are served. Locally that is the Node runner. */
export const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? 'http://127.0.0.1:54399';

export async function stackIsUp() {
  try {
    const res = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

/** A signed-in anonymous client, as a player would have. */
export async function playerClient() {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, userId: data.user.id, accessToken: data.session.access_token };
}

/** A client on the service role. The server's own key. */
export function serverClient() {
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/** Call an edge function the way the client does. */
export async function callFunction(name, body, accessToken) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

/** A room code that has not been used yet. The database keeps its rows between runs. */
export function uniqueCode(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 12);
}

/** The local database, for the checks that are not about the API. */
export const DB_URL = process.env.SUPABASE_DB_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
