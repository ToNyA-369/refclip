// No URLs, cookies, or caller-selected directories are sent to the native host.
const NATIVE_LIMIT = 20 * 1024 * 1024;
class NativeClient {
  constructor() {
    this.port = chrome.runtime.connectNative('com.shakesave.host');
    this.pending = null;
    this.port.onMessage.addListener(reply => {
      if (!this.pending) return;
      const { resolve, reject, timer } = this.pending; this.pending = null; clearTimeout(timer);
      if (reply.ok) resolve(reply); else reject(new Error(reply.error || '本機程式拒絕寫入。'));
    });
    this.port.onDisconnect.addListener(() => {
      const detail = chrome.runtime.lastError?.message || '連線已中斷';
      const installer = ShakeSave.platform() === 'mac' ? 'native/macos/install.command' : 'native\\install.cmd';
      this.fail(new Error(`本機程式未連線或已中斷。請執行 ${installer}，確認設定頁 ID，再重試。若剛才正在寫入，先檢查目標資料夾。(${detail})`));
      this.port = null;
    });
  }
  fail(error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; } }
  call(message, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.port || this.pending) return reject(new Error('本機程式連線忙碌或已中斷。'));
      this.pending = { resolve, reject, timer: setTimeout(() => {
        this.fail(new Error('本機程式回應逾時。請檢查資料夾及檔案是否已寫入，再重試。')); this.close();
      }, timeout) };
      try { this.port.postMessage(message); } catch (error) { this.fail(error); }
    });
  }
  close() { this.fail(new Error('本機連線已關閉。')); this.port?.disconnect(); this.port = null; }
}
async function readImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error(`網站拒絕讀取圖片（HTTP ${response.status}）。請確認已登入，或重新整理來源頁。`);
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!mime.startsWith('image/') && mime !== 'application/octet-stream' && mime !== '')
      throw new Error('網站回傳的不是圖片，可能是登入頁或防盜連提示。');
    if (Number(response.headers.get('content-length')) > NATIVE_LIMIT) throw new Error('本機模式圖片上限為 20 MB。');
    const reader = response.body.getReader(), parts = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > NATIVE_LIMIT) throw new Error('本機模式圖片上限為 20 MB。');
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!size) throw new Error('網站回傳空白圖片。');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return { bytes, mime };
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError)
      throw new Error('圖片讀取失敗或逾時。請確認登入狀態、網路或網站防盜連限制；沒有改存其他位置。');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function saveNative(url, tags = {}, categories) {
  const client = new NativeClient();
  try {
    await client.call({ op: 'status' });
    const { bytes, mime } = await readImage(url);
    await client.call({ op: 'begin', size: bytes.length, name: ShakeSave.taggedFilename(url, mime, tags, undefined, categories) });
    for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
      const chunk = bytes.subarray(offset, offset + 192 * 1024); let binary = '';
      for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
      await client.call({ op: 'chunk', data: btoa(binary) });
    }
    return await client.call({ op: 'commit' });
  } finally { client.close(); }
}
