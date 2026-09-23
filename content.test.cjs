const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM fixture for testing row ownership, table columns and input writes.
class Element {
  constructor(tag, value = '', children = []) {
    this.tag = tag;
    this.label = value;
    this.children = children;
    for (const child of children) child.parentElement = this;
  }
  get innerText() { return [this.label, ...this.children.map(child => child.innerText)].filter(Boolean).join('\n'); }
  get textContent() { return this.innerText; }
  get nextElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  getClientRects() { return this.hidden ? [] : [1]; }
  getAttribute(name) { return this[name] || null; }
  matches(selector) { return selector.split(',').some(tag => {
    const value = tag.trim();
    return value.startsWith('.')
      ? value.slice(1).split('.').every(name => this.className?.split(/\s+/).includes(name))
      : value === this.tag;
  }); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { this.onClick?.(); }
  focus() {}
  dispatchEvent() {}
}
class Input extends Element {
  constructor() { super('input'); this.type = 'text'; this._value = ''; }
  get value() { return this._value; }
  set value(value) { this._value = value; }
}
const el = (tag, value = '', children = []) => new Element(tag, value, children);
function fixture(quantities, { expanded = false, quantityHeader = '可用总出库量', purchaseOrder = 'SAME-PO' } = {}) {
  const inputs = [];
  const rows = quantities.flatMap((quantity, index) => {
    const input = new Input();
    inputs.push(input);
    const table = el('table', '', [
      el('tr', '', ['批次号', '采购单号', '无关数量', '出库数量', quantityHeader].map(label => el('th', label))),
      el('tr', '', [el('td', 'SAME-BATCH'), el('td', purchaseOrder), el('td', '999'), el('td', '', [input]), el('td', String(quantity))]),
    ]);
    const product = el('tr', '', [el('td', String(index)), el('td', `商品\nSKU-${index}`),
      el('td', '', [el('button', '添加指定出库批次'), ...(expanded ? [] : [table])])]);
    return expanded ? [product, el('tr', '', [el('td', '', [table])])] : [product];
  });
  const document = el('document', '', [el('table', '', rows)]);
  return { api: load(document), inputs, document };
}
function load(document) {
  let now = 0;
  const events = [];
  const context = vm.createContext({
    document, HTMLInputElement: Input, Event: class {}, getComputedStyle: () => ({ visibility: 'visible' }),
    chrome: { runtime: { sendMessage(message) { events.push(message); }, onMessage: { addListener() {} } } },
    Date: { now: () => now }, setTimeout: callback => { now += 120; callback(); },
  });
  const source = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.api = { fillBatchQuantity, productRows, scopedBatchRows, orderMatches, waitFor, run }; })();'), context);
  return { ...context.api, events, now: () => now };
}

test('real VXE layout: split header/body tables and multiple batches inside each SKU cell', async () => {
  const values = [[48, 6], [36, 9], [32, 17]];
  const inputs = values.map(pair => pair.map(() => new Input()));
  const labels = ['图片', '品名/SKU', '出库批次号', '批次可用量', '可用总出库量', '批次可用出库量', '采购单号'];
  const cell = (tag, index, label = '', children = []) => Object.assign(el(tag, label, children), { colid: `column-${index}` });
  const part = (label = '', children = []) => Object.assign(el('div', label, children), { className: 'batch_info_row' });
  const rows = values.map((quantities, index) => el('tr', '', [
    cell('td', 0), cell('td', 1, `商品\nSKU-${index}`),
    cell('td', 2, '', [part('BATCH-A'), part('BATCH-B'), part('', [el('button', '添加指定出库批次')])]),
    cell('td', 3, '', quantities.map(() => part('999')).concat(part())),
    cell('td', 4, '', quantities.map(value => part(String(value))).concat(part())),
    cell('td', 5, '', inputs[index].map(input => part('', [input])).concat(part())),
    cell('td', 6, '', [part('SAME-PO'), part('SAME-PO'), part()]),
  ]));
  const header = el('table', '', [el('tr', '', labels.map((label, index) => cell('th', index, label)))]);
  const body = el('table', '', rows);
  const widget = Object.assign(el('div', '', [header, body]), { className: 'vxe-table' });
  const api = load(el('document', '', [widget]));
  await api.fillBatchQuantity('SKU-1', 'SAME-PO', 'BATCH-B');
  assert.deepEqual(inputs.map(pair => pair.map(input => input.value)), [['', ''], ['', '9'], ['', '']]);
  for (let index = 0; index < values.length; index++) {
    await api.fillBatchQuantity(`SKU-${index}`, 'SAME-PO', 'BATCH-A');
  }
  assert.deepEqual(inputs.map(pair => pair.map(input => input.value)), [['48', ''], ['36', '9'], ['32', '']]);
});

