(() => {
  if (globalThis.__lingxingBatchHelperVersion === '0.1.17') return;
  globalThis.__lingxingBatchHelperVersion = '0.1.17';
  let cancelled = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const text = element => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const send = (message, level = 'info', done = false, details = {}) =>
    chrome.runtime.sendMessage({ type: 'batchProgress', message, level, done, ...details });

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

  const orderMatches = (actual, expected, fuzzy) => !!expected &&
    (fuzzy ? actual.startsWith(expected) && actual.length > expected.length &&
      !/[、，,；;|/\s]/.test(actual.slice(expected.length)) : actual === expected);

  function searchSnapshot(dialog, purchaseOrder, fuzzy) {
    const candidates = [...dialog.querySelectorAll('tr')].filter(row => visible(row) && row.querySelector('td') &&
      text(columnCell(row, ['采购单号'])));
    const empty = [...dialog.querySelectorAll('.el-table__empty-text, .vxe-table--empty-content, .vxe-table--empty-placeholder, .el-empty__description, .vxe-table--empty-text')]
      .some(element => visible(element) && /暂无|无数据|没有|空数据/.test(text(element)));
    const matches = candidates.filter(row => orderMatches(text(columnCell(row, ['采购单号'])), purchaseOrder, fuzzy));
    return { candidates, matches, empty, signature: `${candidates.map(text).join('|')}|${empty}` };
  }

  async function closeBatchDialog(dialog) {
    const close = exactButton(dialog, '取消') || dialog.querySelector('.el-dialog__headerbtn, .vxe-modal--close-btn, [aria-label="Close"]');
    if (!close) throw new Error('搜索无匹配结果，但未找到弹窗关闭按钮，已暂停');
    close.click();
    await waitFor(() => !visible(dialog) || dialog.closest('.dialog-fade-leave-active'), 8000, '关闭无匹配结果弹窗超时，已暂停');
  }

  function scopedBatchRows(sku, purchaseOrder, batchNumber, fuzzy = false) {
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
      const totalAvailableCell = columnCell(product, ['可用总出库量']);
      const totalAvailableParts = parts(totalAvailableCell);
      const quantities = parts(columnCell(product, ['批次可用出库量']));
      return numbers.flatMap((part, index) => {
        const number = text(part);
        if (part.querySelector('button') || !number || !orderMatches(text(orders[index]), purchaseOrder, fuzzy) ||
            (batchNumber && number !== batchNumber)) return [];
        // 分仓页面的“可用总出库量”可能是 SKU 级单值，而不是每个批次一行。
        // 只有多个子行时才按批次索引对应；单一子行或纯文本单元格为所有批次共用。
        const availableCell = totalAvailableParts.length > 1
          ? totalAvailableParts[index]
          : (totalAvailableParts[0] || totalAvailableCell);
        return [{ batchNumber: number, purchaseOrder: text(orders[index]), availableCell, quantityCell: quantities[index] }];
      });
    }
    const candidates = [...product.querySelectorAll('tr')];
    // Some layouts put the batch table in the immediately following expanded row.
    const expansion = product.nextElementSibling;
    if (expansion && !exactButton(expansion, '添加指定出库批次')) {
      candidates.push(expansion, ...expansion.querySelectorAll('tr'));
    }
    return [...new Set(candidates)].filter(candidate => visible(candidate) &&
      orderMatches(text(columnCell(candidate, ['采购单号'])), purchaseOrder, fuzzy) &&
      (!batchNumber || text(columnCell(candidate, ['批次号', '批次编号', '库存批次号'])) === batchNumber))
      .map(candidate => ({
        batchNumber: text(columnCell(candidate, ['批次号', '批次编号', '库存批次号'])),
        purchaseOrder: text(columnCell(candidate, ['采购单号'])),
        availableCell: columnCell(candidate, ['可用总出库量']),
        quantityCell: columnCell(candidate, ['出库数量', '出库量', '批次出库量', '批次可用出库量'])
      }));
  }

  async function fillBatchQuantity(sku, purchaseOrder, batchNumber, fuzzy = false) {
    const matches = await waitFor(() => scopedBatchRows(sku, purchaseOrder, batchNumber, fuzzy), 8000,
      `未能定位 SKU“${sku}”的批次“${batchNumber}”，未填写数量`);
    if (matches.length !== 1) throw new Error(`SKU“${sku}”的批次不唯一，未填写数量`);
    const batchRow = matches[0];
    const quantity = availableQuantity(batchRow);
    const quantityCell = batchRow.quantityCell;
    const inputs = [...(quantityCell?.querySelectorAll('input') || [])].filter(input =>
      visible(input) && !input.disabled && !input.readOnly && input.type !== 'checkbox' && input.type !== 'hidden');
    if (quantity === null) throw new Error(`SKU“${sku}”的可用总出库量无法识别，未填写数量`);
    if (inputs.length !== 1) throw new Error(`SKU“${sku}”的出库数量输入框无法唯一识别，未填写数量`);
    setValue(inputs[0], quantity);
    await sleep(120);
    const updated = scopedBatchRows(sku, purchaseOrder, batchNumber, fuzzy);
    const actual = updated.length === 1 && updated[0].quantityCell?.querySelector('input');
    if (!actual || actual.value.trim() === '' || Number(actual.value.replace(/,/g, '')) !== Number(quantity)) {
      throw new Error(`SKU“${sku}”的出库数量写入后核验失败`);
    }
    return quantity;
  }

  function skipPair({ sku, purchaseOrder }, number, total, reason, actualOrders = [], compatible = false) {
    const status = compatible ? 'compatible' : 'unmatched';
    send(`(${number}/${total}) ${compatible ? '待兼容匹配' : '未匹配'}：${sku}，输入采购单号 ${purchaseOrder}，页面采购单号 ${actualOrders.join('、') || '未查到'}，${reason}`,
      compatible ? 'info' : 'error', false, { status, sku, purchaseOrder, actualOrders, reason });
    return { status, sku, purchaseOrder, actualOrders, reason };
  }

  async function processPair(pair, number, total, mode) {
    const { sku, purchaseOrder } = pair;
    const fuzzy = mode === 'compatible';
    send(`(${number}/${total}) 查找 SKU：${sku}`);
    const rows = productRows(sku);
    if (rows.length !== 1) return skipPair(pair, number, total,
      rows.length ? `当前单据有 ${rows.length} 行相同 SKU，无法确定应处理哪一行` : '当前单据未找到 SKU');
    const row = rows[0];
    const existing = scopedBatchRows(sku, purchaseOrder, undefined, fuzzy);
    if (existing.length > 1) return skipPair(pair, number, total,
      `已有 ${existing.length} 条符合条件的批次，无法唯一确定`, [...new Set(existing.map(item => item.purchaseOrder))]);
    if (existing.length === 1) {
      const quantity = await fillBatchQuantity(sku, purchaseOrder, existing[0].batchNumber, fuzzy);
      return { status: 'completed', sku, purchaseOrder, actualOrder: existing[0].purchaseOrder, batchNumber: existing[0].batchNumber, quantity };
    }
    if (!fuzzy) {
      const compatibleExisting = scopedBatchRows(sku, purchaseOrder, undefined, true);
      if (compatibleExisting.length === 1) return skipPair(pair, number, total,
        '已有一条以输入单号开头的更长采购单号，可点击兼容匹配处理', [compatibleExisting[0].purchaseOrder], true);
      if (compatibleExisting.length > 1) return skipPair(pair, number, total,
        `已有 ${compatibleExisting.length} 条以该采购单号开头的批次，无法唯一确定`,
        [...new Set(compatibleExisting.map(item => item.purchaseOrder))]);
    }
    const addButton = exactButton(row, '添加指定出库批次');
    addButton.click();

    const dialog = await waitFor(currentDialog);
    const search = [...dialog.querySelectorAll('input')].find(input => visible(input) && input.placeholder === '搜索内容');
    search.focus();
    setValue(search, purchaseOrder);
    const searchButton = search.parentElement.querySelector('.lx_combo_search');
    if (!searchButton) throw new Error('未找到采购单搜索按钮，已暂停');
    const beforeSearch = searchSnapshot(dialog, purchaseOrder, fuzzy).signature;
    searchButton.click();
    send(`(${number}/${total}) 搜索采购单号：${purchaseOrder}`);

    // 从完整弹窗中读取结果；“暂无数据”可能只是搜索响应到达前的短暂状态。
    let previousResult = beforeSearch, stableSince = Date.now(), sawLoading = false;
    const startedAt = Date.now();
    const result = await waitFor(() => {
      const loading = [...dialog.querySelectorAll('.el-loading-mask, .vxe-loading.is--visible')].some(visible);
      const snapshot = searchSnapshot(dialog, purchaseOrder, fuzzy);
      if (loading) sawLoading = true;
      if (loading || snapshot.signature !== previousResult) { previousResult = snapshot.signature; stableSince = Date.now(); }
      const settled = !loading && Date.now() - stableSince >= 2000 &&
        (sawLoading || snapshot.signature !== beforeSearch || Date.now() - startedAt >= 1500);
      return settled && (snapshot.candidates.length || snapshot.empty) ? snapshot : null;
    }, 8000, `等待采购单号“${purchaseOrder}”的可勾选批次超时，请检查页面结果是否已加载`);
    const resultRows = result.matches;
    if (!resultRows.length) {
      const actualOrders = [...new Set(result.candidates.map(candidate => text(columnCell(candidate, ['采购单号']))))];
      const compatibleRows = fuzzy ? [] : result.candidates.filter(candidate =>
        orderMatches(text(columnCell(candidate, ['采购单号'])), purchaseOrder, true) && checkboxInRow(candidate));
      await closeBatchDialog(dialog);
      if (compatibleRows.length === 1) return skipPair(pair, number, total,
        '搜索到一条以输入单号开头的更长采购单号，可点击兼容匹配处理',
        [text(columnCell(compatibleRows[0], ['采购单号']))], true);
      const reason = compatibleRows.length > 1
        ? `搜索到 ${compatibleRows.length} 条以该采购单号开头的批次，无法唯一确定`
        : '搜索无可匹配批次';
      return skipPair(pair, number, total, reason, actualOrders);
    }
    if (resultRows.length > 1) {
      const actualOrders = [...new Set(resultRows.map(candidate => text(columnCell(candidate, ['采购单号']))))];
      await closeBatchDialog(dialog);
      return skipPair(pair, number, total, `搜索到 ${resultRows.length} 条符合条件的批次，无法唯一确定`, actualOrders);
    }
    const actualOrder = text(columnCell(resultRows[0], ['采购单号']));
    const batchNumber = text(columnCell(resultRows[0], ['批次号', '批次编号', '库存批次号']));
    if (!batchNumber) throw new Error('无法识别选中批次的批次号，已暂停');
    const checkbox = checkboxInRow(resultRows[0]);
    if (!checkbox) {
      await closeBatchDialog(dialog);
      return skipPair(pair, number, total, '符合条件的批次不可勾选', [actualOrder]);
    }
    checkbox.click();
    const confirm = exactButton(dialog, '确定');
    if (!confirm) throw new Error('未找到批次弹窗的“确定”按钮');
    confirm.click();
    await waitFor(() => !visible(dialog) || (dialog.closest('.dialog-fade-leave-active') &&
      scopedBatchRows(sku, purchaseOrder, batchNumber, fuzzy).length === 1), 8000, '批次确认后未关闭，已暂停');

    const quantity = await fillBatchQuantity(sku, purchaseOrder, batchNumber, fuzzy);
    return { status: 'completed', sku, purchaseOrder, actualOrder, batchNumber, quantity };
  }

  async function run(pairs, mode = 'exact') {
    cancelled = false;
    send(`开始${mode === 'compatible' ? '兼容' : '完全'}匹配 ${pairs.length} 条 SKU`);
    const results = [];
    let index = 0;
    let failure = null;
    try {
      for (; index < pairs.length; index++) {
        if (cancelled) throw new Error('已暂停');
        results.push(await processPair(pairs[index], index + 1, pairs.length, mode));
      }
    } catch (error) {
      failure = error;
    }
    const completed = results.filter(item => item.status === 'completed');
    const compatibleRows = results.filter(item => item.status === 'compatible');
    const unmatchedRows = results.filter(item => item.status === 'unmatched');
    if (failure && index < pairs.length) results.push({ status: 'failed', ...pairs[index], reason: failure.message });
    if (failure) for (const pair of pairs.slice(index + 1)) results.push({ status: 'unprocessed', ...pair, reason: '本轮未处理' });
    send(`匹配报告：已匹配 ${completed.length} 条，可兼容匹配 ${compatibleRows.length} 条，无法匹配 ${unmatchedRows.length} 条${failure ? '；已暂停' : ''}`);
    for (const item of results) {
      if (item.status === 'completed') continue;
      send(`SKU ${item.sku}｜${item.status === 'compatible' ? '可兼容匹配' : '未匹配'}｜输入采购单号 ${item.purchaseOrder} → 页面采购单号 ${item.actualOrders?.join('、') || '未查到'}｜${item.reason}`,
        item.status === 'compatible' ? 'info' : 'error');
    }
    if (failure) {
      send(`已暂停：${failure.message}。请核对以上匹配报告`, 'error', true,
        { report: { phase: mode, results, failure: failure.message } });
    } else {
      send(`本轮结束：已匹配 ${completed.length} 条，可兼容匹配 ${compatibleRows.length} 条，无法匹配 ${unmatchedRows.length} 条${mode === 'exact' && compatibleRows.length ? '；可在报告中点击兼容匹配' : ''}`, 'success', true,
        { report: { phase: mode, results, failure: null } });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'getInvoiceSkus') {
      respond({ skus: invoiceSkus() });
    }
    if (message.type === 'startBatchMatching') {
      run(message.pairs, message.mode === 'compatible' ? 'compatible' : 'exact');
      respond({ accepted: true });
    }
    if (message.type === 'stopBatchMatching') {
      cancelled = true;
      respond({ accepted: true });
    }
    return true;
  });
})();
