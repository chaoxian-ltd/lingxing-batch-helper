const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  // Isolated, headless UI fixture. Never connects to the user's browser or ERP.
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('UI error:', error.message); });
    await page.route('https://fixture.local/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(__dirname, 'ui-dist', pathname === '/' ? 'index.html' : pathname);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: await fs.readFile(file) });
    });
    await page.addInitScript(() => {
      window.testCalls = [];
      window.chrome = {
        tabs: {
          query: async () => { testCalls.push('query'); return [{ id: 1, url: 'https://erp.lingxing.com/erp/msupply/FBAgenerateInvoice' }]; },
          sendMessage: async (id, message) => {
            testCalls.push(message);
            return message.type === 'getInvoiceSkus' ? { skus: ['SKU-A', 'SKU-B'] } : { accepted: true };
          },
        },
        runtime: { sendMessage: async () => ({ ready: true }), onMessage: { addListener(listener) { window.progressListener = listener; }, removeListener() {} } },
      };
    });
    await page.goto('https://fixture.local/');
    await page.getByText('选择一种方式添加 SKU', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => testCalls.length), 0, 'opening must not access the ERP');
    await page.getByRole('button', { name: '批量导入', exact: true }).click();
    await page.getByRole('textbox', { name: '导入 SKU', exact: true }).fill('SKU-A\nSKU-B\nSKU-C');
    await page.getByRole('textbox', { name: '导入采购单号', exact: true }).fill('PO-A');
    await page.getByRole('button', { name: '导入到列表' }).click();
    await page.getByRole('alert').filter({ hasText: '行数不一致' }).waitFor();
    await page.getByRole('textbox', { name: '导入采购单号', exact: true }).fill('PO-A\nPO-B\nPO-C');
    await page.getByRole('button', { name: '导入到列表' }).click();
    await page.getByRole('button', { name: /开始匹配.*3 行/ }).waitFor({ timeout: 5000 }).catch(async error => {
      console.error(await page.locator('body').innerText());
      throw error;
    });
    assert.equal(await page.evaluate(() => testCalls.length), 0, 'import must not start matching');
    assert.equal(await page.getByRole('button', { name: /应用到下面全部行/ }).count(), 2, '最后一行不应显示向下填充按钮');
    const [orderBox, fillBox, removeBox] = await Promise.all([
      page.getByRole('textbox', { name: '第 1 行采购单号' }).boundingBox(),
      page.getByRole('button', { name: '将第 1 行采购单号应用到下面全部行' }).boundingBox(),
      page.getByRole('button', { name: '删除第 1 行' }).boundingBox(),
    ]);
    assert.ok(orderBox && fillBox && removeBox && fillBox.x >= orderBox.x && fillBox.x + fillBox.width <= orderBox.x + orderBox.width && fillBox.x + fillBox.width < removeBox.x, '向下填充按钮应在输入框内且不与删除按钮重叠');
    await page.getByRole('button', { name: '将第 1 行采购单号应用到下面全部行' }).click();
    assert.equal(await page.getByRole('textbox', { name: '第 2 行采购单号' }).inputValue(), 'PO-A');
    assert.equal(await page.getByRole('textbox', { name: '第 3 行采购单号' }).inputValue(), 'PO-A');
    await page.getByRole('status').filter({ hasText: '已应用到下面 2 行' }).waitFor();
    await page.getByRole('textbox', { name: '第 2 行采购单号' }).fill('PO-MIDDLE');
    await page.getByRole('button', { name: '将第 2 行采购单号应用到下面全部行' }).click();
    assert.equal(await page.getByRole('textbox', { name: '第 1 行采购单号' }).inputValue(), 'PO-A', '中间行向下填充不应修改上方行');
    assert.equal(await page.getByRole('textbox', { name: '第 3 行采购单号' }).inputValue(), 'PO-MIDDLE', '已有采购单号应被覆盖');
    await page.getByRole('textbox', { name: '第 2 行采购单号' }).fill('');
    assert.equal(await page.getByRole('button', { name: '将第 2 行采购单号应用到下面全部行' }).count(), 0, '空白行不应显示向下填充按钮');
    await page.getByRole('button', { name: '为 3 行填写采购单号' }).click();
    await page.getByRole('textbox', { name: '统一采购单号' }).fill('PO-SHARED');
    await page.getByRole('button', { name: '应用到已勾选' }).click();
    assert.equal(await page.getByRole('textbox', { name: '第 2 行采购单号' }).inputValue(), 'PO-SHARED');
    await page.getByRole('button', { name: '读取页面 SKU' }).click();
    await page.getByRole('status').filter({ hasText: '已读取' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '第 1 行采购单号' }).inputValue(), 'PO-SHARED');
    await page.getByRole('button', { name: '清空列表' }).click();
    await page.getByText('选择一种方式添加 SKU', { exact: true }).waitFor();
    await page.getByRole('button', { name: '读取页面 SKU' }).click();
    await page.getByRole('textbox', { name: '第 1 行 SKU', exact: true }).waitFor();
    await page.getByRole('textbox', { name: '第 1 行采购单号' }).fill('PO-A');
    await page.getByRole('button', { name: /开始匹配.*1 行/ }).click();
    await page.getByRole('button', { name: '暂停匹配' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '将第 1 行采购单号应用到下面全部行' }).isDisabled(), true, '匹配运行时应禁用向下填充');
    await page.waitForFunction(() => testCalls.some(x => x.type === 'startBatchMatching'));
    assert.deepEqual(await page.evaluate(() => testCalls.find(x => x.type === 'startBatchMatching')), { type: 'startBatchMatching', pairs: [{ sku: 'SKU-A', purchaseOrder: 'PO-A' }], mode: 'exact' });
    await page.evaluate(() => progressListener({
      type: 'batchProgress', message: '精确匹配完成', level: 'success', done: true,
      report: { phase: 'exact', failure: null, results: [{ status: 'compatible', sku: 'SKU-A',
        purchaseOrder: 'PO-A', actualOrders: ['PO-A123'], reason: '可兼容匹配' }] },
    }, { tab: { id: 1 } }));
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click();
    await page.getByRole('button', { name: '修改列表并重新匹配' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '第 1 行采购单号' }).isDisabled(), true, '报告期间应锁定采购单号');
    assert.equal(await page.getByRole('button', { name: '删除第 1 行' }).isDisabled(), true, '报告期间应禁止删除');
    assert.equal(await page.getByRole('button', { name: '清空列表' }).isDisabled(), true, '报告期间应禁止清空');
    assert.equal(await page.getByRole('button', { name: '批量导入' }).isDisabled(), true, '报告期间应禁止导入');
    await page.getByRole('button', { name: '查看匹配报告' }).click();
    assert.match(await page.getByRole('dialog').innerText(), /SKU SKU-A｜输入采购单号 PO-A｜领星采购单号 PO-A123/);
    assert.doesNotMatch(await page.getByRole('dialog').innerText(), /领星采购单号 PO-A123｜可兼容匹配/);
    await page.getByRole('button', { name: '兼容匹配（1 条）' }).click();
    assert.deepEqual(await page.evaluate(() => testCalls.filter(x => x.type === 'startBatchMatching').at(-1)),
      { type: 'startBatchMatching', pairs: [{ sku: 'SKU-A', purchaseOrder: 'PO-A' }], mode: 'compatible' });
    await page.evaluate(() => progressListener({
      type: 'batchProgress', message: '兼容匹配完成', level: 'success', done: true,
      report: { phase: 'compatible', failure: null, results: [{ status: 'unmatched', sku: 'SKU-A',
        purchaseOrder: 'PO-A', actualOrders: ['PO-A123'], reason: '无法唯一确定' }] },
    }, { tab: { id: 1 } }));
    const unmatched = page.getByRole('alert').filter({ hasText: '完全不能匹配：1 条' });
    await unmatched.waitFor();
    await page.getByRole('dialog').getByText('匹配成功 0/1 · 可兼容匹配 0 条 · 完全不能匹配 1 条').waitFor();
    assert.match(await unmatched.innerText(), /SKU SKU-A｜输入采购单号 PO-A｜领星采购单号 PO-A123/);
    assert.doesNotMatch(await unmatched.innerText(), /无法唯一确定/);
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click();
    await page.getByRole('button', { name: '修改列表并重新匹配' }).click();
    assert.equal(await page.getByRole('textbox', { name: '第 1 行采购单号' }).isEnabled(), true, '明确重新编辑后才开放修改');
    assert.equal(await page.getByRole('button', { name: '查看匹配报告' }).count(), 0, '重新编辑时旧报告应失效');
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS: empty startup, explicit read, import validation, downward fill/overwrite/bounds/lock, bulk fill, clear, preserved values, matching payload, 440px layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
