/**
 * The Supabase client, and the anonymous identity behind it.
 *
 * The SDK is loaded from a CDN as an ES module. The client has no build
 * step, so it cannot bundle a dependency, and a dependency that is not
 * loaded must not break the game: if the import fails, `connect` returns
 * null and multiplayer is unavailable while solo play carries on.
 */
import { config } from './config.js';
import { fetchWithTimeout } from './fetch.js';

const SDK_URL = 'https://esm.sh/@supabase/supabase-js@2.49.8';

let client = null;
let loading = null;

/**
 * The signed-in client, or null when the backend cannot be reached.
 *
 * The identity is anonymous: no email, no password, no sign-up form. The
 * session is persisted, so a refresh keeps the same player.
 */
export async function connect() {
  if (client) return client;
  if (loading) return loading;

  loading = (async () => {
    let createClient;
    try {
      ({ createClient } = await import(SDK_URL));
    } catch (err) {
      console.warn('multiplayer is unavailable:', err);
      return null;
    }

    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      // A request that hangs must not hold the player's button down
      // forever.
      global: { fetch: (url, init) => fetchWithTimeout(url, init) },
    });

    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn('multiplayer is unavailable:', error);
        return null;
      }
    }

    client = supabase;
    return client;
  })();

  const result = await loading;
  loading = null;
  return result;
}

/** The signed-in user's id, or null. */
export async function myUserId() {
  const supabase = await connect();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Call an edge function.
 *
 * By default the call goes through the SDK, which addresses the hosted
 * project. When `config.functionsUrl` is set - which is how the local
 * development runner is reached - the call goes there instead.
 */
export async function invokeFunction(name, body) {
  if (config.functionsUrl) {
    const res = await fetch(`${config.functionsUrl}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${(await currentToken()) ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return { status: res.status, data: JSON.parse(text) };
    } catch {
      return { status: res.status, data: { error: text } };
    }
  }

  const supabase = await connect();
  if (!supabase) return { status: 0, data: { error: 'multiplayer is unavailable' } };
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // The hosted path throws the server's answer away unless the body is
    // read out of the error's context. "Something went wrong" is not
    // something a player can act on.
    let message = error.message;
    const context = error.context;
    if (context && typeof context.text === 'function') {
      try {
        const parsed = JSON.parse(await context.text());
        if (parsed?.error) message = parsed.error;
      } catch {
        // The body was not JSON. The message stands.
      }
    }
    return { status: error.status ?? 500, data: { error: message } };
  }
  return { status: 200, data };
}

/** The signed-in access token, for a direct call to the functions. */
async function currentToken() {
  const supabase = await connect();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
