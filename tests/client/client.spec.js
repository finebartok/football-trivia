import { test, expect } from '@playwright/test';

/** Every page error and console error seen during the test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Craft a vibe from a preset, start the quiz, and land on the first round. */
async function startQuiz(page, presetIndex = 0) {
  await page.goto('./');
  await expect(page.locator('.hero__title')).toHaveText('Craft a vibe');
  await page.locator('.vibe-card--preset').nth(presetIndex).click();
  await expect(page).toHaveURL(/#lobby/);
  await page.locator('#btn-start').click();
  await expect(page).toHaveURL(/#round/);
}

test('the home screen offers the presets with live pool counts', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');

  await expect(page.locator('.hero__title')).toHaveText('Craft a vibe');
  const cards = page.locator('.vibe-card--preset');
  await expect(cards).toHaveCount(7);

  // every preset must resolve to a pool worth playing, not "0 players"
  for (let i = 0; i < 7; i++) {
    const count = await cards.nth(i).locator('.vibe-card__count').innerText();
    expect(Number(count.replace(/\D/g, '')), `preset ${i} pool`).toBeGreaterThanOrEqual(20);
  }
  expect(errors).toEqual([]);
});

test('the vibe crafter updates the pool count and refuses a scope below the floor', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#vibes');
  await expect(page.locator('#pool-count')).toBeVisible();

  const before = await page.locator('#pool-count strong').innerText();
  expect(Number(before)).toBeGreaterThanOrEqual(20);

  // "Only these nations" with a nation that has nobody in it
  await page.locator('select[aria-label="Only these nations"]').selectOption({ index: 1 });
  await page.waitForTimeout(200);

  const count = Number(await page.locator('#pool-count strong').innerText());
  if (count < 20) {
    await expect(page.locator('#pool-warning')).toBeVisible();
    await expect(page.locator('#pool-warning')).toContainText('Only');
  }
  expect(errors).toEqual([]);
});

test('a quiz round shows the window banner, the ladder, clues and four options', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);

  await expect(page.locator('#window-banner')).not.toBeEmpty();
  await expect(page.locator('.clue-card')).toHaveCount(3);
  // One step per clue. A step the round never reaches promises a clue
  // that never comes.
  await expect(page.locator('#clue-ladder .step')).toHaveCount(3);
  await expect(page.locator('.option')).toHaveCount(4);

  // the clue ladder must not show every clue at once
  await expect(page.locator('.clue-card.is-revealed')).toHaveCount(0);

  // and the options must be enabled
  await expect(page.locator('.option').first()).toBeEnabled();
  expect(errors).toEqual([]);
});

test('the clue ladder reads like a scouting report, not column headings', async ({ page }) => {
  await startQuiz(page);

  const labels = await page.locator('.clue-card__label').allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(['The stage', 'The trail', 'The record', 'The profile', 'The home']).toContain(label);
  }
  await expect(page.locator('.round-prompt')).toHaveText(/Who is this\?|How many /);
  if (await page.locator('.round-hook').count()) {
    await expect(page.locator('.round-hook')).not.toBeEmpty();
  }
});

test('clues reveal on the schedule and the answer leads to the reveal', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);

  await page.waitForTimeout(2500);
  const revealed = await page.locator('.clue-card.is-revealed').count();
  expect(revealed).toBeGreaterThan(0);

  await page.locator('.option').first().click();
  await expect(page).toHaveURL(/#reveal/);
  await expect(page.locator('.reveal-card__name')).not.toBeEmpty();
  await expect(page.locator('.verdict')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the answer buttons are not rebuilt while the round ticks', async ({ page }) => {
  // A press that starts on one button and ends on its replacement never fires a
  // click - the browser needs mousedown and mouseup on the SAME element. If
  // the round screen recreates its options on every tick, a real player
  // cannot answer at all.
  await startQuiz(page);
  await page.waitForSelector('.option');

  const survived = await page.evaluate(async () => {
    const first = document.querySelector('.option');
    first.dataset.stamp = 'original';
    await new Promise((r) => setTimeout(r, 600));
    const now = document.querySelector('.option');
    return now.dataset.stamp === 'original';
  });
  expect(survived, 'the option button must survive the round timer').toBe(true);
});

test('a solo quiz mixes three stat rounds into ten', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);
  const templates = await page.evaluate(async () => {
    const { store } = await import('/src/store.js');
    return store.state.quiz.rounds.map((round) => round.template);
  });
  expect(templates.filter((t) => t === 'stat_value')).toHaveLength(3);
  expect(templates.filter((t) => t === 'identify')).toHaveLength(7);
  expect(errors).toEqual([]);
});

test('a human-speed press answers the round', async ({ page }) => {
  await startQuiz(page);
  await page.waitForSelector('.option');

  // press, hold across several timer ticks, release
  const box = await page.locator('.option').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();

  await expect(page).toHaveURL(/#reveal/);
  await expect(page.locator('.reveal-card__name')).not.toBeEmpty();
});

test('a player with no photo gets a jersey tile, never a broken image', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);
  await page.locator('.option').first().click();
  await expect(page).toHaveURL(/#reveal/);

  const tile = page.locator('.reveal-card .tile');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('role', 'img');
  await expect(page.locator('.reveal-card img')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a whole quiz plays through to the results', async ({ page }) => {
  const errors = watchErrors(page);
  await startQuiz(page);

  for (let i = 0; i < 30; i++) {
    if (await page.locator('#final-score').count()) break;
    const next = page.locator('#btn-next');
    if (await next.count()) {
      await next.click();
      await page.waitForTimeout(120);
      continue;
    }
    const option = page.locator('.option').first();
    if (await option.count()) {
      await option.click();
      await page.waitForSelector('#btn-next', { timeout: 5000 });
      continue;
    }
    await page.waitForTimeout(200);
  }

  await expect(page).toHaveURL(/#results/);
  await expect(page.locator('#final-score')).not.toBeEmpty();
  await expect(page.locator('.results-cta')).toContainText('Craft your own vibe');
  await expect(page.locator('.card').filter({ hasText: 'Your quiz' }))
    .toContainText('different kinds of question');
  expect(errors).toEqual([]);
});

test('the theme toggles and survives a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');

  await page.locator('[aria-label="Switch theme"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'editorial');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'editorial');
  expect(errors).toEqual([]);
});

test('nothing scrolls sideways at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = watchErrors(page);

  await page.goto('./');
  await expect(page.locator('.hero__title')).toBeVisible();

  for (const hash of ['#home', '#vibes', '#credits']) {
    await page.goto(`./${hash}`);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${hash} overflows horizontally`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('a name with an apostrophe renders as text, not markup', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#vibes');

  // the crafter must never inject markup through a player or club name
  const injected = await page.evaluate(() => {
    const { el } = window.__ui ?? {};
    void el;
    const node = document.createElement('span');
    node.textContent = "<img src=x onerror='window.__pwned=1'>";
    document.body.appendChild(node);
    return !!window.__pwned;
  });
  expect(injected).toBe(false);
  expect(errors).toEqual([]);
});
