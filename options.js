const $ = id => document.getElementById(id);
const categoryEditor = new ShakeSaveCategorySettings($('categories'));
let savedSettings = ShakeSave.settings();
async function readShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    $('screenshotShortcut').textContent = commands.find(command => command.name === 'capture-image')?.shortcut || '尚未設定（或與其他快捷鍵衝突）';
  } catch { $('screenshotShortcut').textContent = '無法讀取，請到 Chrome 快捷鍵設定檢查。'; }
}
$('editShortcut').addEventListener('click', async () => {
  try { await chrome.tabs.create({url:'chrome://extensions/shortcuts'}); }
  catch { $('screenshotShortcut').textContent = '請在網址列開啟 chrome://extensions/shortcuts'; }
});
$('refreshShortcut').addEventListener('click', readShortcut);
window.addEventListener('focus', readShortcut); readShortcut();
function labels() { $('holdValue').textContent = `${$('holdMs').value} ms`; $('distanceValue').textContent = `${$('distance').value} px`; }
function active(settings) { $('active').textContent = settings.storageMode === 'native' ? '已儲存的模式：自訂本機資料夾（位置見下方）' : `已儲存的模式：Chrome 下載目錄 / ${settings.folder}`; }
let busy = false;
async function native(type) {
  if (busy) return null;
  busy = true; for (const id of ['choose', 'refresh', 'save']) $(id).disabled = true;
  $('connection').className = ''; $('connection').textContent = type === 'NATIVE_CHOOSE' ? '請在系統視窗中選擇資料夾…' : '正在檢查…';
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (!result?.ok) throw new Error(result?.error || '無法連線本機程式。');
    if (result.cancelled) { $('connection').textContent = '已取消，原位置不變。'; return null; }
    $('nativeFolder').textContent = result.folder;
    $('connection').textContent = '本機程式已連線，資料夾可寫入。';
    return result;
  } catch (error) {
    $('connection').className = 'error'; $('connection').textContent = error.message;
    $('nativeFolder').textContent = '目前位置無法確認；請修復連線或重新選擇資料夾。';
    return null;
  } finally { busy = false; for (const id of ['choose', 'refresh', 'save']) $(id).disabled = false; }
}
chrome.storage.local.get(['settings', 'lastResult']).then(({ settings, lastResult }) => {
  const value = ShakeSave.settings(settings);
  savedSettings = value; categoryEditor.render(value.categories); $('previewMode').value = value.previewMode;
  for (const key of ['folder', 'holdMs', 'distance', 'storageMode']) $(key).value = value[key];
  $('enabled').checked = value.enabled; labels(); active(value);
  if (lastResult) $('last').textContent = `最近一次：${lastResult.message}`;
});
$('addCategory').addEventListener('click', () => {
  try { categoryEditor.add().focus(); } catch (error) { $('status').className = 'error'; $('status').textContent = error.message; }
});
$('resetCategories').addEventListener('click', () => categoryEditor.render(ShakeSave.defaultCategories));
$('extensionId').value = chrome.runtime.id;
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(chrome.runtime.id); $('copy').textContent = '已複製'; }
  catch { $('extensionId').select(); $('copy').textContent = '請按 Ctrl+C 複製'; }
});
$('choose').addEventListener('click', async () => { if (await native('NATIVE_CHOOSE')) $('storageMode').value = 'native'; });
$('refresh').addEventListener('click', () => native('NATIVE_STATUS'));
for (const id of ['holdMs', 'distance']) $(id).addEventListener('input', labels);
$('settings').addEventListener('submit', async event => {
  event.preventDefault(); $('status').className = '';
  try {
    const value = ShakeSave.settings({ categories: ShakeSave.validateAffixes(categoryEditor.value()), previewMode: $('previewMode').value, storageMode: $('storageMode').value, folder: ShakeSave.folder($('folder').value), enabled: $('enabled').checked, holdMs: $('holdMs').value, distance: $('distance').value });
    if (value.storageMode === 'native' && savedSettings.storageMode !== 'native' && !await native('NATIVE_STATUS')) throw new Error('請先完成本機程式安裝並選擇可寫入資料夾。原設定尚未變更。');
    await chrome.storage.local.set({ settings: value }); savedSettings = value; active(value); $('status').textContent = '已儲存，新的收圖表單立即套用。';
  } catch (error) { $('status').className = 'error'; $('status').textContent = error.message; }
});
native('NATIVE_STATUS');
