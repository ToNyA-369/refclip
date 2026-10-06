/* Shared pure helpers, also loaded by the service worker and tests. */
globalThis.ShakeSave = (() => {
  const defaults = { enabled: true, folder: 'DrawingReferences', holdMs: 350, distance: 24 };
  const defaultCategories = [
    { id: 'artist', label: '繪師', prefix: '@', suffix: '', kind: 'tags' },
    { id: 'subjects', label: '主體', prefix: '[', suffix: ']', kind: 'tags' },
    { id: 'styles', label: '風格', prefix: '#', suffix: '', kind: 'tags' },
    { id: 'descriptions', label: '描述', prefix: '＂', suffix: '＂', kind: 'text' }
  ];
  function platform() {
    const value = String(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || 'win').toLowerCase();
    return value.includes('mac') ? 'mac' : value.includes('linux') ? 'linux' : 'win';
  }
  function categories(input = defaultCategories) {
    if (!Array.isArray(input) || !input.length || input.length > 12) throw new Error('請保留 1–12 個標籤類別。');
    const ids = new Set();
    return input.map(c => {
      if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/.test(c.id) || ['constructor','prototype'].includes(c.id) || ids.has(c.id)) throw new Error('標籤類別識別碼無效或重複。');
      ids.add(c.id);
      if (typeof c.label !== 'string' || !c.label.trim() || c.label.trim().length > 16) throw new Error('類別名稱須為 1–16 字元。');
      for (const key of ['prefix', 'suffix']) if (typeof c[key] !== 'string' || c[key].length > 12 || /[\x00-\x1f\x7f]/.test(c[key])) throw new Error('前後綴最多 12 字元，不可包含控制字元。');
      if (!['tags','text'].includes(c.kind)) throw new Error('請選擇多標籤或單段文字。');
      return { id: c.id, label: c.label.trim(), prefix: c.prefix, suffix: c.suffix, kind: c.kind };
    });
  }
  function folder(value) {
    const raw = String(value ?? '').trim().replace(/\\/g, '/');
    if (!raw || raw.length > 160 || raw.startsWith('/') || /[<>:"|?*\x00-\x1f]/.test(raw))
      throw new Error('請填下載目錄下的相對資料夾，例如 DrawingReferences/Pose。');
    const parts = raw.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
      throw new Error('資料夾名稱不可包含空層級、..、結尾句點或 Windows 保留名稱。');
    return raw;
  }
  function settings(input = {}) {
    let dir; try { dir = folder(input.folder ?? defaults.folder); } catch { dir = defaults.folder; }
    let fields; try { fields = categories(input.categories); } catch { fields = categories(); }
    return { enabled: input.enabled !== false, folder: dir, storageMode: input.storageMode === 'native' ? 'native' : 'downloads',
      categories: fields, previewMode: ['open','hidden'].includes(input.previewMode) ? input.previewMode : 'collapsed',
      holdMs: Math.max(200, Math.min(1000, Number(input.holdMs) || defaults.holdMs)),
      distance: Math.max(12, Math.min(60, Number(input.distance) || defaults.distance)) };
  }
  const extensions = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif',
    'image/avif':'avif', 'image/svg+xml':'svg', 'image/bmp':'bmp', 'image/x-icon':'ico', 'image/vnd.microsoft.icon':'ico', 'image/tiff':'tif', 'image/apng':'png' };
  function filename(url, mime = '', date = new Date()) {
    let name = '';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch {}
    if (url.startsWith('data:')) name = 'reference';
    const match = name.match(/\.(jpe?g|png|webp|gif|avif|svg|bmp|ico|tiff?|apng)$/i);
    const ext = extensions[mime.split(';')[0].toLowerCase()] || match?.[1]?.toLowerCase() || '';
    name = name.replace(/\.[^.]{1,8}$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 70) || 'reference';
    return `${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')}_${name}${ext ? '.' + ext : ''}`;
  }
  function tags(input = {}, schema = defaultCategories) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('標籤格式不正確。');
    const result = {};
    for (const { id: field, kind } of categories(schema)) {
      const value = input[field] ?? '';
      if (typeof value !== 'string' || value.length > 1000) throw new Error('標籤內容過長或格式不正確。');
      const clean = value.normalize('NFC').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
      result[field] = kind === 'text' ? clean : [...new Set(clean.split(/\s+/u).filter(Boolean))].join(' ');
    }
    return result;
  }
  function validateAffixes(schema, os = platform()) {
    const fields = categories(schema);
    for (const c of fields) {
      const invalid = os === 'win' ? /[<>:"/\\|?*]/ : /[/\\]/;
      if (invalid.test(c.prefix + c.suffix)) throw new Error(`${c.label}的前後綴含${os === 'win' ? ' Windows 禁止的檔名字元（< > : " / \\ | ? *）' : '路徑分隔符號（/ 或 \\）'}。請改用其他符號；設定不會自動轉成全形。`);
    }
    return fields;
  }
  function safeTag(value, os = platform()) {
    const replacements = { '<': '＜', '>': '＞', ':': '：', '"': '＂', '/': '／', '\\': '＼', '|': '｜', '?': '？', '*': '＊' };
    return value.replace(os === 'win' ? /[<>:"/\\|?*]/g : /[/\\]/g, char => replacements[char]).replace(/\.$/, '．');
  }
  function tagStem(input, schema = defaultCategories, os = platform()) {
    const fields = validateAffixes(schema, os), t = tags(input, fields), pieces = [];
    for (const c of fields) {
      if (!t[c.id]) continue;
      const values = c.kind === 'text' ? [t[c.id]] : t[c.id].split(' ');
      pieces.push(...values.map(value => c.prefix + safeTag(value, os) + c.suffix));
    }
    const stem = pieces.join(' ');
    if (stem.length > 110) throw new Error('標籤組成的檔名超過 110 字元，請縮短內容後再儲存。');
    if (stem && (stem.startsWith('.') || (os === 'win' && /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(stem)))) throw new Error('檔名是系統保留名稱或以句點開頭，請調整文字或前後綴。');
    if (os === 'mac' && [...stem].reduce((n,c) => n + (c.codePointAt(0) < 128 ? 1 : c.codePointAt(0) < 2048 ? 2 : c.codePointAt(0) < 65536 ? 3 : 4), 0) > 230) throw new Error('檔名超過 macOS 安全長度（230 UTF-8 位元組），請縮短標籤。');
    return stem;
  }
  function taggedFilename(url, mime, input, date = new Date(), schema = defaultCategories, os = platform()) {
    const base = filename(url, mime, date), stem = tagStem(input, schema, os);
    return stem ? stem + (base.match(/\.[a-z0-9]+$/i)?.[0] || '.image') : base;
  }
  function tokenRange(value, caret, single = false) {
    if (single) return { start: 0, end: value.length, prefix: value.trimStart() };
    const pos = Math.max(0, Math.min(value.length, caret ?? value.length));
    let start = pos, end = pos;
    while (start > 0 && !/\s/u.test(value[start - 1])) start--;
    while (end < value.length && !/\s/u.test(value[end])) end++;
    return { start, end, prefix: value.slice(start, pos) };
  }
  function suggestions(history, field, value, caret, schema = defaultCategories) {
    const { prefix } = tokenRange(value, caret);
    if (!prefix || !schema.some(c => c.id === field && c.kind === 'tags')) return [];
    const used = value.split(/\s+/u);
    const entries = (Array.isArray(history?.[field]) ? history[field] : []).filter(v => typeof v === 'string').flatMap(v => v.split(/\s+/u));
    return [...new Set(entries)].filter(v => v.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()) && !used.includes(v)).slice(0, 6);
  }
  function mergeHistory(history, input, schema = defaultCategories) {
    const fields = categories(schema), t = tags(input, fields), next = {};
    // Keep other valid categories when a previously opened editor saves its snapshot.
    for (const [key, value] of Object.entries(history || {}).slice(0, 64)) {
      if (/^[a-z][a-z0-9_]{0,47}$/.test(key) && !['constructor','prototype'].includes(key) && Array.isArray(value)) next[key] = value.filter(v => typeof v === 'string' && v.length <= 110).slice(0,500);
    }
    for (const { id: field, kind } of fields) {
      if (kind === 'text') { delete next[field]; continue; }
      const fresh = t[field].split(' ').filter(Boolean);
      const old = Array.isArray(history?.[field]) ? history[field].filter(v => typeof v === 'string' && v.length <= 110).flatMap(v => v.split(/\s+/u).filter(Boolean)) : [];
      next[field] = [...new Set([...fresh, ...old])].slice(0, 500);
    }
    return next;
  }
  function placement(x, y, width, height, viewportWidth, viewportHeight) {
    return { left: Math.max(8, Math.min(x - width / 2, viewportWidth - width - 8)),
      top: Math.max(8, Math.min(y - height / 2, viewportHeight - height - 8)) };
  }
  class Shake {
    constructor(x, distance) { this.extreme = x; this.distance = distance; this.direction = 0; this.turns = 0; }
    move(x) {
      const delta = x - this.extreme;
      if (!this.direction) { if (Math.abs(delta) >= this.distance) { this.direction = Math.sign(delta); this.extreme = x; } }
      else if (delta * this.direction > 0) this.extreme = x;
      else if (Math.abs(delta) >= this.distance) { this.direction *= -1; this.extreme = x; this.turns++; }
      return this.turns >= 2;
    }
  }
  return { defaults, defaultCategories, platform, validateAffixes, categories, folder, settings, filename, tags, tagStem, taggedFilename, tokenRange, suggestions, mergeHistory, placement, Shake };
})();
