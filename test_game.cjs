const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:8080');
    console.log('Title:', await page.title());
    await browser.close();
  } catch (e) {
    console.error(e);
  }
})();
