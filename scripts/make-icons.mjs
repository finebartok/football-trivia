/**
 * The raster icons, from the SVG.
 *
 * A browser that will not take an SVG icon wants a 192 and a 512 PNG.
 * Chromium can render the SVG and screenshot it, which is all this needs.
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const svg = await readFile(new URL('../client/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true });
  await writeFile(new URL(`../client/icons/icon-${size}.png`, import.meta.url), png);
  console.log(`wrote client/icons/icon-${size}.png`);
  await page.close();
}

await browser.close();
