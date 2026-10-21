# Final Findings Report - Data Spine

## Finding 1: Accumulator Scope in `derive.js`
- **Change:** Added a `ponytail:` comment to the `bump` function in `scripts/ingest/derive.js` clarifying that the `?? 0` accumulator is strictly for additive counts where zero is the correct sum of an empty set.
- **Verification:** Visual check of the diff. Behavior unchanged.

## Finding 2: Timezone-Safe Date Formatting
- **Change:** Replaced `.toISOString().slice(0, 10)` with a local date formatter `formatDate` in `scripts/ingest/export-pool.js` to prevent dates from shifting days due to UTC conversion.
- **Tests:** Created `scripts/ingest/export-pool.test.js` which verifies that dates at both midnight and 23:30 local time format to the expected local calendar date.
- **Command:** `node --test scripts/ingest/export-pool.test.js`
- **Result:** Pass.

## Finding 3: Chromium Resize Path Integration
- **Change:** Exported `defaultResize` from `scripts/ingest/photos.js` to make it testable.
- **Tests:** Created `scripts/ingest/photos.integration.test.js` which downloads a real image and runs it through the actual Chromium-based `defaultResize` path.
- **Verification:**
  - Command: `node --test scripts/ingest/photos.integration.test.js`
  - Image used: `https://via.placeholder.com/800x600.png` (used after Wikimedia Commons URLs were unstable/404).
  - Resulting width: 512px.
  - Resulting height: 384px.
  - Format: WebP (verified via RIFF/WEBP header).
  - Byte size: 1880 bytes.
  - Chromium binary: Installed via `npx playwright install chromium`.
- **Result:** Pass.

## Global Suite
- **Command:** `npm test`
- **Result:** 158/158 passing.
