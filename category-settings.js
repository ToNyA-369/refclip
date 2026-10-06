globalThis.ShakeSaveCategorySettings = class {
  constructor(container) { this.container = container; this.rows = []; }
  render(categories) {
    this.container.replaceChildren(); this.rows = [];
    for (const category of ShakeSave.categories(categories)) this.add(category);
  }
  add(category = { id: `custom_${crypto.randomUUID().replace(/-/g, '')}`, label: '', prefix: '', suffix: '', kind: 'tags' }) {
    if (this.rows.length >= 12) throw new Error('最多可設定 12 個標籤類別。');
    const row = document.createElement('div'); row.className = 'category-row';
    const inputs = {};
    for (const [key, title, maxLength] of [['label','類別名稱',16],['prefix','前綴',12],['suffix','後綴',12]]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('input'); input.type = 'text'; input.value = category[key]; input.maxLength = maxLength;
      input.setAttribute('aria-label', `${title}（${category.label || '新類別'}）`); input.placeholder = key === 'label' ? '例如：色彩' : '無';
      label.append(input); row.append(label); inputs[key] = input;
    }
    const label = document.createElement('label'); label.textContent = '輸入方式';
    const kind = document.createElement('select');
    for (const [value,text] of [['tags','多標籤'],['text','單段文字']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; kind.append(option); }
    kind.value = category.kind; kind.setAttribute('aria-label', `輸入方式（${category.label || '新類別'}）`); label.append(kind); row.append(label); inputs.kind = kind;
    const actions = document.createElement('div'); actions.className = 'category-actions';
    const entry = { id: category.id, row, inputs }; this.rows.push(entry);
    for (const [text, label, action] of [
      ['↑', '上移', () => this.move(entry, -1)], ['↓', '下移', () => this.move(entry, 1)],
      ['移除', '移除', () => { if (this.rows.length === 1) throw new Error('請至少保留一個類別。'); this.rows = this.rows.filter(r => r !== entry); row.remove(); }]
    ]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.className = 'secondary';
      button.setAttribute('aria-label', `${label} ${category.label || '新類別'}`);
      button.addEventListener('click', () => { try { action(); } catch (error) { document.getElementById('status').textContent = error.message; } }); actions.append(button);
    }
    row.append(actions); this.container.append(row); return inputs.label;
  }
  move(entry, delta) {
    const index = this.rows.indexOf(entry), target = index + delta;
    if (target < 0 || target >= this.rows.length) return;
    [this.rows[index], this.rows[target]] = [this.rows[target], this.rows[index]];
    for (const item of this.rows) this.container.append(item.row);
  }
  value() {
    return ShakeSave.categories(this.rows.map(({id,inputs}) => ({id,...Object.fromEntries(Object.entries(inputs).map(([key,input]) => [key,input.value]))})));
  }
};
