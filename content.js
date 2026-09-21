(() => {
  if (globalThis.__lingxingBatchHelperVersion === '0.1.5') return;
  globalThis.__lingxingBatchHelperVersion = '0.1.5';
  let cancelled = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const text = element => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const send = (message, level = 'info', done = false) => chrome.runtime.sendMessage({ type: 'batchProgress', message, level, done });

  async function waitFor(find, timeout = 8000, timeoutMessage = '页面等待超时') {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (cancelled) throw new Error('已暂停');
      const result = find();
      if (Array.isArray(result) ? result.length > 0 : result) return result;
      await sleep(120);
    }
    throw new Error(timeoutMessage);
  }

  function setValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function productRows(sku) {
    return [...document.querySelectorAll('tr')].filter(row => visible(row) &&
      [...(ownCells(row)[1]?.innerText || '').split(/\r?\n/)].some(line => line.trim() === sku) &&
      [...row.querySelectorAll('button')].some(button => text(button) === '添加指定出库批次'));
  }

  function invoiceSkus() {
    const seen = new Set();
    return [...document.querySelectorAll('tr')].flatMap(row => {
      if (![...row.querySelectorAll('button')].some(button => text(button) === '添加指定出库批次')) return [];
      const cells = row.querySelectorAll('td');
      const productCell = cells[1];
      if (!productCell) return [];
      const lines = productCell.innerText.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      const sku = lines.at(-1);
      if (!sku || seen.has(sku)) return [];
      seen.add(sku);
      return [sku];
    });
  }

  function currentDialog() {
    const input = [...document.querySelectorAll('input')].find(item => visible(item) && item.placeholder === '搜索内容' &&
      !item.closest('.dialog-fade-leave-active'));
    const dialog = input?.closest('.el-dialog__wrapper, .el-dialog, [role="dialog"]');
    if (dialog) return dialog;
    for (let container = input?.parentElement; container && container !== document.body; container = container.parentElement) {
      if (text(container).includes('添加指定出库批次') && exactButton(container, '确定') && container.querySelector('tr')) return container;
    }
    return null;
  }

  function exactButton(root, label) {
    return [...root.querySelectorAll('button')].find(button => visible(button) && text(button) === label);
  }

  function checkboxInRow(row) {
    return row.querySelector('.vxe-checkbox--icon.vxe-checkbox--unchecked-icon, input[type="checkbox"]:not(:checked), [role="checkbox"][aria-checked="false"]');
  }

  function ownCells(row) {
    return [...row.querySelectorAll('td, th')].filter(cell => cell.closest('tr') === row);
  }

  function columnCell(row, labels) {
    const table = row.closest('table');
    if (!table) return null;
    let headers = [...table.querySelectorAll('tr')].filter(candidate =>
      candidate.closest('table') === table && candidate.querySelector('th'));
    // VXE / Element tables may render their header and body in separate tables.
    const widget = table.closest('.vxe-table, .el-table');
    if (!headers.length && widget) {
      headers = [...widget.querySelectorAll('tr')].filter(candidate =>
        candidate.closest('.vxe-table, .el-table') === widget && candidate.querySelector('th'));
    }
    for (const header of headers) {
      const cells = ownCells(header);
      const index = cells.findIndex(cell => labels.includes(text(cell).replace(/\s/g, '')));
      if (index !== -1) {
        const colid = cells[index].getAttribute?.('colid');
        return (colid ? ownCells(row).find(cell => cell.getAttribute('colid') === colid) : ownCells(row)[index]) || null;
      }
    }
    return null;
  }

  function availableQuantity(batch) {
    const cell = batch.availableCell;
    if (!cell) return null;
    const raw = text(cell).replace(/,/g, '');
    return /^\d+(?:\.\d+)?$/.test(raw) ? raw : null;
  }

  function scopedBatchRows(sku, purchaseOrder, batchNumber) {
    const products = productRows(sku);
    if (products.length !== 1) throw new Error(`无法唯一定位 SKU“${sku}”，已停止填写`);
    const product = products[0];
    // 真实页面把多个批次纵向排在同一 SKU 的各个单元格中，并不是嵌套 tr。
    // 使用同一列内的批次索引，把批次号、采购单号、可用量和输入框一一对应。
    const batchCell = columnCell(product, ['出库批次号']);
    if (batchCell) {
      const parts = cell => [...(cell?.querySelectorAll('.batch_info_row') || [])];
      const numbers = parts(batchCell);
      const orders = parts(columnCell(product, ['采购单号']));
      const available = parts(columnCell(product, ['可用总出库量']));
      const quantities = parts(columnCell(product, ['批次可用出库量']));
      return numbers.flatMap((part, index) => {
        const number = text(part);
        if (part.querySelector('button') || !number || text(orders[index]) !== purchaseOrder ||
            (batchNumber && number !== batchNumber)) return [];
        return [{ batchNumber: number, availableCell: available[index], quantityCell: quantities[index] }];
      });
    }
    const candidates = [...product.querySelectorAll('tr')];
    // Some layouts put the batch table in the immediately following expanded row.
    const expansion = product.nextElementSibling;
    if (expansion && !exactButton(expansion, '添加指定出库批次')) {
      candidates.push(expansion, ...expansion.querySelectorAll('tr'));
    }
    return [...new Set(candidates)].filter(candidate => visible(candidate) &&
      text(columnCell(candidate, ['采购单号'])) === purchaseOrder &&
      (!batchNumber || text(columnCell(candidate, ['批次号', '批次编号', '库存批次号'])) === batchNumber))
      .map(candidate => ({
        batchNumber: text(columnCell(candidate, ['批次号', '批次编号', '库存批次号'])),
        availableCell: columnCell(candidate, ['可用总出库量']),
        quantityCell: columnCell(candidate, ['出库数量', '出库量', '批次出库量', '批次可用出库量'])
      }));
  }

  async function fillBatchQuantity(sku, purchaseOrder, batchNumber) {
    const matches = await waitFor(() => scopedBatchRows(sku, purchaseOrder, batchNumber), 8000,
      `未能定位 SKU“${sku}”的批次“${batchNumber}”，未填写数量`);
    if (matches.length !== 1) throw new Error(`SKU“${sku}”的批次不唯一，未填写数量`);
    const batchRow = matches[0];
    const quantity = availableQuantity(batchRow);
    const quantityCell = batchRow.quantityCell;
    const inputs = [...(quantityCell?.querySelectorAll('input') || [])].filter(input =>
      visible(input) && !input.disabled && !input.readOnly && input.type !== 'checkbox' && input.type !== 'hidden');
    if (quantity === null || inputs.length !== 1) {
      throw new Error(`SKU“${sku}”的可用总出库量或出库数量列无法唯一识别，未填写数量`);
    }
    setValue(inputs[0], quantity);
    await sleep(120);
    const updated = scopedBatchRows(sku, purchaseOrder, batchNumber);
    const actual = updated.length === 1 && updated[0].quantityCell?.querySelector('input');
    if (!actual || actual.value.trim() === '' || Number(actual.value.replace(/,/g, '')) !== Number(quantity)) {
      throw new Error(`SKU“${sku}”的出库数量写入后核验失败`);
    }
    return quantity;
  }

  async function processPair({ sku, purchaseOrder }, number, total) {
    send(`(${number}/${total}) 查找 SKU：${sku}`);
    const rows = productRows(sku);
    if (!rows.length) throw new Error(`未找到 SKU“${sku}”`);
    if (rows.length > 1) throw new Error(`SKU“${sku}”在当前单据中有 ${rows.length} 行，已暂停`);
    const row = rows[0];
    const existing = scopedBatchRows(sku, purchaseOrder);
    if (existing.length > 1) throw new Error(`SKU“${sku}”已有多个同采购单批次，已暂停`);
    if (existing.length === 1) {
      const quantity = await fillBatchQuantity(sku, purchaseOrder, existing[0].batchNumber);
      send(`(${number}/${total}) 完成：${sku}，批次 ${existing[0].batchNumber}，可用总出库量 ${quantity}，出库数量已核验 ${quantity}`, 'success');
      return;
    }
    const addButton = exactButton(row, '添加指定出库批次');
    addButton.click();

    const dialog = await waitFor(currentDialog);
    const search = [...dialog.querySelectorAll('input')].find(input => visible(input) && input.placeholder === '搜索内容');
    search.focus();
    setValue(search, purchaseOrder);
    const searchButton = search.parentElement.querySelector('.lx_combo_search');
    if (!searchButton) throw new Error('未找到采购单搜索按钮，已暂停');
    searchButton.click();
    send(`(${number}/${total}) 搜索采购单号：${purchaseOrder}`);

    // 从完整弹窗中读取结果，不能从搜索框的局部父容器或整张发货单中查找。
    let previousResult = '', stableSince = Date.now();
    const resultRows = await waitFor(() => {
      const loading = [...dialog.querySelectorAll('.el-loading-mask, .vxe-loading.is--visible')].some(visible);
      const matches = [...dialog.querySelectorAll('tr')].filter(candidate =>
      visible(candidate) && text(columnCell(candidate, ['采购单号'])) === purchaseOrder && checkboxInRow(candidate)
      );
      const signature = matches.map(candidate => text(candidate)).join('|');
      if (loading || signature !== previousResult) { previousResult = signature; stableSince = Date.now(); }
      return !loading && Date.now() - stableSince >= 400 ? matches : null;
    }, 8000, `等待采购单号“${purchaseOrder}”的可勾选批次超时，请检查页面结果是否已加载`);
    if (resultRows.length !== 1) throw new Error(`采购单号“${purchaseOrder}”返回 ${resultRows.length} 条结果，已暂停`);
    const batchNumber = text(columnCell(resultRows[0], ['批次号', '批次编号', '库存批次号']));
    if (!batchNumber) throw new Error('无法识别选中批次的批次号，已暂停');
    const checkbox = checkboxInRow(resultRows[0]);
    if (!checkbox) throw new Error(`采购单号“${purchaseOrder}”没有可勾选的批次`);
    checkbox.click();
    const confirm = exactButton(dialog, '确定');
    if (!confirm) throw new Error('未找到批次弹窗的“确定”按钮');
    confirm.click();
    await waitFor(() => !visible(dialog) || (dialog.closest('.dialog-fade-leave-active') &&
      scopedBatchRows(sku, purchaseOrder, batchNumber).length === 1), 8000, '批次确认后未关闭，已暂停');

    const quantity = await fillBatchQuantity(sku, purchaseOrder, batchNumber);
    send(`(${number}/${total}) 完成：${sku}，批次 ${batchNumber}，可用总出库量 ${quantity}，出库数量已核验 ${quantity}`, 'success');
  }

  async function run(pairs) {
    cancelled = false;
    send(`开始处理 ${pairs.length} 条 SKU`);
    try {
      for (let index = 0; index < pairs.length; index++) {
        if (cancelled) throw new Error('已暂停');
        await processPair(pairs[index], index + 1, pairs.length);
      }
      send('全部匹配完成，请核对后自行提交整张发货单', 'success', true);
    } catch (error) {
      send(`已暂停：${error.message}`, 'error', true);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'getInvoiceSkus') {
      respond({ skus: invoiceSkus() });
    }
    if (message.type === 'startBatchMatching') {
      run(message.pairs);
      respond({ accepted: true });
    }
    if (message.type === 'stopBatchMatching') {
      cancelled = true;
      respond({ accepted: true });
    }
    return true;
  });
})();
