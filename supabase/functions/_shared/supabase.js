/**
 * The Supabase clients, built from whatever the host provides.
 *
 * Deno and Node disagree about how to import the SDK and how to read the
 * environment, so the caller passes both in. The logic that uses the
 * clients never has to know which runtime it is on.
 */

export function makeClients({ createClient, env }) {
  return {
    /** Bypasses row-level security. The only thing that may read the plan and the answer key. */
    serviceClient() {
      return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    },

    /** Carries the caller's own JWT, so the database applies the caller's permissions. */
    callerClient(req) {
      const auth = req.headers.get('Authorization') ?? '';
      return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: auth } },
      });
    },
  };
}
