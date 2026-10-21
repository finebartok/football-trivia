import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, writeManifest, sha256File, fileBytes } from './lib/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BASE = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data';

// The R2 host rejects requests without a User-Agent (a bare urllib/curl gets a
// 403). Node's fetch always sends one, but pinning it keeps the request honest
// and survives a proxy or a stricter host.
const UA = 'football-trivia-ingest/1.0';

export const SOURCES = {
  players: `${BASE}/players.csv.gz`,
  transfers: `${BASE}/transfers.csv.gz`,
  games: `${BASE}/games.csv.gz`,
  clubs: `${BASE}/clubs.csv.gz`,
  competitions: `${BASE}/competitions.csv.gz`,
  appearances: `${BASE}/appearances.csv.gz`,
  game_events: `${BASE}/game_events.csv.gz`,
  player_valuations: `${BASE}/player_valuations.csv.gz`,
};

export async function fetchAll({ dest = path.join(REPO, 'data', 'raw'), sources = SOURCES, force = false } = {}) {
  await fsp.mkdir(dest, { recursive: true });
  const manifest = readManifest(dest);

  for (const [name, url] of Object.entries(sources)) {
    const file = path.join(dest, `${name}.csv.gz`);
    const known = manifest.sources[name];

    if (!force && fs.existsSync(file) && known) {
      const actual = await sha256File(file);
      if (actual === known.sha256) {
        console.log(`  ${name}: cached (sha256 ok)`);
        continue;
      }
      console.log(`  ${name}: hash changed, re-downloading`);
    }

    console.log(`  ${name}: downloading`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(file, buf);

    manifest.sources[name] = {
      url,
      sha256: await sha256File(file),
      bytes: await fileBytes(file),
      fetchedAt: Date.now(),
    };
    writeManifest(dest, manifest);
  }

  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchAll();
  console.log('fetch complete');
}
