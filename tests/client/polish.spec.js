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
