import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, ClipboardPaste, PackageOpen, Plus, X, Play, Square, LoaderCircle, Trash2, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import './index.css';

const makeRow = (sku = '', purchaseOrder = '', selected = false) => ({ id: crypto.randomUUID(), sku, purchaseOrder, selected });
async function invoiceTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('https://erp.lingxing.com/erp/msupply/FBAgenerateInvoice')) throw new Error('请先切换到领星的“生成发货单”页面');
  const result = await chrome.runtime.sendMessage({ type: 'ensureBatchHelper', tabId: tab.id });
  if (!result?.ready) throw new Error(result?.error || '无法连接页面，请重新打开插件');
  return tab;
}
function parseImport(left, right) {
  const lines = text => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map(line => line.trim());
  const skus = lines(left), orders = lines(right);
  if (!left.trim() || !right.trim()) throw new Error('请填写左右两栏');
  if (skus.length !== orders.length) throw new Error(`左右行数不一致：SKU ${skus.length} 行，采购单号 ${orders.length} 行`);
  const seen = new Set();
  return skus.map((sku, i) => {
    if (!sku || !orders[i]) throw new Error(`第 ${i + 1} 行有空值，请补齐，避免错位`);
    if ((sku + orders[i]).includes('\t')) throw new Error(`第 ${i + 1} 行含多列，请分别粘贴到左右框`);
    if (seen.has(sku)) throw new Error(`SKU 重复：${sku}`);
    seen.add(sku);
    return makeRow(sku, orders[i], true);
  });
}

