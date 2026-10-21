import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../client/src/config.js';

test('the client knows where the backend is', () => {
  assert.match(config.supabaseUrl, /^https?:\/\//, 'a url');
  assert.ok(config.supabaseAnonKey.length > 20, 'an anon key');
});

test('the anon key is the public one, never the service role', () => {
  assert.equal(config.supabaseAnonKey.includes('service_role'), false);
  assert.equal(/sb_secret_/.test(config.supabaseAnonKey), false, 'a secret key must never be in the client');
});
