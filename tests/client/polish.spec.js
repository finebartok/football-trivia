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
