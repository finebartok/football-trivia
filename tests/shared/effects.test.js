import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSteal } from '../../supabase/functions/_shared/effects.js';

function adminReturning(result) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return chain;
}

test('a steal row means the caller is copying', async () => {
  const admin = adminReturning({ data: { id: 'effect-1' }, error: null });
  assert.equal(await hasSteal(admin, 'round-1', 'user-1'), true);
});

test('no steal row means the caller answers for themselves', async () => {
  const admin = adminReturning({ data: null, error: null });
  assert.equal(await hasSteal(admin, 'round-1', 'user-1'), false);
});

test('a failed check fails closed', async () => {
  const admin = adminReturning({ data: null, error: { message: 'connection reset' } });
  assert.equal(await hasSteal(admin, 'round-1', 'user-1'), true);
});