for (const totalLayout of ['plain cell', 'single child row']) {
  test(`warehouse split layout: SKU-level total availability in ${totalLayout} is shared by all batches`, async () => {
    const inputs = [new Input(), new Input()];
    const labels = ['图片', '品名/SKU', '出库批次号', '批次可用量', '可用总出库量', '批次可用出库量', '采购单号'];
    const cell = (tag, index, label = '', children = []) => Object.assign(el(tag, label, children), { colid: `column-${index}` });
    const part = (label = '', children = []) => Object.assign(el('div', label, children), { className: 'batch_info_row' });
    const totalCell = totalLayout === 'plain cell'
      ? cell('td', 4, '27')
      : cell('td', 4, '', [part('27')]);
    const row = el('tr', '', [
      cell('td', 0), cell('td', 1, '商品\nSPLIT-SKU'),
      cell('td', 2, '', [part('BATCH-A'), part('BATCH-B'), part('', [el('button', '添加指定出库批次')])]),
      cell('td', 3, '', [part('5'), part('8'), part()]),
      totalCell,
      cell('td', 5, '', [part('', [inputs[0]]), part('', [inputs[1]]), part()]),
      cell('td', 6, '', [part('SAME-PO'), part('SAME-PO'), part()]),
    ]);
    const header = el('table', '', [el('tr', '', labels.map((label, index) => cell('th', index, label)))]);
    const body = el('table', '', [row]);
    const widget = Object.assign(el('div', '', [header, body]), { className: 'vxe-table' });
    const api = load(el('document', '', [widget]));

    assert.equal(await api.fillBatchQuantity('SPLIT-SKU', 'SAME-PO', 'BATCH-B'), '27');
    assert.deepEqual(inputs.map(input => input.value), ['', '27']);
  });
}

