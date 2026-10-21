/**
 * The Edge Functions, served locally by Node.
 *
 * A hosted project serves these from Supabase's edge runtime. This
 * script serves the same handlers, from the same code, for development on
 * a machine where the edge runtime cannot run.
 *
 *   node scripts/serve-functions.js
 *
 * The handlers are ordinary Request/Response code, so nothing about them
 * changes between here and Deno.
 */
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { handlePoolCount } from '../supabase/functions/_shared/pool-count.js';
import { handleStartRoom } from '../supabase/functions/_shared/start-room.js';

const PORT = Number(process.env.FUNCTIONS_PORT) || 54399;

const FUNCTIONS = {
  'pool-count': handlePoolCount,
  'start-room': handleStartRoom,
};

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const name = url.pathname.replace(/^\/+|\/+$/g, '');
  const handler = FUNCTIONS[name];

  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no such function' }));
    return;
  }

  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const request = new Request(url, { method: req.method, headers: req.headers, body });
    const response = await handler(request, { createClient, env });
    const text = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(text);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`⚽ Edge functions on http://localhost:${PORT}/<name>`);
});
