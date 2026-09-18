const rowsContainer = document.querySelector('#rows'), loadButton = document.querySelector('#load-skus'), addButton = document.querySelector('#add-row'), selectAll = document.querySelector('#select-all'), bulkOrder = document.querySelector('#bulk-order'), applyBulk = document.querySelector('#apply-bulk'), runButton = document.querySelector('#run'), stopButton = document.querySelector('#stop'), summary = document.querySelector('#summary'), log = document.querySelector('#log');
let rows = [];
const clearButton = document.querySelector('#clear-rows');
clearButton.addEventListener('click', () => {
  if (runButton.disabled) { summary.textContent = '请先暂停匹配，再清空列表'; return; }
  rows = [];
  bulkOrder.value = '';
  renderRows();
  summary.textContent = '列表已清空，可重新读取页面 SKU 或批量导入；领星页面已填内容不受影响';
});
const importDialog = document.querySelector('#import-dialog'), importError = document.querySelector('#import-error');
document.querySelector('#open-import').addEventListener('click', () => { importError.textContent = ''; importDialog.showModal(); });
document.querySelector('#cancel-import').addEventListener('click', () => importDialog.close());
document.querySelector('#confirm-import').addEventListener('click', () => {
  if (runButton.disabled) { importError.textContent = '请先暂停当前匹配，再导入'; return; }
  try {
    const pairs = parseBatchImport(document.querySelector('#import-skus').value, document.querySelector('#import-orders').value);
    for (const pair of pairs) {
      const existing = rows.find(row => row.sku === pair.sku);
      if (existing) Object.assign(existing, pair, { selected: true });
      else rows.push({ ...pair, selected: true });
    }
    renderRows();
    summary.textContent = `已导入 ${pairs.length} 行 SKU 和采购单号；核对后点击“开始匹配”`;
    importDialog.close();
  } catch (error) { importError.textContent = error.message; }
});
const escapeHtml = value => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
async function activeTab() { const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); return tab; }
async function ensurePageScript(tabId) {
  const result = await chrome.runtime.sendMessage({type:'ensureBatchHelper', tabId});
  if (!result?.ready) throw new Error(result?.error || '页面脚本加载失败');
}
function syncSelectAll() { const count=rows.filter(row=>row.selected).length; selectAll.checked=!!rows.length&&count===rows.length; selectAll.indeterminate=count>0&&count<rows.length; document.querySelector('#bulk-section').hidden=!rows.length; document.querySelector('#match-actions').hidden=!rows.length; clearButton.hidden=!rows.length; }
function renderRows() { rowsContainer.replaceChildren(); rows.forEach((row,index)=>{ const el=document.createElement('div'); el.className='mapping-row'; el.innerHTML=`<input type="checkbox" aria-label="选择第 ${index+1} 行" ${row.selected?'checked':''}><input type="text" aria-label="第 ${index+1} 行 SKU" value="${escapeHtml(row.sku)}" placeholder="SKU"><input type="text" aria-label="第 ${index+1} 行采购单号" value="${escapeHtml(row.purchaseOrder)}" placeholder="采购单号"><button class="remove" title="删除这一行">×</button>`; const [checked,sku,order]=el.querySelectorAll('input'); checked.addEventListener('change',()=>{row.selected=checked.checked;syncSelectAll();}); sku.addEventListener('input',()=>row.sku=sku.value.trim()); order.addEventListener('input',()=>row.purchaseOrder=order.value.trim()); el.querySelector('.remove').addEventListener('click',()=>{rows.splice(index,1);renderRows();}); rowsContainer.append(el); }); syncSelectAll(); }
function addLog(message,level='info') { const item=document.createElement('li');item.className=level;item.textContent=message;log.append(item);item.scrollIntoView({block:'nearest'}); }
async function loadPageSkus() { if(runButton.disabled){summary.textContent='请先暂停匹配，再读取页面 SKU';return;}const tab=await activeTab(); if(!tab?.url?.includes('/erp/msupply/FBAgenerateInvoice')) {summary.textContent='请先切换到领星 ERP 的“生成发货单”页面';return;} loadButton.disabled=true; try {await ensurePageScript(tab.id);const result=await chrome.tabs.sendMessage(tab.id,{type:'getInvoiceSkus'});if(!result?.skus?.length){summary.textContent='当前页面未读取到 SKU，请先打开批次分配表格';return;}let added=0;for(const sku of result.skus){if(!rows.some(row=>row.sku===sku)){rows.push({sku,purchaseOrder:'',selected:false});added++;}}renderRows();summary.textContent=`已读取页面 SKU，新增 ${added} 行，已填采购单号保留；填写后点击“开始匹配”`;}catch(error){summary.textContent=error.message;}finally{loadButton.disabled=false;} }
function activePairs() { const invalid=rows.filter(row=>!row.sku&&row.purchaseOrder);if(invalid.length)return{error:'存在填写了采购单号但未填写 SKU 的行'};const pairs=rows.filter(row=>row.sku&&row.purchaseOrder).map(({sku,purchaseOrder})=>({sku,purchaseOrder}));if(!pairs.length)return{error:'请至少为一个 SKU 填写采购单号'};const duplicates=pairs.filter((row,index)=>pairs.findIndex(other=>other.sku===row.sku)!==index);if(duplicates.length)return{error:`待处理数据有重复 SKU：${[...new Set(duplicates.map(row=>row.sku))].join('、')}`};return{pairs}; }
selectAll.addEventListener('change',()=>{rows.forEach(row=>row.selected=selectAll.checked);renderRows();});
applyBulk.addEventListener('click',()=>{const order=bulkOrder.value.trim(),selected=rows.filter(row=>row.selected);if(!order){summary.textContent='请先输入要批量应用的采购单号';return;}if(!selected.length){summary.textContent='请先勾选需要批量填写的 SKU 行';return;}selected.forEach(row=>row.purchaseOrder=order);renderRows();summary.textContent=`已将采购单号应用到 ${selected.length} 个 SKU`;});
addButton.addEventListener('click',()=>{rows.push({sku:'',purchaseOrder:'',selected:false});renderRows();rowsContainer.lastElementChild?.querySelector('input[type=text]')?.focus();});
runButton.addEventListener('click',async()=>{const {pairs,error}=activePairs();log.replaceChildren();if(error){summary.textContent=error;return;}const tab=await activeTab();if(!tab?.url?.includes('/erp/msupply/FBAgenerateInvoice')){summary.textContent='请先切换到领星 ERP 的“生成发货单”页面';return;}summary.textContent=`准备处理 ${pairs.length} 条已填写的 SKU`;runButton.disabled=true;stopButton.disabled=false;try{await ensurePageScript(tab.id);await chrome.tabs.sendMessage(tab.id,{type:'startBatchMatching',pairs});}catch(error){summary.textContent=error.message;runButton.disabled=false;stopButton.disabled=true;}});
stopButton.addEventListener('click',async()=>{const tab=await activeTab();if(tab?.id)chrome.tabs.sendMessage(tab.id,{type:'stopBatchMatching'});addLog('将在当前步骤结束后暂停');stopButton.disabled=true;});
chrome.runtime.onMessage.addListener(message=>{if(message.type!=='batchProgress')return;addLog(message.message,message.level);if(message.done){runButton.disabled=false;stopButton.disabled=true;summary.textContent=message.message;}});loadButton.addEventListener('click',loadPageSkus);renderRows();
