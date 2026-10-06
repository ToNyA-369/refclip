const $ = id => document.getElementById(id);
function labels() { $('holdValue').textContent = `${$('holdMs').value} ms`; $('distanceValue').textContent = `${$('distance').value} px`; }
chrome.storage.local.get(['settings', 'lastResult']).then(({ settings, lastResult }) => {
  const value = ShakeSave.settings(settings);
  for (const key of ['folder', 'holdMs', 'distance']) $(key).value = value[key];
  $('enabled').checked = value.enabled; labels();
  $('destination').textContent = value.storageMode === 'native' ? '目前使用自訂本機資料夾；按下方按鈕查看路徑或變更。' : `目前位置：Chrome 下載目錄 / ${value.folder}`;
  if (lastResult) $('last').textContent = `最近一次：${lastResult.message}`;
});
$('holdMs').addEventListener('input', labels); $('distance').addEventListener('input', labels);
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const folder = ShakeSave.folder($('folder').value);
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: ShakeSave.settings({ ...settings, folder, enabled: $('enabled').checked, holdMs: $('holdMs').value, distance: $('distance').value }) });
    $('status').className = ''; $('status').textContent = '已儲存，立即生效。';
  } catch (error) { $('status').className = 'error'; $('status').textContent = error.message; }
});
$('downloads').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://downloads/' }));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
