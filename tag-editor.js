// A local, closed-shadow editor. User text is only assigned through value/textContent.
globalThis.ShakeSaveTagEditor = class {
  constructor(root, onSave) {
    this.onSave = onSave; this.opened = false; this.busy = false; this.history = {}; this.root = root;
    const style = document.createElement('style');
    style.textContent = `
      .tag-editor{display:none;position:fixed;pointer-events:auto;width:min(360px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;margin:0;padding:0;background:#fafbf7;border:1px solid #ffffffb3;border-radius:20px;box-shadow:0 24px 80px #14241d40,0 3px 12px #14241d20;color:#24382e;font:13px/1.5 system-ui,"Microsoft JhengHei",sans-serif;text-align:left;color-scheme:light;scrollbar-width:thin}
      .tag-editor *{box-sizing:border-box}.tag-heading{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;background:#fafbf7}.tag-brand{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:750;letter-spacing:1.5px}.tag-dot{width:6px;height:6px;border-radius:50%;background:#699979}.tag-heading span:last-child{color:#7a897d;font-size:11px}
      .tag-media{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:96px;padding:12px 12px 10px;background:#e9ece4;background-image:radial-gradient(#9cab971c 1px,transparent 1px);background-size:8px 8px}
      .tag-photo{display:flex;align-items:center;justify-content:center;border-radius:9px;overflow:hidden;box-shadow:0 5px 18px #263b2f26;background:#fff}.tag-thumbnail{display:block;max-width:100%;object-fit:contain}.tag-image-info{font-size:10px;letter-spacing:.5px;color:#71816f}.tag-image-fallback{display:none;font-size:12px;color:#71816f}
      .tag-fields{padding:16px 18px 18px;transform-origin:top;animation:tag-reveal .2s ease-out}.tag-row{display:grid;grid-template-columns:38px minmax(0,1fr);column-gap:10px;align-items:center;margin-bottom:10px}.tag-row label{overflow-wrap:anywhere;min-width:0;font-size:12px;color:#697b6b;font-weight:600}
      .tag-editor input{display:block;width:100%;height:40px;margin:0;padding:9px 11px;border:1px solid #dce4d8;border-radius:9px;background:#f2f5ee;color:#24382e;font:13px/20px system-ui,"Microsoft JhengHei",sans-serif;transition:border-color .15s,background .15s,box-shadow .15s}.tag-editor input::placeholder{color:#b4bdb1;font-size:12px}.tag-editor input:focus{outline:none;border-color:#7d9b7e;background:#fff;box-shadow:0 0 0 3px #5f8c6512}
      .tag-editor button{border:0;border-radius:10px;padding:10px 14px;background:#335d46;color:#fff;font:600 13px/20px system-ui,"Microsoft JhengHei",sans-serif;cursor:pointer;transition:background .15s,box-shadow .15s}.tag-editor button:hover{background:#274b37}.tag-editor :focus-visible{outline:2px solid #82a48a;outline-offset:3px}.tag-editor button:disabled{opacity:.6;cursor:wait}
      .tag-actions{display:flex;gap:8px;margin-top:15px}.tag-save{flex:1;box-shadow:0 3px 8px #335d461a}.tag-editor .tag-cancel{background:#eaf0e5;color:#60725e}.tag-editor .tag-cancel:hover{background:#dee8d8}
      .tag-filename{margin:2px 0 0 48px;color:#8b9889;font-size:11px}.tag-filename summary{cursor:pointer;user-select:none}.tag-preview{margin:8px 0 0;overflow-wrap:anywhere;white-space:pre-wrap;color:#697b6b;font-size:11px}.tag-editor .tag-error{margin:8px 0 0;color:#a44738;font-size:12px}.tag-error:empty{display:none}
      .tag-suggestions{grid-column:2;display:flex;flex-wrap:wrap;gap:5px;padding-top:6px}.tag-suggestions:empty{display:none}.tag-suggestions button{font-size:11px;line-height:18px;padding:3px 9px;background:#e5eddf;color:#4b6951;border:1px solid #d8e4d0;border-radius:6px}.tag-suggestions button:hover,.tag-suggestions button[aria-selected=true]{background:#cddfc4;border-color:#8eaf81}
      @keyframes tag-reveal{from{opacity:0;transform:translateY(-7px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.tag-fields{animation:none}.tag-editor input,.tag-editor button{transition:none}}
    `;
    root.append(style);
    this.form = document.createElement('form'); this.form.className = 'tag-editor';
    this.form.setAttribute('role', 'dialog'); this.form.setAttribute('aria-label', '替圖片加上標籤');
    this.form.innerHTML = `<header class="tag-heading"><b class="tag-brand"><i class="tag-dot"></i>REFCLIP</b><span>圖片標記</span></header>
      <div class="tag-media"><div class="tag-photo"><img class="tag-thumbnail" alt="待儲存圖片"></div><span class="tag-image-fallback">預覽無法載入，仍可嘗試儲存</span><span class="tag-image-info"></span></div>
      <div class="tag-fields">
      <div class="tag-categories"></div>
      <details class="tag-filename"><summary>檔名</summary><p class="tag-preview"></p></details><p class="tag-error" role="status" aria-live="polite"></p>
      <div class="tag-actions"><button type="submit" class="tag-save">儲存圖片</button><button type="button" class="tag-cancel">取消</button></div></div>`;
    root.append(this.form);
    this.fields = []; this.lists = {}; this.schema = ShakeSave.categories(); this.sequence = 0;
    this.preview = this.form.querySelector('.tag-preview'); this.error = this.form.querySelector('.tag-error');
    this.thumbnail = this.form.querySelector('.tag-thumbnail'); this.photo = this.form.querySelector('.tag-photo');
    this.imageInfo = this.form.querySelector('.tag-image-info'); this.imageFallback = this.form.querySelector('.tag-image-fallback');
    this.thumbnail.addEventListener('load', () => { if (this.opened) this.fitImage(); });
    this.thumbnail.addEventListener('error', () => {
      if (!this.opened) return;
      this.photo.style.display = 'none'; this.imageFallback.style.display = 'block'; this.imageInfo.textContent = ''; this.position();
    });
    this.saveButton = this.form.querySelector('.tag-save'); this.cancelButton = this.form.querySelector('.tag-cancel');
    this.cancelButton.addEventListener('click', () => this.close());
    this.form.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    this.form.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); if (this.options?.length) this.clearSuggestions(); else this.close(); }
      if (event.key === 'Tab') {
        this.clearSuggestions();
        const focusable = [...this.fields, ...(this.previewMode === 'hidden' ? [] : [this.form.querySelector('summary')]), this.saveButton, this.cancelButton].filter(el => !el.disabled);
        if (event.shiftKey && event.target === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
        else if (!event.shiftKey && event.target === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
      }
    });
    this.form.querySelector('details').addEventListener('toggle', () => {
      if (this.form.querySelector('details').open) this.motion(this.preview, [{opacity:0,transform:'translateY(-3px)'},{opacity:1,transform:'translateY(0)'}], 140);
    });
  }
  motion(element, frames, duration = 180) {
    if (typeof element.animate !== 'function' || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
    return element.animate(frames, { duration, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'none' });
  }
  renderFields() {
    const container = this.form.querySelector('.tag-categories'); container.replaceChildren();
    this.fields = []; this.lists = {};
    const placeholders = { artist: '繪師名', subjects: '人物 頭', styles: '手繪 水彩', descriptions: '留下一句觀察…' };
    for (const c of this.schema) {
      const row = document.createElement('div'); row.className = 'tag-row';
      const label = document.createElement('label'); label.htmlFor = `shake-tag-${c.id}`; label.textContent = c.label;
      const field = document.createElement('input'); field.id = label.htmlFor; field.name = c.id;
      field.maxLength = 110; field.autocomplete = 'off'; field.placeholder = placeholders[c.id] || (c.kind === 'tags' ? '以空白分隔' : '輸入文字…');
      row.append(label, field);
      const list = document.createElement('div'); list.className = 'tag-suggestions'; list.id = `shake-tags-${c.id}`;
      list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', `${c.label}提示`);
      row.append(list); this.lists[c.id] = list; this.fields.push(field); container.append(row);
      // Render the text visible in the field even during IME composition. Keyboard
      // shortcuts still yield to the IME so Enter can confirm its candidate safely.
      field.addEventListener('input', () => { this.updatePreview(); this.showSuggestions(field); });
      field.addEventListener('compositionstart', () => { this.composing = true; });
      field.addEventListener('compositionupdate', () => queueMicrotask(() => { if (this.opened) this.showSuggestions(field); }));
      field.addEventListener('compositionend', () => { this.composing = false; this.updatePreview(); this.showSuggestions(field); });
      field.addEventListener('focus', () => this.showSuggestions(field));
      field.addEventListener('click', () => this.showSuggestions(field));
      // Keep the list's geometry until the next focus/input or action. Collapsing
      // on blur moves Save/Cancel between pointerdown and click and loses clicks.
      field.addEventListener('keydown', event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (['ArrowDown','ArrowUp'].includes(event.key) && this.options?.length) {
          event.preventDefault(); this.selected = this.selected < 0 ? (event.key === 'ArrowDown' ? 0 : this.options.length - 1) : (this.selected + (event.key === 'ArrowDown' ? 1 : -1) + this.options.length) % this.options.length;
          this.markSelected();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (this.options?.length && this.selected >= 0) this.accept(field, this.options[this.selected]);
          else if (event.ctrlKey || event.metaKey) this.submit();
          else ([...this.fields, this.saveButton][this.fields.indexOf(field) + 1]).focus();
        }
      });
    }
  }
  values() { return Object.fromEntries(this.fields.map(el => [el.name, el.value])); }
  updatePreview() {
    if (this.invalidated) { this.error.textContent = '擴充功能已重新載入，請重新整理此網頁後再收圖。'; return; }
    try { this.preview.textContent = ShakeSave.tagStem(this.values(), this.schema) || '留空：使用原本的時間與來源檔名'; this.error.textContent = ''; }
    catch (error) { this.error.textContent = error.message; this.preview.textContent = ''; }
  }
  clearSuggestions() {
    for (const field of this.fields) {
      this.lists[field.name].replaceChildren();
      field.setAttribute('aria-expanded', 'false'); field.removeAttribute('aria-activedescendant');
    }
    this.options = []; this.selected = -1;
  }
  showSuggestions(field) {
    const previous = this.options?.join('\n'), previousField = this.activeField;
    this.clearSuggestions(); if (this.busy || !this.schema.some(c => c.id === field.name && c.kind === 'tags')) return;
    this.options = ShakeSave.suggestions(this.history, field.name, field.value, field.selectionStart, this.schema); this.selected = -1;
    const list = this.lists[field.name];
    field.setAttribute('role', 'combobox'); field.setAttribute('aria-autocomplete', 'list'); field.setAttribute('aria-controls', list.id);
    field.setAttribute('aria-expanded', String(this.options.length > 0)); this.activeField = field;
    this.options.forEach((value, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1; button.textContent = value;
      button.id = `${list.id}-${index}`; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false');
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => this.accept(field, value)); list.append(button);
    });
    if (this.options.length && (previous !== this.options.join('\n') || previousField !== field)) this.motion(list, [{opacity:0,transform:'translateY(-3px)'},{opacity:1,transform:'translateY(0)'}], 120);
  }
  markSelected() {
    const list = this.lists[this.activeField.name];
    Array.from(list.children).forEach((button, index) => button.setAttribute('aria-selected', String(index === this.selected)));
    this.activeField.setAttribute('aria-activedescendant', `${list.id}-${this.selected}`);
  }
  accept(field, value) {
    const range = ShakeSave.tokenRange(field.value, field.selectionStart);
    field.value = field.value.slice(0, range.start) + value + field.value.slice(range.end);
    field.focus(); field.setSelectionRange(range.start + value.length, range.start + value.length);
    this.clearSuggestions(); this.updatePreview();
  }
  open(url, x, y, settings = {}) {
    this.sequence++; this.closing?.cancel(); this.form.style.pointerEvents = 'auto';
    const config = ShakeSave.settings(settings); this.schema = config.categories; this.previewMode = config.previewMode;
    this.renderFields();
    this.url = url; this.opened = true; this.composing = false; this.invalidated = false; this.history = {}; this.anchor = { x, y }; this.previousFocus = document.activeElement;
    this.saveButton.disabled = false;
    for (const field of this.fields) field.value = '';
    this.clearSuggestions(); this.updatePreview(); this.form.style.display = 'block';
    this.form.querySelector('details').hidden = this.previewMode === 'hidden';
    this.form.querySelector('details').open = this.previewMode === 'open';
    this.form.style.width = `${Math.min(360, innerWidth - 16)}px`;
    this.photo.style.display = 'flex'; this.imageFallback.style.display = 'none'; this.imageInfo.textContent = '';
    this.thumbnail.style.width = 'auto'; this.thumbnail.style.height = '120px';
    this.thumbnail.src = url; this.position();
    this.motion(this.form, [{opacity:0,transform:'translateY(7px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}], 200);
    if (this.thumbnail.complete && this.thumbnail.naturalWidth) this.fitImage();
    this.fields[0].focus();
    this.loadHistory(this.sequence);
  }
  async loadHistory(sequence) {
    try {
      // A reloaded extension can throw synchronously before returning a Promise.
      const { tagHistory } = await chrome.storage.local.get('tagHistory');
      if (sequence !== this.sequence || !this.opened) return;
      this.history = tagHistory && typeof tagHistory === 'object' ? tagHistory : {};
      if (this.opened && this.fields.includes(this.root.activeElement)) this.showSuggestions(this.root.activeElement);
    } catch (error) {
      if (sequence !== this.sequence || !this.opened) return;
      this.invalidated = /context invalidated|extension.*(reload|removed)/i.test(error.message || '');
      this.error.textContent = this.invalidated ? '擴充功能已重新載入，請重新整理此網頁後再收圖。' : '無法讀取先前標籤，仍可手動輸入後儲存。';
      if (this.invalidated) this.saveButton.disabled = true;
    }
  }
  position() {
    this.form.style.maxHeight = `${innerHeight - 16}px`;
    const rect = this.form.getBoundingClientRect();
    const at = ShakeSave.placement(this.anchor.x, this.anchor.y, rect.width, rect.height, innerWidth, innerHeight);
    this.form.style.left = `${at.left}px`; this.form.style.top = `${at.top}px`;
    this.form.style.maxHeight = `${innerHeight - at.top - 8}px`;
  }
  fitImage() {
    const w = this.thumbnail.naturalWidth, h = this.thumbnail.naturalHeight;
    if (!w || !h) return;
    const maxWidth = Math.min(396, innerWidth - 40), maxHeight = Math.max(80, Math.min(210, innerHeight * .28));
    const scale = Math.min(maxWidth / w, maxHeight / h, 1);
    this.thumbnail.style.width = `${Math.round(w * scale)}px`; this.thumbnail.style.height = `${Math.round(h * scale)}px`;
    this.form.style.width = `${Math.min(innerWidth - 16, Math.max(320, Math.round(w * scale) + 24))}px`;
    this.photo.style.display = 'flex'; this.imageFallback.style.display = 'none';
    this.imageInfo.textContent = `${w} × ${h}`; this.position();
    this.motion(this.photo, [{opacity:0},{opacity:1}], 180);
  }
  close() {
    if (this.busy) return;
    this.opened = false; this.url = null; this.clearSuggestions(); this.form.style.pointerEvents = 'none';
    const sequence = this.sequence;
    const hide = () => { if (this.sequence === sequence && !this.opened) { this.form.style.display = 'none'; this.thumbnail.removeAttribute('src'); } };
    this.closing = this.motion(this.form, [{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(4px) scale(.99)'}], 130);
    if (this.closing) this.closing.finished.then(hide, () => {}); else hide();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
  async submit() {
    if (this.busy || !this.opened || this.composing) return;
    if (this.invalidated) { this.error.textContent = '擴充功能已重新載入，請重新整理此網頁後再收圖。'; return; }
    let tags;
    try { tags = ShakeSave.tags(this.values(), this.schema); ShakeSave.tagStem(tags, this.schema); }
    catch (error) { this.error.textContent = error.message; return; }
    this.busy = true; this.clearSuggestions(); this.error.textContent = '';
    for (const el of [...this.fields, this.saveButton, this.cancelButton]) el.disabled = true;
    this.saveButton.textContent = '正在儲存…';
    let saved = false;
    try { saved = await this.onSave(this.url, tags, this.schema); }
    catch (error) { this.error.textContent = error.message || '儲存失敗，請再試一次。'; }
    finally {
      this.busy = false; for (const el of [...this.fields, this.saveButton, this.cancelButton]) el.disabled = false;
      this.saveButton.textContent = '儲存圖片';
    }
    if (saved) this.close();
    else { this.error.textContent ||= '未能儲存，標籤已保留。請依錯誤提示處理後重試。'; this.saveButton.focus(); }
  }
};
