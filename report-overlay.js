(() => {
  if (globalThis.__lingxingBatchReportOverlay) return;
  let host = null;
  const close = () => { host?.remove(); host = null; };

  function show(report, onMatch) {
    if (!report || !document.body || typeof document.createElement !== 'function') return false;
    close();
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box}.shade{position:absolute;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#171717}
      .panel{width:min(660px,100%);max-height:min(720px,calc(100vh - 32px));overflow:auto;background:white;border-radius:12px;box-shadow:0 18px 60px #0004;padding:20px}
      .head{display:flex;align-items:center;justify-content:space-between;gap:16px}.head h2{margin:0;font-size:18px}.close{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#666}
      .summary{font-weight:600;margin:16px 0}.group{border:1px solid;border-radius:8px;padding:12px;margin:12px 0}.group h3{font-size:14px;margin:0 0 8px}.group p{font-size:12px;margin:6px 0;overflow-wrap:anywhere}
      .compatible{border-color:#f59e0b;background:#fffbeb;color:#78350f}.unmatched{border-color:#ef4444;background:#fef2f2;color:#991b1b}.unfinished{border-color:#d4d4d4;color:#525252}
      .choice{display:flex;align-items:flex-start;gap:8px;font-size:12px;margin:8px 0;cursor:pointer;overflow-wrap:anywhere}.choice input{margin:2px 0 0;flex:none}
      .actions{display:flex;justify-content:flex-end;margin-top:16px}.match{border:0;border-radius:7px;background:#171717;color:white;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer}.match:disabled{opacity:.45;cursor:default}
    `;
    const element = (tag, className, value) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (value) node.textContent = value;
      return node;
    };
    const detail = item => `SKU ${item.sku}｜输入采购单号 ${item.purchaseOrder}｜领星采购单号 ${item.actualOrders?.join('、') || item.actualOrder || '未查到'}`;
    const shade = element('div', 'shade');
    const panel = element('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '匹配结果');
    const head = element('div', 'head');
    head.append(element('h2', '', '匹配结果'));
    const closeButton = element('button', 'close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭匹配结果');
    closeButton.addEventListener('click', close);
    head.append(closeButton);
    panel.append(head);
    const results = report.results;
    const completed = results.filter(item => item.status === 'completed');
    const compatible = results.filter(item => item.status === 'compatible');
    const unmatched = results.filter(item => item.status === 'unmatched');
    const unfinished = results.filter(item => item.status === 'failed' || item.status === 'unprocessed');
    panel.append(element('p', 'summary', `匹配成功 ${completed.length}/${results.length} · 可兼容匹配 ${compatible.length} 条 · 完全不能匹配 ${unmatched.length} 条${unfinished.length ? ` · 处理未完成 ${unfinished.length} 条` : ''}`));
    const chosen = new Set();
    let matchButton;
    if (compatible.length) {
      const group = element('section', 'group compatible');
      group.append(element('h3', '', '可兼容匹配'));
      for (const item of compatible) {
        const label = element('label', 'choice');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = !!report.failure;
        checkbox.setAttribute('aria-label', `选择兼容匹配 SKU ${item.sku}`);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) chosen.add(item.sku);
          else chosen.delete(item.sku);
          matchButton.disabled = !chosen.size;
          matchButton.textContent = `兼容匹配（${chosen.size} 条）`;
        });
        label.append(checkbox, element('span', '', detail(item)));
        group.append(label);
      }
      panel.append(group);
    }
    for (const [items, className, heading] of [[unmatched, 'unmatched', `完全不能匹配：${unmatched.length} 条`], [unfinished, 'unfinished', `处理未完成：${unfinished.length} 条`]]) {
      if (!items.length) continue;
      const group = element('section', `group ${className}`);
      group.append(element('h3', '', heading));
      for (const item of items) group.append(element('p', '', detail(item)));
      panel.append(group);
    }
    if (compatible.length) {
      const actions = element('div', 'actions');
      matchButton = element('button', 'match', '兼容匹配（0 条）');
      matchButton.type = 'button';
      matchButton.disabled = true;
      matchButton.addEventListener('click', () => {
        const pairs = compatible.filter(item => chosen.has(item.sku)).map(({ sku, purchaseOrder }) => ({ sku, purchaseOrder }));
        if (!pairs.length || typeof onMatch !== 'function') return;
        close();
        onMatch(pairs);
      });
      actions.append(matchButton);
      panel.append(actions);
    }
    shade.append(panel);
    shade.addEventListener('click', event => { if (event.target === shade) close(); });
    shadow.append(style, shade);
    return true;
  }

  globalThis.__lingxingBatchReportOverlay = { show, close };
})();
