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

test('a vibe can be shared, and the link opens as a card', async ({ page, context }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#btn-share').click();

  const link = await page.locator('#btn-share').getAttribute('data-link');
  expect(link).toContain('#vibe?c=');

  // A different browser opens the link and lands on a playable card.
  const other = await (await context.browser().newContext()).newPage();
  await other.goto(link);
  await other.waitForTimeout(800);
  await expect(other.locator('.vibe-summary__body')).toContainText('La Liga 2010s');
  await expect(other.locator('#pool-count')).toBeVisible();
});

test('a link that is not a vibe says so', async ({ page }) => {
  await page.goto('#vibe?c=not-a-scope');
  await page.waitForTimeout(600);
  await expect(page.locator('#vibe-error')).toContainText('not a vibe');
});

test('a thin pool says why', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');

  // The earliest era in the data is 2002-2011, and La Liga has only 14
  // players in it - under the floor of 20.
  await page.locator('select[aria-label="Different era"]').selectOption('2002-2011');
  await page.waitForTimeout(500);

  await expect(page.locator('#pool-count strong')).toHaveText('14');
  const warning = page.locator('#pool-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Only 14 players');
  await expect(warning).toContainText('La Liga');
  await expect(warning).not.toContainText('ES1');
});

test('a thin scope cannot be saved, and says why', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');

  // A threshold that leaves too few players.
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('300');
  await page.waitForTimeout(500);

  const save = page.locator('#btn-make-ours');
  await expect(save).toBeDisabled();
  await expect(page.locator('#save-reason')).toContainText(/Only \d+ players?/);
  await expect(page.locator('#save-reason')).toContainText('at least 20');
});

test('a scope over the floor can be saved', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#btn-make-ours').click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#home/);
});

test('a vibe saved on one phone does not appear on another', async ({ page, context }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#vibe-name').fill('Mine');
  await page.locator('#btn-make-ours').click();
  await page.waitForTimeout(300);

  // A different browser has its own storage.
  const other = await (await context.browser().newContext()).newPage();
  await other.goto('./');
  await other.waitForTimeout(600);
  await expect(other.locator('.vibe-card--saved')).toHaveCount(0);
});

// ---- the review's findings ----

test('typing a threshold keeps the competition the player chose', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');

  // Pick a competition, then type a threshold.
  await page.locator('select[aria-label="Different competition"]').selectOption({ index: 1 });
  await page.waitForTimeout(400);
  const before = await page.locator('#pool-count strong').innerText();

  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('50');
  await page.waitForTimeout(500);

  // The competition is still there: the threshold refines the vibe, it
  // does not replace it.
  await page.locator('#btn-share').click();
  const link = await page.locator('#btn-share').getAttribute('data-link');
  const payload = JSON.parse(Buffer.from(link.split('#vibe?c=')[1], 'base64url').toString('utf8'));
  expect(JSON.stringify(payload.clauses)).toContain('leagues');
  expect(before.length).toBeGreaterThan(0);
});

test('the metric the player picks is the metric that is used', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');

  await page.locator('#stat-metric').selectOption('international_caps');
  await page.locator('#stat-value').fill('60');
  await page.waitForTimeout(500);

  await expect(page.locator('#stat-metric')).toHaveValue('international_caps');

  await page.locator('#btn-share').click();
  const link = await page.locator('#btn-share').getAttribute('data-link');
  const payload = JSON.parse(Buffer.from(link.split('#vibe?c=')[1], 'base64url').toString('utf8'));
  expect(JSON.stringify(payload.clauses)).toContain('international_caps');
});

test('a suggestion that is applied really does hold', async ({ page }) => {
  await page.goto('#vibes');
  await page.waitForSelector('#pool-count');
  await page.locator('#stat-metric').selectOption('goals_after_age_30');
  await page.locator('#stat-value').fill('200');
  await page.waitForTimeout(500);

  await page.locator('#stat-suggestion button').click();
  await page.waitForTimeout(500);

  // The suggestion holds: the pool it leaves is over the floor.
  const count = Number(await page.locator('#pool-count strong').innerText());
  expect(count).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#stat-suggestion')).toHaveCount(0);
});

test('a link carrying a broken clause is refused with a message', async ({ page }) => {
  const code = Buffer.from(JSON.stringify({ name: 'x', icon: '⚽', clauses: [null] }), 'utf8').toString('base64url');
  await page.goto(`#vibe?c=${code}`);
  await page.waitForTimeout(600);
  await expect(page.locator('#vibe-error')).toContainText('not a vibe');
  await expect(page.locator('a[href="#vibes"]')).toBeVisible();
});