function App() {
  const [rows, setRows] = useState([]);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [report, setReport] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [skuText, setSkuText] = useState('');
  const [orderText, setOrderText] = useState('');
  const [importError, setImportError] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkOrder, setBulkOrder] = useState('');
  const targetTab = useRef(null);
  const phase = useRef('exact');
  const logEnd = useRef(null);
  const locked = running || reading || !!report;
  const selected = rows.filter(row => row.selected).length;
  const reportRows = report?.results || [];
  const compatibleRows = reportRows.filter(item => item.status === 'compatible');
  const unmatchedRows = reportRows.filter(item => item.status === 'unmatched');
  const unfinishedRows = reportRows.filter(item => ['failed', 'unprocessed'].includes(item.status));
  const completedRows = reportRows.filter(item => item.status === 'completed');
  const ready = rows.filter(row => row.sku.trim() && row.purchaseOrder.trim()).length;
  const updateRow = (id, changes) => setRows(previous => previous.map(row => row.id === id ? { ...row, ...changes } : row));
  const fillPurchaseOrderBelow = id => {
    const index = rows.findIndex(row => row.id === id);
    if (index < 0 || index === rows.length - 1 || !rows[index].purchaseOrder.trim()) return;
    const purchaseOrder = rows[index].purchaseOrder;
    setRows(previous => {
      const currentIndex = previous.findIndex(row => row.id === id);
      return currentIndex < 0 ? previous : previous.map((row, rowIndex) => rowIndex > currentIndex ? { ...row, purchaseOrder } : row);
    });
    setError('');
    setMessage(`已应用到下面 ${rows.length - index - 1} 行`);
  };

  useEffect(() => {
    const listener = (event, sender) => {
      if (event.type !== 'batchProgress' || sender.tab?.id !== targetTab.current) return;
      setLogs(previous => [...previous, event]);
      if (event.done) {
        setRunning(false); setStopping(false); setMessage(event.message);
        if (event.report) setReport(previous => phase.current === 'compatible' && previous
          ? { phase: 'final', failure: event.report.failure, results: previous.results.map(item =>
              event.report.results.find(updated => updated.sku === item.sku) || item) }
          : event.report);
        if (event.report) setReportOpen(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }); }, [logs]);

  async function readSkus() {
    setReading(true); setError(''); setMessage('');
    try {
      const tab = await invoiceTab();
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'getInvoiceSkus' });
      if (!result?.skus?.length) throw new Error('页面没有可读取的 SKU，请先打开批次分配表格');
      setRows(previous => {
        const known = new Set(previous.map(row => row.sku));
        return [...previous, ...[...new Set(result.skus)].filter(sku => !known.has(sku)).map(sku => makeRow(sku))];
      });
      setMessage(`已读取 ${result.skus.length} 个 SKU，已填采购单号保留`);
    } catch (err) { setError(err.message); }
    finally { setReading(false); }
  }
  function importRows() {
    try {
      const incoming = parseImport(skuText, orderText);
      setRows(previous => {
        const next = previous.map(row => ({ ...row }));
        for (const row of incoming) {
          const index = next.findIndex(item => item.sku === row.sku);
          if (index < 0) next.push(row);
          else next[index] = { ...row, id: next[index].id };
        }
        return next;
      });
      setMessage(`已导入 ${incoming.length} 行，核对后点击“开始匹配”`);
      setError(''); setImportOpen(false);
    } catch (err) { setImportError(err.message); }
  }
  async function start() {
    if (locked) return;
    setError(''); setMessage('');
    const pairs = rows.filter(row => row.purchaseOrder.trim()).map(row => ({ sku: row.sku.trim(), purchaseOrder: row.purchaseOrder.trim() }));
    if (pairs.some(row => !row.sku)) { setError('有采购单号未填写 SKU，请补齐'); return; }
    if (new Set(pairs.map(row => row.sku)).size !== pairs.length) { setError('列表中有重复 SKU，请先处理'); return; }
    if (!pairs.length) return;
    phase.current = 'exact';
    setReport(null); setReportOpen(false); setRunning(true); setLogs([]); setStopping(false);
    try {
      const tab = await invoiceTab();
      targetTab.current = tab.id;
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'startBatchMatching', pairs, mode: 'exact' });
      if (!result?.accepted) throw new Error('页面未接受匹配任务');
    } catch (err) { setError(err.message); setRunning(false); }
  }
  async function matchCompatible() {
    if (running || reading || !report || report.failure) return;
    const pairs = compatibleRows.map(({ sku, purchaseOrder }) => ({ sku, purchaseOrder }));
    if (!pairs.length) return;
    setError(''); setMessage(''); setRunning(true); setStopping(false); setReportOpen(false);
    phase.current = 'compatible';
    try {
      const tab = await invoiceTab();
      targetTab.current = tab.id;
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'startBatchMatching', pairs, mode: 'compatible' });
      if (!result?.accepted) throw new Error('页面未接受兼容匹配任务');
    } catch (err) { setError(err.message); setRunning(false); }
  }
  async function stop() {
    setStopping(true);
    try { await chrome.tabs.sendMessage(targetTab.current, { type: 'stopBatchMatching' }); }
    catch (err) { setError(err.message); setRunning(false); setStopping(false); }
  }

  return <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 p-5">
    <header className="space-y-1"><h1 className="text-xl font-semibold tracking-tight">出库批次助手</h1><p className="text-sm text-muted-foreground">添加 SKU 和采购单号，再匹配对应批次。</p></header>
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" className="h-11" disabled={locked} onClick={readSkus}>{reading ? <LoaderCircle className="animate-spin"/> : <Download/>}读取页面 SKU</Button>
      <Button variant="outline" className="h-11" disabled={locked} onClick={() => { setImportError(''); setImportOpen(true); }}><ClipboardPaste/>批量导入</Button>
    </div>
    {!rows.length ? <section className="flex flex-col items-center rounded-xl border border-dashed px-5 py-12 text-center">
      <div className="mb-4 rounded-xl bg-muted p-3"><PackageOpen className="size-6 text-muted-foreground"/></div>
      <h2 className="text-sm font-medium">选择一种方式添加 SKU</h2>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">从当前页面读取，或粘贴已有清单。<br/>打开助手不会自动读取或匹配。</p>
      <Button variant="link" size="sm" className="mt-3" disabled={locked} onClick={() => setRows([makeRow()])}><Plus/>手动添加一行</Button>
    </section> : <section className="overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="text-xs text-muted-foreground">共 {rows.length} 行 · {ready} 行待匹配</span>
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => { setRows([]); setBulkOrder(''); setError(''); setMessage('列表已清空，领星页面已填内容不受影响'); }}><Trash2 className="size-3.5"/>清空列表</Button>
      </div>
      <div className="grid grid-cols-[20px_minmax(0,1.25fr)_minmax(0,1fr)_24px] items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <Checkbox aria-label="全选以批量填写采购单号" disabled={locked} checked={selected === rows.length ? true : selected ? 'indeterminate' : false} onCheckedChange={value => setRows(previous => previous.map(row => ({ ...row, selected: value === true })))}/><span>SKU</span><span>采购单号</span><span/>
      </div>
      <div className="max-h-[45vh] overflow-y-auto">
        {rows.map((row, index) => <div key={row.id} className="grid grid-cols-[20px_minmax(0,1.25fr)_minmax(0,1fr)_24px] items-center gap-2 border-b px-3 py-2 last:border-0">
          <Checkbox aria-label={`选择第 ${index + 1} 行`} checked={row.selected} disabled={locked} onCheckedChange={selected => updateRow(row.id, { selected: selected === true })}/>
          <Input className="h-8 min-w-0 text-xs md:text-xs" aria-label={`第 ${index + 1} 行 SKU`} title={row.sku} value={row.sku} disabled={locked} placeholder="SKU" onChange={e => updateRow(row.id, { sku: e.target.value })}/>
          <div className="relative min-w-0">
            <Input className="h-8 min-w-0 pr-8 text-xs md:text-xs" aria-label={`第 ${index + 1} 行采购单号`} value={row.purchaseOrder} disabled={locked} placeholder="采购单号" onChange={e => updateRow(row.id, { purchaseOrder: e.target.value })}/>
            {row.purchaseOrder.trim() && index < rows.length - 1 ? <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground" aria-label={`将第 ${index + 1} 行采购单号应用到下面全部行`} title="应用到下面全部行" disabled={locked} onClick={() => fillPurchaseOrderBelow(row.id)}><ArrowDown className="size-3.5"/></Button> : null}
          </div>
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label={`删除第 ${index + 1} 行`} disabled={locked} onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}><X className="size-3.5"/></Button>
        </div>)}
      </div>
      <div className="flex flex-wrap justify-between gap-1 border-t p-2">
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => setRows(previous => [...previous, makeRow()])}><Plus/>添加一行</Button>
        {selected > 0 && <Button variant="secondary" size="sm" disabled={locked} onClick={() => setBulkOpen(true)}>为 {selected} 行填写采购单号</Button>}
      </div>
    </section>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-xs leading-5 text-muted-foreground">{message}</p>}
    {!!rows.length && <div className="space-y-2">
      {running ? <Button className="w-full" variant="secondary" disabled={stopping} onClick={stop}><Square/>{stopping ? '正在暂停…' : '暂停匹配'}</Button> : report ? <Button className="w-full" variant="outline" onClick={() => { setReport(null); setReportOpen(false); setLogs([]); setMessage('可修改列表；修改后请重新开始匹配'); }}>修改列表并重新匹配</Button> : <Button className="w-full" disabled={!ready || reading} onClick={start}><Play/>开始匹配{ready ? `（${ready} 行）` : ''}</Button>}
      <p className="text-center text-xs text-muted-foreground">先完成全部精确匹配，再从报告中选择兼容匹配。</p>
    </div>}
    {report && <Button variant="outline" onClick={() => setReportOpen(true)}>查看匹配报告</Button>}
    {!!logs.length && <section className="space-y-2"><h2 className="text-xs font-medium">执行记录</h2><ol aria-live="polite" className="max-h-40 space-y-1 overflow-auto rounded-lg bg-muted/50 p-3 text-xs leading-5">{logs.map((item, index) => <li key={index} className={item.level === 'error' ? 'text-destructive' : item.level === 'success' ? 'text-green-700' : 'text-muted-foreground'}>{item.message}</li>)}<li ref={logEnd}/></ol></section>}
    <footer className="mt-auto border-t pt-4 text-xs leading-5 text-muted-foreground">仅填写批次与数量，整张发货单由你核对后提交。</footer>
    <Dialog open={reportOpen} onOpenChange={setReportOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>匹配报告</DialogTitle><DialogDescription>请核对结果后，再决定是否处理可兼容匹配的 SKU。</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="font-medium">匹配成功 {completedRows.length}/{reportRows.length} · 可兼容匹配 {compatibleRows.length} 条 · 完全不能匹配 {unmatchedRows.length} 条{unfinishedRows.length ? ` · 处理未完成 ${unfinishedRows.length} 条` : ''}</p>
        {!!compatibleRows.length && <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-900">
          <h3 className="font-medium">可兼容匹配</h3>
          {compatibleRows.map(item => <p key={item.sku} className="break-all text-xs">SKU {item.sku}｜输入 {item.purchaseOrder}｜页面 {item.actualOrders?.join('、')}｜{item.reason}</p>)}
          <Button size="sm" disabled={running || !!report?.failure} onClick={matchCompatible}>兼容匹配（{compatibleRows.length} 条）</Button>
        </div>}
        {!!unmatchedRows.length && <div role="alert" className="space-y-2 rounded-md border border-red-500 bg-red-50 p-3 text-red-800">
          <h3 className="font-medium">完全不能匹配：{unmatchedRows.length} 条</h3>
          {unmatchedRows.map(item => <p key={item.sku} className="break-all text-xs">SKU {item.sku}｜输入 {item.purchaseOrder}｜页面 {item.actualOrders?.join('、') || '未查到'}｜{item.reason}</p>)}
        </div>}
        {!!unfinishedRows.length && <div className="space-y-2 rounded-md border p-3 text-muted-foreground">
          <h3 className="font-medium">处理未完成：{unfinishedRows.length} 条</h3>
          {unfinishedRows.map(item => <p key={item.sku} className="break-all text-xs">SKU {item.sku}｜{item.reason}</p>)}
        </div>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setReportOpen(false)}>关闭</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>批量导入</DialogTitle><DialogDescription>左右每行一一对应。已有 SKU 更新采购单号，新 SKU 添加到列表。</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-2 text-sm font-medium">SKU<Textarea className="mt-2 min-h-60 whitespace-pre text-xs md:text-xs" aria-label="导入 SKU" placeholder="每行一个 SKU" value={skuText} spellCheck={false} onChange={e => setSkuText(e.target.value)}/></label>
        <label className="space-y-2 text-sm font-medium">采购单号<Textarea className="mt-2 min-h-60 whitespace-pre text-xs md:text-xs" aria-label="导入采购单号" placeholder={'每行一个采购单号\n例如：YJYZJXY2082'} value={orderText} spellCheck={false} onChange={e => setOrderText(e.target.value)}/></label>
      </div>
      {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}
      <DialogFooter><Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button><Button onClick={importRows} disabled={locked}>导入到列表</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={bulkOpen} onOpenChange={setBulkOpen}><DialogContent>
      <DialogHeader><DialogTitle>填写采购单号</DialogTitle><DialogDescription>将同一采购单号应用到已勾选的 {selected} 行。</DialogDescription></DialogHeader>
      <Input aria-label="统一采购单号" value={bulkOrder} placeholder="例如：YJYZJXY2082" onChange={e => setBulkOrder(e.target.value)}/>
      <DialogFooter><Button variant="outline" onClick={() => setBulkOpen(false)}>取消</Button><Button disabled={!bulkOrder.trim() || locked} onClick={() => { setRows(previous => previous.map(row => row.selected ? { ...row, purchaseOrder: bulkOrder.trim() } : row)); setBulkOpen(false); }}>应用到已勾选</Button></DialogFooter>
    </DialogContent></Dialog>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
