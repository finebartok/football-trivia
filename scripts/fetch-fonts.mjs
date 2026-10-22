/**
 * The web fonts, fetched once and kept in the repository.
 *
 * The game used to load them from Google Fonts. That meant a request to a
 * third party on every first load, and - the reason this script exists -
 * the text reflowed when the font arrived, so the page visibly jumped.
 * The fonts are OFL-licensed and redistributable.
 *
 * Google serves one variable file per family, covering every weight, so
 * the repository holds one file per family and one @font-face per family
 * with a weight range.
 */
import { mkdir, writeFile } from 'node:fs/promises';

const FAMILIES = [
  { name: 'Fredoka', weights: [400, 700] },
  { name: 'Inter', weights: [400, 600, 800] },
  { name: 'Playfair Display', weights: [600, 900] },
];

// A modern browser gets woff2.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const OUT = new URL('../client/fonts/', import.meta.url);
await mkdir(OUT, { recursive: true });

const faces = new Map();

for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.name).replace(/%20/g, '+')}:wght@${family.weights.join(';')}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${family.name}: ${res.status}`);
  const css = await res.text();

  // The Latin blocks cover the copy and the names.
  const blocks = css.split('/*').filter((b) => b.startsWith(' latin ') || b.startsWith(' latin-ext'));
  for (const block of blocks) {
    const src = block.match(/url\((https:\/\/[^)]+\.woff2)\)/);
    const weight = block.match(/font-weight:\s*(\d+)/);
    const familyName = block.match(/font-family:\s*'([^']+)'/);
    if (!src || !weight || !familyName) continue;

    // Both subsets are needed: "latin" covers the copy, "latin-ext" the
    // names with their accents (Perišić, Čech).
    const subset = block.startsWith(' latin-ext') ? 'latin-ext' : 'latin';
    const key = src[1];
    const face = faces.get(key) ?? {
      family: familyName[1],
      url: src[1],
      file: `${familyName[1].toLowerCase().replace(/\s+/g, '-')}-${subset}.woff2`,
      from: Number(weight[1]),
      to: Number(weight[1]),
    };
    face.from = Math.min(face.from, Number(weight[1]));
    face.to = Math.max(face.to, Number(weight[1]));
    faces.set(key, face);
  }
}

for (const face of faces.values()) {
  const font = await fetch(face.url, { headers: { 'User-Agent': UA } });
  if (!font.ok) throw new Error(`${face.file}: ${font.status}`);
  await writeFile(new URL(face.file, OUT), Buffer.from(await font.arrayBuffer()));
  console.log(`wrote client/fonts/${face.file} (${face.from}-${face.to})`);
}

const css = `/*
 * The web fonts.
 *
 * Fetched once by scripts/fetch-fonts.mjs and kept in the repository, so
 * the game does not ask a third party for them and the text does not
 * reflow when they arrive. Licensed under the SIL Open Font License.
 */
${[...faces.values()].map((f) => `@font-face {
  font-family: '${f.family}';
  font-style: normal;
  font-weight: ${f.from} ${f.to};
  font-display: swap;
  src: url('/client/fonts/${f.file}') format('woff2');
}`).join('\n')}
`;

await writeFile(new URL('../client/styles/fonts.css', import.meta.url), css);
console.log(`wrote client/styles/fonts.css with ${faces.size} faces`);
