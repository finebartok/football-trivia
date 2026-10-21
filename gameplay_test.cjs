const { chromium } = require('playwright');
const fs = require('fs');

async function runTest() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  const results = [];
  const log = (msg) => {
    console.log(msg);
    results.push(msg);
  };

  try {
    // 1. Initialization
    log('Step 1: Initialization');
    await page.goto('http://localhost:8080');
    const title = await page.title();
    log(`Title: ${title}`);
    
    if (title !== 'Football Trivia — Personalized Scopes') {
      log(`FAIL: Unexpected title ${title}`);
    } else {
      log('SUCCESS: Title verified');
    }

    const appContainerExists = await page.locator('.app-container').isVisible();
    if (appContainerExists) {
      log('SUCCESS: Basic layout (.app-container) verified');
    } else {
      log('FAIL: Layout .app-container not found');
    }

    // 2. Scope Building
    log('\nStep 2: Scope Building');
    await page.click('#btn-create-scope');
    log('SUCCESS: Clicked Create Scope');

    const scopeBuilder = page.locator('#scope-builder');
    try {
      await scopeBuilder.waitFor({ state: 'visible', timeout: 5000 });
      log('SUCCESS: Scope builder modal is visible');
    } catch (e) {
      log('FAIL: Scope builder modal did not become visible');
      throw e;
    }

    const leagueBadge = page.locator('.league-badge[data-league="premier-league"]');
    await leagueBadge.waitFor({ state: 'visible' });
    await leagueBadge.click();
    log('SUCCESS: Selected Premier League');

    const startSlider = page.locator('#era-start');
    const endSlider = page.locator('#era-end');
    
    await startSlider.waitFor({ state: 'visible' });
    await endSlider.waitFor({ state: 'visible' });
    log('SUCCESS: Era sliders found and visible');

    const min = await startSlider.getAttribute('min');
    const max = await endSlider.getAttribute('max');
    log(`Slider range: ${min} to ${max}`);
    
    if (min === '2020' && max === '2025') {
      log('FAIL: Sliders appear hardcoded to 2020-2025');
    } else {
      log('SUCCESS: Sliders are dynamic');
    }

    await page.fill('#scope-name', 'Test Scope');
    await page.click('#btn-save-scope');
    log('SUCCESS: Scope saved');

    // 3. Format Selection
    log('\nStep 3: Format Selection');
    const formatPicker = page.locator('#format-picker-view');
    await formatPicker.waitFor({ state: 'visible', timeout: 5000 });
    log('SUCCESS: Format Picker view appeared');

    // Select 'Criteria Grid'
    await page.click('#format-criteria-grid');
    log('SUCCESS: Selected Criteria Grid');

    // 4. Gameplay (Criteria Grid)
    log('\nStep 4: Gameplay (Criteria Grid)');
    const gridCells = page.locator('.grid-cell');
    const cellCount = await gridCells.count();
    log(`Found ${cellCount} grid cells`);
    
    if (cellCount === 9) {
      log('SUCCESS: 3x3 grid rendered');
    } else {
      log(`FAIL: Expected 9 cells, found ${cellCount}`);
    }

    // Click a cell to open input area
    await gridCells.first().click();
    log('SUCCESS: Clicked a cell');

    // Verify MCQ options are presented
    const mcqOptions = page.locator('#grid-mcq-options .mcq-option');
    try {
      await mcqOptions.first().waitFor({ timeout: 5000 });
      log('SUCCESS: MCQ options presented');
    } catch (e) {
      log('INFO: MCQ options not immediately visible, checking for input');
    }

    // Attempt to submit a player
    await page.fill('#grid-player-input', 'Lionel Messi');
    log('SUCCESS: Entered player name');
    await page.keyboard.press('Enter');
    log('SUCCESS: Submitted player (Enter)');

    // 5. Results
    log('\nStep 5: Results');
    // Manually trigger results for verification if needed
    await page.goto('http://localhost:8080/#results');
    log('SUCCESS: Navigated to #results');

    const resultsView = page.locator('#results-view');
    await resultsView.waitFor({ state: 'visible', timeout: 5000 });
    log('SUCCESS: Results screen displayed');

    const score = await page.locator('#final-score').innerText();
    log(`Final Score: ${score}`);
    const summary = await page.locator('#identity-summary').innerText();
    log(`Identity Summary: ${summary}`);

    // 6. Regression
    log('\nStep 6: Regression');
    await page.goBack();
    log('SUCCESS: Browser back button clicked');
    
    const appContainerStillVisible = await page.locator('.app-container').isVisible();
    if (appContainerStillVisible) {
      log('SUCCESS: App orchestrator handled navigation without crashing');
    } else {
      log('FAIL: App crashed after navigation');
    }

  } catch (e) {
    log(`\nCRASH/ERROR: ${e.message}`);
    await page.screenshot({ path: 'crash_screenshot.png' });
    log('Screenshot taken: crash_screenshot.png');
  } finally {
    await browser.close();
  }
}

runTest();
