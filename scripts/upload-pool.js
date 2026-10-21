/**
 * Uploads the player pool to the Storage bucket the server reads.
 *
 * The pool is the engine's input contract, produced by
 * `npm run fixtures` from the database.
 */
import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const body = await fs.readFile(new URL('../data/fixtures/pool.sample.json', import.meta.url));
const admin = createClient(url, key, { auth: { persistSession: false } });

const { error } = await admin.storage.from('pool').upload('pool.json', body, {
  contentType: 'application/json',
  upsert: true,
});
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(`uploaded pool.json (${Math.round(body.length / 1024)}KB) to ${url}`);
