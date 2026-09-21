const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const iconSvg = await fs.readFile(path.join(root, 'store-assets', 'source', 'icon.svg'), 'utf8');
    for (const size of [16, 32, 48, 128]) {
      const iconPage = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await iconPage.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${iconSvg}</body></html>`);
      await iconPage.screenshot({ path: path.join(root, 'icons', `icon${size}.png`), omitBackground: true });
      await iconPage.close();
    }

    const promoSvg = await fs.readFile(path.join(root, 'store-assets', 'source', 'promo-small.svg'), 'utf8');
    const promoPage = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
    await promoPage.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:440px;height:280px;overflow:hidden}svg{display:block;width:440px;height:280px}</style></head><body>${promoSvg}</body></html>`);
    await promoPage.screenshot({ path: path.join(root, 'store-assets', 'promo-small-440x280.png') });
    await promoPage.screenshot({ path: path.join(root, 'store-assets', 'promo-small-440x280.jpg'), type: 'jpeg', quality: 92 });
    await promoPage.close();

    const marqueeSvg = await fs.readFile(path.join(root, 'store-assets', 'source', 'promo-marquee.svg'), 'utf8');
    const marqueePage = await browser.newPage({ viewport: { width: 1400, height: 560 }, deviceScaleFactor: 1 });
    await marqueePage.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:1400px;height:560px;overflow:hidden}svg{display:block;width:1400px;height:560px}</style></head><body>${marqueeSvg}</body></html>`);
    await marqueePage.screenshot({ path: path.join(root, 'store-assets', 'promo-marquee-1400x560.png') });
    await marqueePage.screenshot({ path: path.join(root, 'store-assets', 'promo-marquee-1400x560.jpg'), type: 'jpeg', quality: 94 });
    await marqueePage.close();

    const panel = await browser.newPage({ viewport: { width: 440, height: 760 }, deviceScaleFactor: 1 });
    await panel.route('https://fixture.local/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(root, 'ui-dist', pathname === '/' ? 'index.html' : pathname);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: await fs.readFile(file) });
    });
    await panel.addInitScript(() => {
      window.chrome = {
        tabs: {
          query: async () => [{ id: 1, url: 'https://erp.lingxing.com/erp/msupply/FBAgenerateInvoice' }],
          sendMessage: async () => ({ accepted: true }),
        },
        runtime: {
          sendMessage: async () => ({ ready: true }),
          onMessage: { addListener() {}, removeListener() {} },
        },
      };
    });
    await panel.goto('https://fixture.local/');
    await panel.getByRole('button', { name: '批量导入', exact: true }).click();
    await panel.getByRole('textbox', { name: '导入 SKU' }).fill('LX-A100-BLACK\nLX-B220-WHITE\nLX-C310-GREY');
    await panel.getByRole('textbox', { name: '导入采购单号' }).fill('PO-20260918-01\nPO-20260918-02\nPO-20260918-03');
    await panel.getByRole('button', { name: '导入到列表' }).click();
    await panel.getByRole('button', { name: /开始匹配/ }).waitFor();
    await panel.screenshot({ path: path.join(root, 'store-assets', 'ui-panel.png') });

    const screenshot = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const panelData = await fs.readFile(path.join(root, 'store-assets', 'ui-panel.png'), 'base64');
    await screenshot.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;color:#111827}
      body{background:linear-gradient(135deg,#eef2ff 0%,#f8fafc 52%,#ede9fe 100%);padding:54px 64px}
      .browser{height:692px;border:1px solid #dbe1ea;border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 28px 70px rgba(49,46,129,.17)}
      .bar{height:54px;background:#f8fafc;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:9px;padding:0 18px}.dot{width:10px;height:10px;border-radius:50%;background:#cbd5e1}.address{margin-left:14px;width:500px;height:30px;border-radius:8px;background:#fff;border:1px solid #e5e7eb;color:#64748b;font-size:12px;display:flex;align-items:center;padding:0 14px}
      .content{height:638px;display:flex}.erp{flex:1;padding:46px 54px;background:#fbfcfe}.eyebrow{font-size:14px;color:#4f46e5;font-weight:700;letter-spacing:.08em}.erp h1{font-size:38px;line-height:1.25;margin:13px 0 15px}.erp p{font-size:17px;line-height:1.8;color:#64748b;margin:0 0 35px}.steps{display:grid;gap:14px}.step{display:flex;gap:14px;align-items:center;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:15px 18px;width:470px}.num{width:30px;height:30px;border-radius:9px;background:#eef2ff;color:#4f46e5;font-weight:800;display:grid;place-items:center}.step b{font-size:14px}.step span{display:block;font-size:12px;color:#64748b;margin-top:2px}
      .side{width:440px;border-left:1px solid #e5e7eb;background:#fff;overflow:hidden}.side img{display:block;width:440px;height:760px;object-fit:cover;object-position:top}
    </style></head><body><div class="browser"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><div class="address">erp.lingxing.com / 生成发货单</div></div><div class="content"><section class="erp"><div class="eyebrow">领星 ERP 效率工具</div><h1>出库批次匹配，<br>从逐行操作变成批量处理</h1><p>读取 SKU，填入采购单号，自动找到对应批次。<br>最终提交仍由你核对确认。</p><div class="steps"><div class="step"><div class="num">1</div><div><b>读取或导入 SKU</b><span>支持从当前页面读取与批量粘贴</span></div></div><div class="step"><div class="num">2</div><div><b>填写采购单号</b><span>多行对应，可一键向下填充</span></div></div><div class="step"><div class="num">3</div><div><b>开始匹配</b><span>批次与数量写入后等待人工确认</span></div></div></div></section><aside class="side"><img src="data:image/png;base64,${panelData}"></aside></div></div></body></html>`);
    await screenshot.screenshot({ path: path.join(root, 'store-assets', 'screenshot-1280x800.png') });
    await screenshot.screenshot({ path: path.join(root, 'store-assets', 'screenshot-1280x800.jpg'), type: 'jpeg', quality: 92 });
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
