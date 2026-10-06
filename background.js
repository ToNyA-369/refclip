importScripts('shared.js', 'native.js', 'screenshot-background.js');
const S = globalThis.ShakeSave;
const finishing = new Set();
const registrations = new Set();
let historyWrite = Promise.resolve();
function rememberTags(tags, categories) {
  historyWrite = historyWrite.catch(() => {}).then(async () => {
    const { tagHistory } = await chrome.storage.local.get('tagHistory');
    await chrome.storage.local.set({ tagHistory: S.mergeHistory(tagHistory, tags, categories) });
  });
  return historyWrite.catch(() => {});
}

// Always suggest a safe relative name after Chrome knows the response MIME.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) return;
  (async () => {
    // Chrome returns the ID when a download starts, before filename determination completes.
    // Await registration so concurrent requests for the same URL keep their own tags.
    await Promise.allSettled([...registrations]);
    const key = `job:${item.id}`, job = (await chrome.storage.session.get(key))[key];
    const { settings } = await chrome.storage.local.get('settings');
    suggest({ filename: `${job?.folder || S.settings(settings).folder}/${S.taggedFilename(item.url, item.mime, job?.tags || {}, undefined, job?.categories)}`, conflictAction: 'uniquify' });
  })().catch(() => suggest());
  return true;
});

async function finish(id) {
  if (finishing.has(id)) return;
  finishing.add(id);
  try {
    const key = `job:${id}`;
    const job = (await chrome.storage.session.get(key))[key];
    if (!job) return;
    const [item] = await chrome.downloads.search({ id });
    if (!item || item.state === 'in_progress') return;
    const notImage = item.mime && !item.mime.startsWith('image/') && item.mime !== 'application/octet-stream';
    const ok = item.state === 'complete' && !notImage;
    const message = item.state === 'interrupted'
      ? `下載失敗：${item.error || '請查看 Chrome 下載紀錄'}`
      : notImage ? '網站回傳的檔案不是圖片，請檢查下載紀錄。' : '已存入素材資料夾';
    await chrome.storage.local.set({ lastResult: { ok, message, id, time: Date.now() } });
    try { await chrome.tabs.sendMessage(job.tabId, { type: 'SHAKE_RESULT', token: job.token, ok, message }, { frameId: job.frameId }); } catch {}
    await chrome.storage.session.remove(key);
  } finally { finishing.delete(id); }
}
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state || delta.error) finish(delta.id).catch(console.error);
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (['NATIVE_STATUS', 'NATIVE_CHOOSE'].includes(msg?.type)) {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html')) {
      respond({ ok: false, error: '請從擴充功能設定頁操作。' }); return;
    }
    (async () => {
      const client = new NativeClient();
      try { respond(await client.call({ op: msg.type === 'NATIVE_CHOOSE' ? 'choose' : 'status' }, 300000)); }
      finally { client.close(); }
    })().catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (msg?.type !== 'SHAKE_SAVE') return;
  (async () => {
    if (!sender.tab || sender.id !== chrome.runtime.id) throw new Error('無效的收圖來源。');
    if (typeof msg.url !== 'string' || !/^(https?:\/\/|data:image\/)/i.test(msg.url)) throw new Error('暫不支援這種圖片網址。');
    if (msg.url.length > 29_000_000) throw new Error('內嵌圖片過大，請使用右鍵另存圖片。');
    const { settings } = await chrome.storage.local.get('settings');
    const categories = S.categories(msg.categories ?? S.settings(settings).categories);
    const tags = S.tags(msg.tags, categories); S.tagStem(tags, categories);
    if (!S.settings(settings).enabled) throw new Error('收圖功能已暫停。');
    if (S.settings(settings).storageMode === 'native') {
      const result = await saveNative(msg.url, tags, categories);
      const message = `已儲存：${result.path}`;
      // The committed file remains a success even if optional history storage fails.
      await chrome.storage.local.set({ lastResult: { ok: true, message, time: Date.now() } }).catch(() => {});
      await rememberTags(tags, categories);
      respond({ ok: true, complete: true, message }); return;
    }
    const registration = (async () => {
      const folder = S.settings(settings).folder;
      const id = await chrome.downloads.download({ url: msg.url, filename: `${folder}/${S.taggedFilename(msg.url, '', tags, undefined, categories)}`, saveAs: false, conflictAction: 'uniquify' });
      await chrome.storage.session.set({ [`job:${id}`]: { tabId: sender.tab.id, frameId: sender.frameId ?? 0, token: msg.token, folder, tags, categories } });
      return id;
    })();
    registrations.add(registration);
    let id;
    try { id = await registration; } finally { registrations.delete(registration); }
    await rememberTags(tags, categories);
    respond({ ok: true, id });
    // Covers completion before the job was registered.
    await finish(id);
  })().catch(async error => {
    await chrome.storage.local.set({ lastResult: { ok: false, message: error.message, time: Date.now() } }).catch(() => {});
    respond({ ok: false, error: error.message });
  });
  return true;
});
