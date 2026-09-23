const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main style="width:800px;height:1200px">领星页面</main>');
    await page.addScriptTag({ path: path.join(__dirname, 'report-overlay.js') });
    await page.evaluate(() => {
      window.chosenPairs = null;
      window.__lingxingBatchReportOverlay.show({ failure: null, results: [
        { status: 'completed', sku: 'SKU-A', purchaseOrder: 'PO-A', actualOrder: 'PO-A' },
        { status: 'compatible', sku: 'SKU-B', purchaseOrder: '123', actualOrders: ['123456'] },
        { status: 'compatible', sku: 'SKU-C', purchaseOrder: '789', actualOrders: ['789012'] },
      ] }, pairs => { window.chosenPairs = pairs; });
    });
    const dialog = page.getByRole('dialog', { name: '匹配结果' });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: '兼容匹配（0 条）' }).isDisabled(), true);
    const box = await dialog.boundingBox();
    assert.ok(box && Math.abs(box.x + box.width / 2 - 550) < 2, '结果窗口应位于网页中央');
    await dialog.getByRole('checkbox', { name: '选择兼容匹配 SKU SKU-B' }).check();
    await dialog.getByRole('button', { name: '兼容匹配（1 条）' }).click();
    assert.deepEqual(await page.evaluate(() => window.chosenPairs), [{ sku: 'SKU-B', purchaseOrder: '123' }]);
    assert.equal(await dialog.count(), 0, '选择后应关闭悬浮窗，让网页可以继续操作');
    await page.evaluate(() => {
      window.progress = [];
      window.chrome = { runtime: {
        sendMessage(message) { progress.push(message); },
        onMessage: { addListener(listener) { window.contentListener = listener; } },
      } };
    });
    await page.addScriptTag({ path: path.join(__dirname, 'content.js') });
    assert.deepEqual(await page.evaluate(() => new Promise(resolve => contentListener({
      type: 'startBatchMatching', mode: 'exact', pairs: [{ sku: 'MISSING', purchaseOrder: '123' }],
    }, {}, resolve))), { accepted: true });
    await dialog.getByText('匹配成功 0/1 · 可兼容匹配 0 条 · 完全不能匹配 1 条').waitFor();
    await dialog.getByRole('button', { name: '关闭匹配结果' }).click();
    assert.deepEqual(await page.evaluate(() => new Promise(resolve => contentListener({ type: 'showBatchReport' }, {}, resolve))), { shown: true });
    await dialog.waitFor();
    assert.deepEqual(await page.evaluate(() => new Promise(resolve => contentListener({ type: 'clearBatchReport' }, {}, resolve))), { cleared: true });
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: centered report overlay, per-SKU selection, and content-script report controls');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
