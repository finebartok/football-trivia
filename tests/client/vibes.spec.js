import { test, expect } from '@playwright/test';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test('a threshold the player typed is kept, with a suggestion beside it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');

  const before = Number(await page.locator('#pool-count strong').innerText());

  // Type a threshold that leaves too few players.
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('200');
  await page.waitForTimeout(400);

  // The number they typed is still there.
  await expect(page.locator('#stat-value')).toHaveValue('200');

  // The count moved.
  const after = Number(await page.locator('#pool-count strong').innerText());
  expect(after).toBeLessThan(before);

  // And there is a suggestion.
  await expect(page.locator('#stat-suggestion')).toBeVisible();
  await expect(page.locator('#stat-suggestion')).toContainText(/try \d+/);

  expect(errors).toEqual([]);
});

test('a threshold of zero does not break the count', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('0');
  await page.waitForTimeout(400);
  await expect(page.locator('#pool-count strong')).toBeVisible();
  await page.locator('#stat-value').fill('-5');
  await page.waitForTimeout(400);
  await expect(page.locator('#pool-count strong')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a suggestion one tap away fixes the threshold', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('200');
  await page.waitForTimeout(400);

  await page.locator('#stat-suggestion button').click();
  await page.waitForTimeout(400);

  const value = await page.locator('#stat-value').inputValue();
  expect(Number(value)).toBeLessThan(200);
  await expect(page.locator('#stat-suggestion')).toHaveCount(0);
});
