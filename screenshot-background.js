// Capturing is only initiated by Chrome's user-invoked command, never page messages.
(() => {
  const running = new Set();
  const send = (tab, message) => chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  async function current(tab) {
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const window = await chrome.windows.get(tab.windowId);
    if (active?.id !== tab.id || !window.focused) throw new Error('截圖已取消：分頁或視窗已切換，請回到來源網頁再按快捷鍵。');
  }
  async function report(tab, error) {
    const message = error.message || '截圖失敗，請重新整理網頁再試。';
    await chrome.storage.local.set({ lastResult: { ok: false, message, time: Date.now() } }).catch(() => {});
    await chrome.action.setBadgeText({ text: '!' }).catch(() => {});
    await chrome.action.setTitle({ title: `RefClip：${message}` }).catch(() => {});
    if (tab?.id) await send(tab, { type: 'SCREENSHOT_ERROR', message }).catch(() => {});
  }
  chrome.commands.onCommand.addListener((command, commandTab) => {
    if (command !== 'capture-image') return;
    (async () => {
      const tab = commandTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.id || running.has(tab.id)) return;
      running.add(tab.id);
      let prepared = false;
      try {
        const { settings } = await chrome.storage.local.get('settings');
        if (!ShakeSave.settings(settings).enabled) throw new Error('收圖功能已暫停，請先在 RefClip 設定中啟用。');
        if (!/^https?:\/\//i.test(tab.url || '')) throw new Error('請在一般 HTTP／HTTPS 網頁使用截圖；Chrome 設定頁與 PDF 檢視器不支援。');
        await current(tab);
        let ready;
        try { ready = await send(tab, { type: 'SCREENSHOT_PREPARE' }); }
        catch { throw new Error('此頁無法啟動截圖。請重新整理網頁；Chrome 商店與 PDF 檢視器等特殊頁面不支援。'); }
        if (!ready?.ok) throw new Error(ready?.error || '此頁暫時無法截圖，請重新整理網頁。');
        prepared = true;
        await current(tab);
        let image;
        try { image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
        catch { throw new Error('Chrome 無法擷取此頁。請重新載入擴充功能、重新整理網頁，再按快捷鍵；受保護內容或瀏覽器政策可能禁止截圖。'); }
        await current(tab);
        if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,') || image.length > 28_000_000) throw new Error('截圖資料異常或超過 20 MB，請縮小瀏覽器視窗後再試。');
        const shown = await send(tab, { type: 'SCREENSHOT_SHOW', image, viewport: ready.viewport });
        if (!shown?.ok) throw new Error(shown?.error || '截圖已取消，請回到來源網頁再試。');
        await chrome.action.setBadgeText({ text: '' }).catch(() => {});
        await chrome.action.setTitle({ title: 'RefClip 設定' }).catch(() => {});
      } catch (error) { await report(tab, error); }
      finally {
        if (prepared) await send(tab, { type: 'SCREENSHOT_RELEASE' }).catch(() => {});
        running.delete(tab.id);
      }
    })().catch(error => report(null, error));
  });
})();
