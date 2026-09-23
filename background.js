chrome.action.onClicked.addListener(async tab => {
  if (tab.id) await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'ensureBatchHelper') return;
  (async () => {
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab.url?.startsWith('https://erp.lingxing.com/erp/msupply/FBAgenerateInvoice')) throw new Error('请先切换到领星生成发货单页面');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    respond({ ready: true });
  })().catch(error => respond({ error: error.message }));
  return true;
});
