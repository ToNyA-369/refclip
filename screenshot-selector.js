// Frozen viewport selection; crops PNG pixels without lossy compression.
globalThis.ShakeSaveScreenshot = class {
  constructor(root, onSelect, onError) {
    this.onSelect = onSelect; this.onError = onError; this.opened = false;
    const style = document.createElement('style');
    style.textContent = `
      .shot{display:none;position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;overflow:hidden;color-scheme:light;font:13px/1.5 system-ui,"Microsoft JhengHei",sans-serif;user-select:none}
      .shot-image{display:block;position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.shot-shade{position:absolute;inset:0;background:#10201866;pointer-events:none}.shot-selection{display:none;position:absolute;border:1px solid #fff;box-shadow:0 0 0 1px #315e49,0 0 0 100vmax #10201866;pointer-events:none}
      .shot-bar{position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;width:max-content;max-width:calc(100% - 24px);padding:8px 10px;border:1px solid #fff9;border-radius:12px;background:#fafbf7;box-shadow:0 6px 25px #14241d30;color:#335d46;cursor:default;animation:shot-in .16s ease-out}.shot-bar span{padding:0 8px}.shot button{border:0;border-radius:7px;background:#e3eae2;color:#315e49;font:inherit;padding:6px 10px;cursor:pointer}.shot button:hover{background:#d6e1d5}.shot button:focus-visible{outline:2px solid #315e49;outline-offset:2px}.shot button:disabled{opacity:.5}.shot-size{position:absolute;display:none;padding:3px 7px;border-radius:5px;background:#fafbf7;color:#335d46;font-size:11px;pointer-events:none}
      @keyframes shot-in{from{opacity:0;translate:0 -4px}to{opacity:1;translate:0 0}}@media(prefers-reduced-motion:reduce){.shot-bar{animation:none}}@media(max-width:480px){.shot-bar{flex-wrap:wrap;justify-content:center}.shot-bar span{width:100%;text-align:center}}
    `;
    root.append(style);
    this.layer = document.createElement('div'); this.layer.className = 'shot';
    this.layer.setAttribute('role','dialog'); this.layer.setAttribute('aria-label','框選網頁截圖');
    this.layer.innerHTML = `<img class="shot-image" alt="截圖畫面"><div class="shot-shade"></div><div class="shot-selection"></div><div class="shot-size"></div><div class="shot-bar"><span class="shot-info" role="status">拖曳框選 · Esc 取消</span><button type="button" class="shot-full">整個可見區域</button><button type="button" class="shot-cancel">取消</button></div>`;
    root.append(this.layer);
    this.image = this.layer.querySelector('.shot-image'); this.shade = this.layer.querySelector('.shot-shade');
    this.selection = this.layer.querySelector('.shot-selection'); this.size = this.layer.querySelector('.shot-size');
    this.info = this.layer.querySelector('.shot-info');
    this.full = this.layer.querySelector('.shot-full'); this.cancel = this.layer.querySelector('.shot-cancel');
    this.full.addEventListener('click', () => this.finish({left:0,top:0,width:this.viewport.width,height:this.viewport.height}));
    this.cancel.addEventListener('click', () => this.close());
    this.layer.addEventListener('pointerdown', event => {
      if (event.composedPath().some(node => node.classList?.contains('shot-bar')) || event.button !== 0 || this.busy) return;
      event.preventDefault(); event.stopPropagation();
      this.start = this.point(event); this.pointer = event.pointerId; this.layer.setPointerCapture(event.pointerId); this.draw(this.start);
    });
    this.layer.addEventListener('pointermove', event => { if (this.start && event.pointerId === this.pointer) this.draw(this.point(event)); });
    this.layer.addEventListener('pointerup', event => {
      if (!this.start || event.pointerId !== this.pointer) return;
      event.preventDefault(); event.stopPropagation(); this.draw(this.point(event));
      this.start = null;
      if (this.rect.width < 3 || this.rect.height < 3) { this.selection.style.display='none'; this.shade.style.display='block'; this.size.style.display='none'; return; }
      this.finish(this.rect);
    });
    this.layer.addEventListener('pointercancel', () => this.close());
    this.layer.addEventListener('wheel', event => event.preventDefault(), {passive:false});
    this.layer.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      else if (event.key === 'Tab') {
        if (event.shiftKey && event.target === this.full) { event.preventDefault(); this.cancel.focus(); }
        else if (!event.shiftKey && event.target === this.cancel) { event.preventDefault(); this.full.focus(); }
      } else if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key) && event.target !== this.full && event.target !== this.cancel) event.preventDefault();
    });
  }
  point(event) { return {x:Math.max(0,Math.min(this.viewport.width,event.clientX)),y:Math.max(0,Math.min(this.viewport.height,event.clientY))}; }
  draw(point) {
    this.rect = {left:Math.min(this.start.x,point.x),top:Math.min(this.start.y,point.y),width:Math.abs(point.x-this.start.x),height:Math.abs(point.y-this.start.y)};
    Object.assign(this.selection.style,{display:'block',left:`${this.rect.left}px`,top:`${this.rect.top}px`,width:`${this.rect.width}px`,height:`${this.rect.height}px`});
    this.shade.style.display='none';
    this.size.textContent=`${Math.round(this.rect.width*this.image.naturalWidth/this.viewport.width)} × ${Math.round(this.rect.height*this.image.naturalHeight/this.viewport.height)}`;
    Object.assign(this.size.style,{display:'block',left:`${Math.max(8,Math.min(point.x+12,this.viewport.width-100))}px`,top:`${Math.max(8,Math.min(point.y+12,this.viewport.height-32))}px`});
  }
  async open(data, viewport) {
    if (this.opened) throw new Error('請先完成或取消目前的截圖。');
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length>28_000_000) throw new Error('截圖資料格式不正確或過大，請再試一次。');
    this.viewport = viewport; this.opened = true; this.busy = true; this.previousFocus = document.activeElement;
    try {
      this.image.src = data; await this.image.decode();
      if (!this.opened || document.hidden || innerWidth !== viewport.width || innerHeight !== viewport.height) throw new Error('截圖已取消：頁面大小或狀態已改變，請再按快捷鍵。');
      if (!this.image.naturalWidth || !this.image.naturalHeight) throw new Error('無法讀取截圖，請再試一次。');
      this.layer.style.display='block'; this.shade.style.display='block'; this.selection.style.display='none'; this.size.style.display='none'; this.info.textContent='拖曳框選 · Esc 取消';
      this.start = null; this.busy = false; this.full.focus();
    } catch (error) { this.close(); throw error; }
  }
  finish(rect) {
    if (!this.opened || this.busy) return;
    this.busy = true;
    try {
      const sx=this.image.naturalWidth/this.viewport.width, sy=this.image.naturalHeight/this.viewport.height;
      const left=Math.floor(rect.left*sx), top=Math.floor(rect.top*sy);
      const width=Math.min(this.image.naturalWidth-left,Math.ceil((rect.left+rect.width)*sx)-left), height=Math.min(this.image.naturalHeight-top,Math.ceil((rect.top+rect.height)*sy)-top);
      if (width<1 || height<1) throw new Error('請框選有效的截圖範圍。');
      const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
      const context=canvas.getContext('2d'); if(!context) throw new Error('無法建立截圖，請重新整理網頁。');
      context.drawImage(this.image,left,top,width,height,0,0,width,height);
      const data=canvas.toDataURL('image/png'); canvas.width=canvas.height=0;
      if (!data.startsWith('data:image/png;base64,') || data.length>28_000_000) throw new Error('截圖超過 20 MB，請框選較小區域。');
      this.close(); this.onSelect(data,rect);
    } catch(error) { this.busy=false; this.info.textContent=error.message || '截圖處理失敗，請重新框選。'; this.onError(error); }
  }
  close() {
    if (!this.opened) return;
    this.opened=false; this.busy=false; this.start=null; this.layer.style.display='none'; this.image.removeAttribute('src');
    if(this.pointer !== undefined && this.layer.hasPointerCapture(this.pointer)) this.layer.releasePointerCapture(this.pointer);
    this.pointer=undefined;
    if(this.previousFocus?.isConnected) this.previousFocus.focus();
  }
};
