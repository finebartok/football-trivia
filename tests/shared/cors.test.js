import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { json, preflight } from '../../supabase/functions/_shared/pool-count.js';

test('a browser preflight is answered before the handler runs', () => {
  const res = preflight(new Request('https://example.test/start-room', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
});

test('a normal request is not a preflight', () => {
  assert.equal(preflight(new Request('https://example.test/start-room', { method: 'POST' })), null);
});

test('the preflight allows the headers the client asked about', () => {
  const res = preflight(new Request('https://example.test/start-room', {
    method: 'OPTIONS',
    headers: { 'access-control-request-headers': 'authorization, x-client-info' },
  }));
  assert.equal(res.headers.get('access-control-allow-headers'), 'authorization, x-client-info');
});

test('a JSON answer carries the CORS headers too', async () => {
  const res = json({ ok: true }, 201);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { ok: true });
});

test('the local runner sends one set of lowercase CORS headers', () => {
  const source = fs.readFileSync(
    new URL('../../scripts/serve-functions.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /'access-control-allow-origin'/);
  assert.match(
    source,
    /'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version'/,
  );
  assert.doesNotMatch(source, /'Access-Control-Allow-Origin'/);
});
