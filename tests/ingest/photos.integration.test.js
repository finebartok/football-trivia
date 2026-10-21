import assert from 'node:assert';
import { test } from 'node:test';
import { defaultResize } from '../../scripts/ingest/photos.js';

// This exercises the REAL Chromium resize path (canvas.toDataURL('image/webp')),
// which the offline suite cannot cover because it needs a browser and a
// network fetch. It is opt-in so the default `npm test` stays offline and
// deterministic:
//
//   npm test                                  # skips this file
//   PHOTOS_INTEGRATION=1 npm test             # runs it
//
// The image is fetched from Wikimedia Commons, which is the same source the
// pipeline itself uses for player photos.
// Special:FilePath resolves a Commons file name to the actual file and
// serves a thumbnail at the requested width. Verified to return 200.
const IMAGE_URL =
  'https://commons.wikimedia.org/wiki/Special:FilePath/Leo%20Messi%20Argentina%20v%20Egypt%207%20July%202026-1.jpg?width=800';

test('the real chromium resize produces a 512px WebP', async (t) => {
  if (!process.env.PHOTOS_INTEGRATION) {
    t.skip('set PHOTOS_INTEGRATION=1 to run the real Chromium resize path');
    return;
  }

  const res = await fetch(IMAGE_URL, { headers: { 'User-Agent': 'FootballTriviaBuild/1.0' } });
  assert.ok(res.ok, `fetching ${IMAGE_URL} failed with ${res.status}`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  assert.ok(buffer.length > 1000, 'the downloaded image looks too small to be a real photo');

  const resized = await defaultResize(buffer);

  assert.strictEqual(resized.width, 512, 'the resized image must be 512px wide');
  assert.ok(resized.height > 0, 'the resized image must have a height');
  assert.ok(resized.buffer.length > 0, 'the resized image must have bytes');

  // A WebP file starts with a RIFF container whose form type is WEBP.
  const header = Buffer.from(resized.buffer).slice(0, 12).toString('latin1');
  assert.ok(header.startsWith('RIFF'), `expected a RIFF container, got "${header}"`);
  assert.ok(header.includes('WEBP'), `expected a WEBP payload, got "${header}"`);
});
