import test, { expect } from '@playwright/test';
import { roomWithTwoPlayers } from './helpers.js';

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

test('the room reveal shows something while it waits for the round to close', async ({ browser }) => {
  // A room is a round trip to a database that the rest of the suite is
  // using at the same time.
  test.setTimeout(120000);
  const { host } = await roomWithTwoPlayers(browser);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await host.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);

  // The answer is only available once the round closes, but the screen
  // must not be blank while it waits.
  await expect(host.locator('#app')).not.toBeEmpty();
  await expect(host.locator('#reveal-waiting')).toBeVisible({ timeout: 30000 });
});

test('a failed join says why', async ({ page }) => {
  await page.goto('#join');
  await page.waitForSelector('#join-code');
  await page.locator('#join-code').fill('ZZZZZZ');
  await page.locator('#join-name').fill('Sam');
  await page.locator('#btn-join').click();
  await page.waitForTimeout(1500);

  await expect(page.locator('#join-error')).toContainText(/room/i, { timeout: 30000 });
  // The code they typed is still there.
  await expect(page.locator('#join-code')).toHaveValue('ZZZZZZ');
});

test('the threshold field keeps the caret while the count updates', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#stat-value');

  await page.locator('#stat-value').click();
  await page.locator('#stat-value').press('Control+a');
  await page.locator('#stat-value').type('250', { delay: 60 });

  await expect(page.locator('#stat-value')).toHaveValue('250');
  // The field still has the focus, so the next digit would land in it.
  const focused = await page.evaluate(() => document.activeElement?.id);
  expect(focused).toBe('stat-value');
});

test('the suggestion counts the number that was typed', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#stat-value');
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('200');
  await page.waitForTimeout(500);

  // The count in the sentence is the count for the number that was
  // typed - the same count the card above shows - not the count for the
  // suggestion.
  const sentence = await page.locator('#stat-suggestion').innerText();
  const count = Number(sentence.match(/Only (\d+)/)?.[1]);
  const card = Number(await page.locator('#pool-count strong').innerText());
  expect(count).toBe(card);
  expect(count).toBeGreaterThan(0);
});

test('a room that will not come says why', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#btn-create-room');

  // The server is not there.
  await page.route('**/rest/v1/rpc/create_room', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'the database is on fire' }),
  }));

  await page.locator('#btn-create-room').click();
  // The player is told, in plain words, and not with the server's raw
  // message.
  await expect(page.locator('#vibe-error')).toContainText(/went wrong/i);
  await expect(page.locator('#btn-create-room')).toBeEnabled();
});
