const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8080');
  await page.click('#btn-create-scope');
  const content = await page.content();
  fs.writeFileSync('modal_dump.html', content);
  await browser.close();
  console.log('HTML dumped to modal_dump.html');
})();
