const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:8080');
  await page.click('#btn-create-scope');
  
  const content = await page.content();
  fs.writeFileSync('console_dump.html', content);
  await browser.close();
})();
