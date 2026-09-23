const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fixture.local/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(__dirname, pathname);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: await fs.readFile(file) });
    });
    await page.goto('https://fixture.local/demo.html?autorun=1');
    const dialog = page.getByRole('dialog', { name: '匹配结果' });
    await dialog.getByText('匹配成功 1/4 · 可兼容匹配 2 条 · 完全不能匹配 1 条').waitFor();
    assert.equal(await page.getByRole('region', { name: '匹配结果' }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: '兼容匹配（0 条）' }).isDisabled(), true);
    await page.screenshot({ path: path.join(__dirname, 'demo-report.png'), fullPage: true });

    await dialog.getByRole('checkbox', { name: '选择兼容匹配 SKU DEMO-SKU-B' }).check();
    await dialog.getByRole('button', { name: '兼容匹配（1 条）' }).click();
    await dialog.getByText('匹配成功 2/4 · 可兼容匹配 1 条 · 完全不能匹配 1 条').waitFor();
    assert.match(await dialog.innerText(), /SKU DEMO-SKU-C｜输入采购单号 789｜领星采购单号 789012/);
    await dialog.getByRole('button', { name: '关闭匹配结果' }).click();
    await page.getByRole('button', { name: '查看匹配结果' }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '关闭匹配结果' }).click();

    await page.getByRole('button', { name: '修改列表并重新匹配' }).click();
    await page.getByRole('textbox', { name: '第 2 行采购单号' }).fill('123456');
    await page.getByRole('button', { name: '开始匹配（4 行）' }).click();
    await dialog.getByText('匹配成功 2/4 · 可兼容匹配 1 条 · 完全不能匹配 1 条').waitFor();
    assert.doesNotMatch(await dialog.innerText(), /SKU DEMO-SKU-B｜输入采购单号 123456/);
    assert.deepEqual(errors, []);
    console.log('PASS: centered demo report, selected compatible pass, reopen, and exact rematch');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