for (const expanded of [false, true]) {
  test(`13 SKUs sharing an order and batch retain their own quantities (expanded=${expanded})`, async () => {
    const quantities = [48, 12, 36, 7, 22, 19, 65, 101, 8, 32, 16, 5, 0];
    const { api, inputs } = fixture(quantities, { expanded });
    assert.equal(api.productRows('SKU-1').length, 1, 'SKU-1 must not match SKU-10/11/12');
    for (let index = 0; index < quantities.length; index++) {
      assert.equal(await api.fillBatchQuantity(`SKU-${index}`, 'SAME-PO', 'SAME-BATCH'), String(quantities[index]));
      assert.deepEqual(inputs.map(input => input.value), quantities.map((value, position) => position <= index ? String(value) : ''));
    }
  });
}
test('missing quantity header stops without writing any input', async () => {
  const { api, inputs } = fixture([48, 12], { quantityHeader: '未知列' });
  await assert.rejects(api.fillBatchQuantity('SKU-1', 'SAME-PO', 'SAME-BATCH'), /可用总出库量无法识别/);
  assert.deepEqual(inputs.map(input => input.value), ['', '']);
});
test('a batch from another SKU must not be used as a fallback', async () => {
  const { api, inputs } = fixture([48, 12]);
  await assert.rejects(api.fillBatchQuantity('SKU-1', 'SAME-PO', 'OTHER-BATCH'), /未能定位/);
  assert.deepEqual(inputs.map(input => input.value), ['', '']);
});
test('fuzzy mode matches a purchase order inside a combined value; exact mode does not', async () => {
  const { api, inputs } = fixture([48], { purchaseOrder: 'PO-A、PO-B' });
  assert.equal(api.scopedBatchRows('SKU-0', 'PO-A').length, 0);
  assert.equal(api.scopedBatchRows('SKU-0', 'PO-A', undefined, true).length, 1);
  assert.equal(await api.fillBatchQuantity('SKU-0', 'PO-A', 'SAME-BATCH', true), '48');
  assert.deepEqual(inputs.map(input => input.value), ['48']);
  assert.equal(api.orderMatches('PO-A、PO-B', 'PO-C', true), false);
  assert.equal(api.orderMatches('PO-A、PO-B', '', true), false);
});
test('multiple matching batches are skipped and reported', async () => {
  const labels = ['图片', '品名/SKU', '出库批次号', '可用总出库量', '批次可用出库量', '采购单号'];
  const cell = (tag, index, label = '', children = []) => Object.assign(el(tag, label, children), { colid: `column-${index}` });
  const part = label => Object.assign(el('div', label), { className: 'batch_info_row' });
  const row = el('tr', '', [
    cell('td', 0), cell('td', 1, '商品\nSKU-A'),
    cell('td', 2, '', [part('BATCH-A'), part('BATCH-B'), Object.assign(el('div', '', [el('button', '添加指定出库批次')]), { className: 'batch_info_row' })]),
    cell('td', 3, '10'), cell('td', 4),
    cell('td', 5, '', [part('PO-A、PO-B'), part('PO-A、PO-C')]),
  ]);
  const header = el('table', '', [el('tr', '', labels.map((label, index) => cell('th', index, label)))]);
  const widget = Object.assign(el('div', '', [header, el('table', '', [row])]), { className: 'vxe-table' });
  const api = load(el('document', '', [widget]));
  assert.equal(api.scopedBatchRows('SKU-A', 'PO-A', undefined, true).length, 2);
  await api.run([{ sku: 'SKU-A', purchaseOrder: 'PO-A' }], 'compatible');
  const skipped = api.events.find(event => event.status === 'unmatched');
  assert.equal(skipped.sku, 'SKU-A');
  assert.match(skipped.reason, /已有 2 条符合条件的批次/);
  assert.ok(api.events.at(-1).message.includes('无法匹配 1 条'));
});
test('exact pass reports compatible candidates; second pass matches only those SKUs', async () => {
  const { api } = fixture([48, 12], { purchaseOrder: 'PO-A、PO-B' });
  await api.run([{ sku: 'SKU-0', purchaseOrder: 'PO-A' }, { sku: 'SKU-1', purchaseOrder: 'PO-A、PO-B' }]);
  const first = api.events.at(-1).report;
  assert.equal(first.phase, 'exact');
  assert.equal(first.results[0].status, 'compatible');
  assert.equal(first.results[1].status, 'completed');
  await api.run([{ sku: 'SKU-0', purchaseOrder: 'PO-A' }], 'compatible');
  const second = api.events.at(-1).report;
  assert.equal(second.phase, 'compatible');
  assert.equal(second.results[0].status, 'completed');
  assert.equal(second.results[0].actualOrder, 'PO-A、PO-B');
  assert.equal(second.results[0].batchNumber, 'SAME-BATCH');
});
test('search result with a combined order is reported for the second pass', async () => {
  const { api, document, inputs } = fixture([10, 12], { purchaseOrder: 'PO-C' });
  const search = new Input();
  search.placeholder = '搜索内容';
  const searchButton = Object.assign(el('button'), { className: 'lx_combo_search' });
  const close = Object.assign(el('button', '取消'), { onClick() { dialog.hidden = true; } });
  const resultTable = el('table', '', [
    el('tr', '', [el('th', '采购单号'), el('th', '批次号'), el('th', '选择')]),
    el('tr', '', [el('td', 'PO-A、PO-B'), el('td', 'BATCH-A'),
      el('td', '', [Object.assign(el('div'), { className: 'vxe-checkbox--icon vxe-checkbox--unchecked-icon' })])]),
  ]);
  const dialog = Object.assign(el('div', '', [el('div', '', [search, searchButton]), resultTable, close]), { className: 'el-dialog' });
  document.children.push(dialog);
  dialog.parentElement = document;
  await api.run([
    { sku: 'SKU-0', purchaseOrder: 'PO-A' },
    { sku: 'SKU-1', purchaseOrder: 'PO-C' },
  ]);
  const messages = api.events.map(event => event.message);
  assert.equal(dialog.hidden, true);
  assert.deepEqual(inputs.map(input => input.value), ['', '12']);
  assert.ok(messages.some(message => message.includes('SKU SKU-0｜可兼容匹配｜输入采购单号 PO-A → 页面采购单号 PO-A、PO-B')));
  assert.equal(api.events.at(-1).report.results[1].status, 'completed');
  assert.ok(messages.some(message => message.includes('已匹配 1 条，可兼容匹配 1 条，无法匹配 0 条')));
  assert.equal(api.events.find(event => event.status === 'compatible').sku, 'SKU-0');
  assert.equal(api.events.find(event => event.status === 'compatible').actualOrders.join('、'), 'PO-A、PO-B');
  assert.equal(api.events.at(-1).done, true);
});
test('multiple dialog matches are skipped and the next SKU continues', async () => {
  const { api, document, inputs } = fixture([10, 12], { purchaseOrder: 'PO-A' });
  const search = new Input();
  search.placeholder = '搜索内容';
  const searchButton = Object.assign(el('button'), { className: 'lx_combo_search' });
  const close = Object.assign(el('button', '取消'), { onClick() { dialog.hidden = true; } });
  const candidate = batch => el('tr', '', [
    el('td', 'PO-X'), el('td', batch),
    el('td', '', [Object.assign(el('div'), { className: 'vxe-checkbox--icon vxe-checkbox--unchecked-icon' })]),
  ]);
  const resultTable = el('table', '', [
    el('tr', '', [el('th', '采购单号'), el('th', '批次号'), el('th', '选择')]),
    candidate('BATCH-1'), candidate('BATCH-2'),
  ]);
  const dialog = Object.assign(el('div', '', [el('div', '', [search, searchButton]), resultTable, close]), { className: 'el-dialog' });
  document.children.push(dialog);
  dialog.parentElement = document;
  await api.run([{ sku: 'SKU-0', purchaseOrder: 'PO-X' }, { sku: 'SKU-1', purchaseOrder: 'PO-A' }]);
  assert.equal(dialog.hidden, true);
  assert.deepEqual(inputs.map(input => input.value), ['', '12']);
  assert.match(api.events.find(event => event.status === 'unmatched').reason, /搜索到 2 条符合条件的批次/);
  assert.ok(api.events.at(-1).message.includes('已匹配 1 条，可兼容匹配 0 条，无法匹配 1 条'));
});
test('a matching but unavailable dialog batch is skipped', async () => {
  const { api, document } = fixture([10], { purchaseOrder: 'PO-A' });
  const search = new Input();
  search.placeholder = '搜索内容';
  const searchButton = Object.assign(el('button'), { className: 'lx_combo_search' });
  const close = Object.assign(el('button', '取消'), { onClick() { dialog.hidden = true; } });
  const resultTable = el('table', '', [
    el('tr', '', [el('th', '采购单号'), el('th', '批次号')]),
    el('tr', '', [el('td', 'PO-X'), el('td', 'BATCH-X')]),
  ]);
  const dialog = Object.assign(el('div', '', [el('div', '', [search, searchButton]), resultTable, close]), { className: 'el-dialog' });
  document.children.push(dialog);
  dialog.parentElement = document;
  await api.run([{ sku: 'SKU-0', purchaseOrder: 'PO-X' }]);
  assert.equal(dialog.hidden, true);
  assert.match(api.events.find(event => event.status === 'unmatched').reason, /不可勾选/);
});
test('explicit empty search state skips without waiting for the timeout', async () => {
  const { api, document } = fixture([10], { purchaseOrder: 'PO-A' });
  const search = new Input();
  search.placeholder = '搜索内容';
  const searchButton = Object.assign(el('button'), { className: 'lx_combo_search' });
  const empty = Object.assign(el('div', '暂无数据'), { className: 'vxe-table--empty-content' });
  const close = Object.assign(el('button', '取消'), { onClick() { dialog.hidden = true; } });
  const dialog = Object.assign(el('div', '', [el('div', '', [search, searchButton]), empty, close]), { className: 'el-dialog' });
  document.children.push(dialog);
  dialog.parentElement = document;
  await api.run([{ sku: 'SKU-0', purchaseOrder: 'PO-X' }]);
  assert.equal(dialog.hidden, true);
  assert.ok(api.events.some(event => event.message.includes('SKU SKU-0｜未匹配｜输入采购单号 PO-X → 页面采购单号 未查到')));
  assert.ok(api.events.at(-1).message.includes('无法匹配 1 条'));
});
test('a temporary empty search state is not treated as the final result', async () => {
  const { api, document } = fixture([10], { purchaseOrder: 'PO-A' });
  const search = new Input();
  search.placeholder = '搜索内容';
  let searched = false;
  const searchButton = Object.assign(el('button'), { className: 'lx_combo_search', onClick() { searched = true; } });
  const empty = Object.assign(el('div', '暂无数据'), { className: 'vxe-table--empty-content',
    getClientRects() { return searched && api.now() < 1200 ? [1] : []; } });
  const resultRow = el('tr', '', [el('td', 'PO-Y'), el('td', 'BATCH-Y')]);
  resultRow.getClientRects = () => searched && api.now() >= 1200 ? [1] : [];
  const table = el('table', '', [el('tr', '', [el('th', '采购单号'), el('th', '批次号')]), resultRow]);
  const close = Object.assign(el('button', '取消'), { onClick() { dialog.hidden = true; } });
  const dialog = Object.assign(el('div', '', [el('div', '', [search, searchButton]), empty, table, close]), { className: 'el-dialog' });
  document.children.push(dialog);
  dialog.parentElement = document;

  await api.run([{ sku: 'SKU-0', purchaseOrder: 'PO-X' }]);
  assert.equal(dialog.hidden, true);
  assert.equal(api.events.at(-1).report.results[0].actualOrders.join('、'), 'PO-Y');
});
test('missing SKU is skipped and later SKUs continue', async () => {
  const { api } = fixture([48], { purchaseOrder: 'PO-A、PO-B' });
  await api.run([
    { sku: 'SKU-0', purchaseOrder: 'PO-A' },
    { sku: 'MISSING', purchaseOrder: 'PO-A' },
    { sku: 'LATER', purchaseOrder: 'PO-A' },
  ], 'compatible');
  const messages = api.events.map(event => event.message);
  assert.equal(api.events.at(-1).report.results[0].status, 'completed');
  assert.ok(messages.some(message => message.includes('SKU MISSING｜未匹配')));
  assert.ok(messages.some(message => message.includes('SKU LATER｜未匹配')));
  assert.equal(api.events.at(-1).level, 'success');
  assert.equal(api.events.at(-1).done, true);
});
test('a technical write failure still pauses and reports later SKUs as unprocessed', async () => {
  const { api } = fixture([48], { quantityHeader: '未知列' });
  await api.run([{ sku: 'SKU-0', purchaseOrder: 'SAME-PO' }, { sku: 'LATER', purchaseOrder: 'SAME-PO' }]);
  const messages = api.events.map(event => event.message);
  assert.ok(messages.some(message => message.includes('SKU SKU-0｜未匹配')));
  assert.ok(messages.some(message => message.includes('SKU LATER｜未匹配')));
  assert.equal(api.events.at(-1).level, 'error');
});
test('empty lists are polled until rows arrive', async () => {
  const { api } = fixture([]);
  let calls = 0;
  await api.waitFor(() => ++calls < 4 ? [] : [1]);
  assert.equal(calls, 4);
});
