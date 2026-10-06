(() => {
  'use strict';
  const S = globalThis.ShakeSave;
  let config = S.settings(), gesture = null, ui = null, toastTimer, suppressClickUntil = 0, screenshotPreparing = false, screenshotSettings;
  const pending = new Set();
  chrome.storage.local.get('settings').then(r => { config = S.settings(r.settings); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) { config = S.settings(changes.settings.newValue); if (!config.enabled) { cancel(); cancelScreenshot(); } }
  });
  function interfaceUI() {
    if (ui?.host.isConnected) return ui;
    const host = document.createElement('div');
    host.id = 'shake-save-overlay';
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      *{box-sizing:border-box} .zone,.toast,.hint{font:14px/1.5 system-ui,-apple-system,"Microsoft JhengHei",sans-serif;color:#f4f7f6}
      .zone{position:fixed;width:min(264px,calc(100vw - 16px));height:min(154px,calc(100vh - 16px));overflow:hidden;padding:23px;border:2px dashed #96b8aa;border-radius:22px;background:#1c2b2bf2;box-shadow:0 14px 45px #0005;text-align:center;transition:background .12s;display:none}
      .zone.active{display:block;animation:shake-appear .16s ease-out}.zone.over{background:#285f4cf5;border-color:#b5f8d5}
      .symbol{font-size:30px;line-height:1.1;margin-bottom:9px}.title{font-size:17px;font-weight:650}.detail{font-size:12px;color:#bfcdc7;margin-top:6px;overflow-wrap:anywhere}
      .ghost{position:fixed;display:none;width:64px;height:64px;border-radius:10px;object-fit:cover;border:2px solid #e5fff2;box-shadow:0 6px 20px #0005;opacity:.9}
      .hint{position:fixed;display:none;padding:6px 11px;background:#1c2b2bf2;border-radius:9px;white-space:nowrap;font-size:12px}
      .toast{position:fixed;right:24px;bottom:24px;max-width:min(360px,calc(100vw - 32px));padding:13px 19px;background:#203b31;border:1px solid #739b86;border-radius:13px;box-shadow:0 8px 30px #0004;display:none}.toast.error{background:#542d30;border-color:#c77c7c}
      .hint,.toast{animation:shake-appear .16s ease-out}@keyframes shake-appear{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.zone,.hint,.toast{animation:none;transition:none}}
    </style><div class="zone"><div class="symbol">↓</div><div class="title">丟進來，存成參考圖</div><div class="detail"></div></div><img class="ghost" alt=""><div class="hint">左右晃一下 ↔</div><div class="toast" role="status" aria-live="polite"></div>`;
    document.documentElement.append(host);
    ui = { host, zone: root.querySelector('.zone'), detail: root.querySelector('.detail'), ghost: root.querySelector('.ghost'), hint: root.querySelector('.hint'), toast: root.querySelector('.toast') };
    ui.editor = new ShakeSaveTagEditor(root, save);
    ui.shot = new ShakeSaveScreenshot(root, (data, rect) => {
      ui.editor.open(data, rect.left + rect.width / 2, rect.top + rect.height / 2, screenshotSettings || config);
    }, error => toast(error.message, true));
    return ui;
  }
  function toast(text, error = false) {
    const u = interfaceUI(); clearTimeout(toastTimer);
    u.toast.textContent = text; u.toast.classList.toggle('error', error); u.toast.style.display = 'block';
    toastTimer = setTimeout(() => { u.toast.style.display = 'none'; }, error ? 6500 : 3000);
  }
  function source(event) {
    const path = event.composedPath();
    for (const el of path) {
      if (el instanceof HTMLImageElement) return el.currentSrc || el.src;
      if (el instanceof SVGImageElement) return new URL(el.href.baseVal, document.baseURI).href;
    }
    // Simple CSS background images only; canvas and inline vector artwork are not rasterized.
    for (const el of path.slice(0, 3)) {
      if (!(el instanceof Element) || el === document.body || el === document.documentElement) continue;
      const match = getComputedStyle(el).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
      if (match) return new URL(match[1], document.baseURI).href;
    }
    return null;
  }
  function cancel() {
    if (gesture) { clearTimeout(gesture.timer); if (gesture.armed) suppressClickUntil = Date.now() + 400; }
    gesture = null;
    if (ui) { ui.zone.className = 'zone'; ui.ghost.style.display = 'none'; ui.hint.style.display = 'none'; }
  }
  function moveVisual(x, y) {
    const u = interfaceUI();
    u.ghost.style.left = `${Math.min(x + 16, innerWidth - 72)}px`; u.ghost.style.top = `${Math.max(4, Math.min(y + 16, innerHeight - 72))}px`;
    u.hint.style.left = `${Math.max(8, Math.min(x + 16, innerWidth - 155))}px`; u.hint.style.top = `${Math.max(8, y - 38)}px`;
  }
  function inside(x, y) {
    const r = ui.zone.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  window.addEventListener('pointerdown', event => {
    if (ui?.editor.opened || screenshotPreparing || ui?.shot.opened) return;
    if (!event.isTrusted || !config.enabled || event.button !== 0 || event.pointerType !== 'mouse' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    cancel();
    const url = source(event);
    if (!url || !/^(https?:|data:image\/|blob:)/i.test(url)) return;
    const g = gesture = { url, x: event.clientX, y: event.clientY, pointerId: event.pointerId, armed: false, active: false };
    g.timer = setTimeout(() => {
      if (gesture !== g) return;
      g.armed = true; g.shake = new S.Shake(g.x, config.distance);
      const u = interfaceUI(); u.toast.style.display = 'none'; u.hint.style.display = 'block';
      moveVisual(g.x, g.y);
    }, config.holdMs);
  }, true);
  window.addEventListener('pointermove', event => {
    const g = gesture; if (!g || event.pointerId !== g.pointerId) return;
    if (!(event.buttons & 1)) { cancel(); return; }
    if (!g.armed) { if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 8) cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    moveVisual(event.clientX, event.clientY);
    if (!g.active && g.shake.move(event.clientX)) {
      g.active = true; const u = interfaceUI(); u.zone.classList.add('active');
      const at = S.placement(event.clientX, event.clientY, Math.min(264, innerWidth - 16), Math.min(154, innerHeight - 16), innerWidth, innerHeight);
      u.zone.style.left = `${at.left}px`; u.zone.style.top = `${at.top}px`;
      u.detail.textContent = `${config.storageMode === 'native' ? '自訂本機資料夾' : config.folder} · Esc 取消`;
      u.ghost.src = g.url; u.ghost.style.display = 'block'; u.hint.style.display = 'none';
    }
    if (g.active) ui.zone.classList.toggle('over', inside(event.clientX, event.clientY));
  }, { capture: true, passive: false });
  // Before the hold threshold ordinary Chrome dragging is left untouched.
  window.addEventListener('dragstart', event => {
    if (!gesture) return;
    if (gesture.armed) { event.preventDefault(); event.stopImmediatePropagation(); }
    else cancel();
  }, true);
  window.addEventListener('selectstart', event => { if (gesture?.armed) event.preventDefault(); }, true);
  async function pageImage(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { credentials: 'include', signal: controller.signal });
      if (!response.ok) throw new Error('來源頁無法讀取圖片。');
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('image/')) throw new Error('來源回傳的不是圖片。');
      const reader = response.body.getReader(), parts = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > 20 * 1024 * 1024) throw new Error('圖片超過 20 MB，請使用右鍵另存圖片。');
          parts.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('無法讀取圖片資料。'));
        r.readAsDataURL(new Blob(parts, { type }));
      });
    } finally { clearTimeout(timer); }
  }
  async function save(url, tags = {}, categories) {
    const token = crypto.randomUUID(); pending.add(token); toast('正在下載圖片…');
    try {
      if (url.startsWith('blob:')) {
        try { url = await pageImage(url); }
        catch (error) { throw new Error(`暫存圖片無法讀取：${error.message} 請重新整理來源頁。`); }
      } else if (config.storageMode === 'native' && /^https?:/.test(url) && new URL(url).origin === location.origin) {
        // Preserve the page's cookies/referrer where same-origin fetching permits it.
        // If unavailable, let the extension try its own authenticated network context.
        try { url = await pageImage(url); } catch {}
      }
      const result = await chrome.runtime.sendMessage({ type: 'SHAKE_SAVE', url, token, tags, categories });
      if (!result?.ok) throw new Error(result?.error || '無法開始下載。');
      if (result.complete) { pending.delete(token); toast(`✓ ${result.message}`); }
      // Native host replies after commit; downloads mode uses SHAKE_RESULT.
      return true;
    } catch (error) { pending.delete(token); toast(error.message || '下載失敗；重新整理網頁後再試。', true); return false; }
  }
  window.addEventListener('pointerup', event => {
    const g = gesture; if (!g || event.pointerId !== g.pointerId) return;
    const drop = g.active && inside(event.clientX, event.clientY);
    if (g.armed) { event.preventDefault(); event.stopImmediatePropagation(); }
    cancel(); if (drop) ui.editor.open(g.url, event.clientX, event.clientY, config);
  }, true);
  window.addEventListener('click', event => {
    if ((ui?.editor.opened || ui?.shot.opened) && event.composedPath().includes(ui.host)) return;
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture) { cancel(); event.preventDefault(); } }, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  function cancelScreenshot() {
    screenshotPreparing = false; ui?.shot?.close();
    if (ui) ui.host.style.visibility = 'visible';
  }
  for (const type of ['blur','pagehide','resize']) window.addEventListener(type, cancelScreenshot);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelScreenshot(); });
  window.addEventListener('pointerout', event => { if (!event.relatedTarget) cancel(); }, true);
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg?.type?.startsWith('SCREENSHOT_')) {
      if (window.top !== window || sender?.id !== chrome.runtime.id) return;
      if (msg.type === 'SCREENSHOT_PREPARE') {
        if (!config.enabled || document.hidden || ui?.editor.opened || ui?.editor.busy || ui?.shot.opened || screenshotPreparing) {
          respond({ok:false,error:'請先完成或取消目前的收圖表單／截圖，並確認收圖功能已啟用。'}); return;
        }
        cancel(); const u = interfaceUI(); screenshotPreparing = true; screenshotSettings = S.settings(config);
        clearTimeout(toastTimer); u.toast.style.display='none'; u.host.style.visibility='hidden';
        // Let the compositor remove our overlay before Chrome captures the viewport.
        Promise.race([new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))), new Promise(resolve => setTimeout(resolve, 500))]).then(() => {
          respond(screenshotPreparing && !document.hidden ? {ok:true,viewport:{width:innerWidth,height:innerHeight,x:scrollX,y:scrollY}} : {ok:false,error:'截圖已取消，請回到網頁再試。'});
        });
        return true;
      }
      if (msg.type === 'SCREENSHOT_SHOW') {
        if (!config.enabled || !screenshotPreparing || document.hidden || msg.viewport?.width !== innerWidth || msg.viewport?.height !== innerHeight || msg.viewport?.x !== scrollX || msg.viewport?.y !== scrollY) {
          respond({ok:false,error:'截圖已取消：網頁已捲動或大小改變，請再按快捷鍵。'}); return;
        }
        ui.host.style.visibility='visible';
        ui.shot.open(msg.image, msg.viewport).then(() => respond({ok:true}), error => respond({ok:false,error:error.message}));
        return true;
      }
      if (msg.type === 'SCREENSHOT_RELEASE') { screenshotPreparing=false; if(ui) ui.host.style.visibility='visible'; }
      if (msg.type === 'SCREENSHOT_ERROR') { if (screenshotPreparing) cancelScreenshot(); toast(msg.message,true); }
      return;
    }
    if (msg?.type === 'SHAKE_RESULT' && pending.delete(msg.token)) toast(`${msg.ok ? '✓ ' : ''}${msg.message}`, !msg.ok);
  });
})();
