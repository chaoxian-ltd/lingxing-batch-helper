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
  getClientRects() { return [1]; }
  getAttribute(name) { return this[name] || null; }
  matches(selector) { return selector.split(',').some(tag => tag.trim().startsWith('.') ? this.className === tag.trim().slice(1) : tag.trim() === this.tag); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  dispatchEvent() {}
}
class Input extends Element {
  constructor() { super('input'); this.type = 'text'; this._value = ''; }
  get value() { return this._value; }
  set value(value) { this._value = value; }
}
const el = (tag, value = '', children = []) => new Element(tag, value, children);
function fixture(quantities, { expanded = false, quantityHeader = '可用总出库量' } = {}) {
  const inputs = [];
  const rows = quantities.flatMap((quantity, index) => {
    const input = new Input();
    inputs.push(input);
    const table = el('table', '', [
      el('tr', '', ['批次号', '采购单号', '无关数量', '出库数量', quantityHeader].map(label => el('th', label))),
      el('tr', '', [el('td', 'SAME-BATCH'), el('td', 'SAME-PO'), el('td', '999'), el('td', '', [input]), el('td', String(quantity))]),
    ]);
    const product = el('tr', '', [el('td', String(index)), el('td', `商品\nSKU-${index}`),
      el('td', '', [el('button', '添加指定出库批次'), ...(expanded ? [] : [table])])]);
    return expanded ? [product, el('tr', '', [el('td', '', [table])])] : [product];
  });
  const document = el('document', '', [el('table', '', rows)]);
  return { api: load(document), inputs };
}
function load(document) {
  let now = 0;
  const context = vm.createContext({
    document, HTMLInputElement: Input, Event: class {}, getComputedStyle: () => ({ visibility: 'visible' }),
    chrome: { runtime: { sendMessage() {}, onMessage: { addListener() {} } } },
    Date: { now: () => now }, setTimeout: callback => { now += 120; callback(); },
  });
  const source = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.api = { fillBatchQuantity, productRows, waitFor }; })();'), context);
  return context.api;
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
test('empty lists are polled until rows arrive', async () => {
  const { api } = fixture([]);
  let calls = 0;
  await api.waitFor(() => ++calls < 4 ? [] : [1]);
  assert.equal(calls, 4);
});
