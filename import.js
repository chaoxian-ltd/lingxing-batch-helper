function parseBatchImport(skuText, orderText) {
  const lines = value => {
    const result = value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim());
    while (result.length && !result.at(-1)) result.pop();
    return result;
  };
  const skus = lines(skuText), orders = lines(orderText);
  if (!skus.length || !orders.length) throw new Error('请在左右两栏分别粘贴 SKU 和采购单号');
  if (skus.length !== orders.length) throw new Error(`左右行数不一致：SKU ${skus.length} 行，采购单号 ${orders.length} 行`);
  const seen = new Set();
  return skus.map((sku, index) => {
    const purchaseOrder = orders[index];
    if (!sku || !purchaseOrder) throw new Error(`第 ${index + 1} 行有空值，请补齐，避免对应错位`);
    if (seen.has(sku)) throw new Error(`SKU 重复：${sku}，请每个 SKU 只保留一行`);
    if (/[\t]/.test(sku + purchaseOrder)) throw new Error(`第 ${index + 1} 行包含多列，请分别粘贴到左右两栏`);
    seen.add(sku);
    return { sku, purchaseOrder };
  });
}
if (typeof module !== 'undefined') module.exports = { parseBatchImport };
