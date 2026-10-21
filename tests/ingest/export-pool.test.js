import assert from 'node:assert';
import { test } from 'node:test';
import { formatDate } from '../../scripts/ingest/export-pool.js';

// The point of this test is that a Date must format to its LOCAL calendar
// date, not its UTC one. `toISOString()` would shift a late-evening local
// date to the next day, so the expectations below are hardcoded rather than
// recomputed with the same logic the implementation uses.
test('formatDate renders the local calendar date, not the UTC one', () => {
  // Local midnight, 1 January 1987
  const midnight = new Date(1987, 0, 1, 0, 0, 0);
  assert.strictEqual(formatDate(midnight), '1987-01-01');

  // Local 23:30 on 24 June 1987 - toISOString() would give 1987-06-24 in UTC
  // for most timezones, but the local calendar date is what we want.
  const lateEvening = new Date(1987, 5, 24, 23, 30, 0);
  assert.strictEqual(formatDate(lateEvening), '1987-06-24');

  // A single-digit month and day must be zero-padded.
  const padded = new Date(2001, 2, 4, 12, 0, 0);
  assert.strictEqual(formatDate(padded), '2001-03-04');
});
