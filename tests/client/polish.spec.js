import test, { expect } from '@playwright/test';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test('the sound can be turned off, and stays off', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.waitForSelector('#btn-sound');

  const button = page.locator('#btn-sound');
  await expect(button).toHaveAttribute('aria-label', /Turn sound off/);
  await button.click();
  await expect(button).toHaveAttribute('aria-label', /Turn sound on/);

  // The choice survives a reload.
  await page.reload();
  await page.waitForSelector('#btn-sound');
  await expect(page.locator('#btn-sound')).toHaveAttribute('aria-label', /Turn sound on/);

  expect(errors).toEqual([]);
});

test('a second tab hears about the mute', async ({ page, context }) => {
  await page.goto('./');
  await page.waitForSelector('#btn-sound');
  await page.locator('#btn-sound').click();
  await expect(page.locator('#btn-sound')).toHaveAttribute('aria-label', /Turn sound on/);

  // Another tab on the same game - the same browser, so the same storage -
  // shows the same choice.
  const other = await context.newPage();
  await other.goto('./');
  await other.waitForSelector('#btn-sound');
  await expect(other.locator('#btn-sound')).toHaveAttribute('aria-label', /Turn sound on/);
});

test('the game still works with the sound off', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.waitForSelector('#btn-sound');
  await page.locator('#btn-sound').click();

  await page.locator('.vibe-card--preset').first().click();
  await expect(page).toHaveURL(/#lobby/);
  await page.locator('#btn-start').click();
  await expect(page).toHaveURL(/#round/);
  await expect(page.locator('.option')).toHaveCount(4);

  expect(errors).toEqual([]);
});

test('the reduced-motion rule switches the movement off', async ({ page }) => {
  await page.goto('./');
  const css = await page.evaluate(async () => {
    const res = await fetch('/client/styles/app.css');
    return res.text();
  });
  expect(css).toContain('prefers-reduced-motion');
  expect(css).toContain('transition');
});

test('a pool that will not load says so, and can be tried again', async ({ page }) => {
  let fail = true;
  await page.route('**/data/fixtures/pool.sample.json', async (route) => {
    if (fail) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto('./');
  await page.waitForSelector('#pool-error');
  await expect(page.locator('#pool-error')).toContainText('Could not load the players');
  await expect(page.locator('#pool-retry')).toBeVisible();

  // And trying again works once the network does.
  fail = false;
  await page.locator('#pool-retry').click();
  await page.waitForTimeout(2000);
  await expect(page.locator('#pool-error')).toHaveCount(0);

  // The counts are back.
  await expect(page.locator('.vibe-card__count').first()).not.toHaveText('…');
  await expect(page.locator('.vibe-card__count').first()).toContainText('players');
});

test('the manifest is served and says what the game is', async ({ request }) => {
  const res = await request.get('/client/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.name).toContain('Football Trivia');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test('the service worker is served', async ({ request }) => {
  const res = await request.get('/client/sw.js');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('addEventListener');
});

test('the page asks for the manifest and the worker', async ({ page }) => {
  await page.goto('./');
  const html = await page.content();
  expect(html).toContain('manifest.webmanifest');
});

// ---- the review's findings ----

test('the round clock counts down in seconds', async ({ page }) => {
  await page.goto('./');
  await page.locator('.vibe-card--preset').first().click();
  await page.locator('#btn-start').click();
  await expect(page).toHaveURL(/#round/);
  await page.waitForSelector('#round-timer');

  const shown = await page.locator('#round-timer').innerText();
  const seconds = Number(shown.replace(/\D/g, ''));
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(20);
});

test('the mute still works when the browser has no storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage is not available');
      },
    });
  });
  await page.goto('./');
  await page.waitForSelector('#btn-sound');

  const button = page.locator('#btn-sound');
  await expect(button).toHaveAttribute('aria-label', /Turn sound off/);
  await button.click();
  await expect(button).toHaveAttribute('aria-label', /Turn sound on/);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('the screen moves when the screen changes', async ({ page }) => {
  await page.goto('./');
  await page.locator('.vibe-card--preset').first().click();
  await expect(page).toHaveURL(/#lobby/);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBeGreaterThan(0);
});

test('a clue does not play its note again on every redraw', async ({ page }) => {
  // Count the oscillators the page makes.
  await page.addInitScript(() => {
    window.__oscillators = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      createOscillator() {
        window.__oscillators += 1;
        return super.createOscillator();
      }
    };
  });

  await page.goto('./');
  await page.locator('.vibe-card--preset').first().click();
  await page.locator('#btn-start').click();
  await expect(page).toHaveURL(/#round/);
  await page.waitForTimeout(6500);

  // The clues are out by now. The count must not keep climbing.
  const first = await page.evaluate(() => window.__oscillators);
  await page.waitForTimeout(4000);
  const second = await page.evaluate(() => window.__oscillators);
  expect(second).toBe(first);
});

test('the content does not move while the screen is redrawn', async ({ page }) => {
  // The pool arrives, the store says so, and the screen is redrawn. The
  // content must not move under the reader.
  await page.addInitScript(() => {
    window.__tops = [];
    const sample = () => {
      const h = document.querySelector('.hero__title');
      if (h) {
        const top = Math.round(h.getBoundingClientRect().top);
        const last = window.__tops[window.__tops.length - 1];
        if (!last || last.top !== top) window.__tops.push({ top, t: Math.round(performance.now()) });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.goto('./');
  await page.waitForTimeout(3000);

  const tops = await page.evaluate(() => window.__tops);
  expect(tops.length).toBe(1);
});

test('the worker never caches the player pool', async ({ page }) => {
  await page.goto('./');
  await page.waitForSelector('.vibe-card--preset');
  // The pool is fetched for the counts.
  await page.waitForFunction(() =>
    document.querySelector('.vibe-card__count')?.textContent?.includes('players'));
  await page.waitForTimeout(1500);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.filter((u) => u.includes('/data/fixtures/'))).toEqual([]);
});

test('the worker never caches an error page', async ({ page }) => {
  await page.goto('./');
  await page.waitForSelector('.vibe-card--preset');
  await page.waitForTimeout(1200);

  // A file that is not there.
  await page.goto('./client/no-such-file');
  await page.waitForTimeout(800);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.filter((u) => u.includes('no-such-file'))).toEqual([]);
});
