const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fixture.local/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(__dirname, pathname);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: await fs.readFile(file) });
    });
    await page.goto('https://fixture.local/demo-current.html?autorun=1');
    await page.getByRole('status').filter({ hasText: '本轮结束：已匹配 2 条，未匹配 1 条' }).waitFor();
    assert.equal(await page.getByRole('switch', { name: '兼容匹配' }).getAttribute('aria-checked'), 'true');
    assert.match(await page.getByText('执行记录').locator('..').innerText(), /DEMO-SKU-B｜已匹配｜输入采购单号 123｜领星采购单号 123456/);
    assert.deepEqual(errors, []);
    console.log('PASS: 0.1.18 demo, Arco switch, compatible order, sidebar result');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
