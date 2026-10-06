globalThis.chrome = {storage:{local:{get:async()=>({tagHistory:JSON.parse(localStorage.getItem('history') || '{"artist":["Alice","Alex"],"subjects":["人物","頭","頭髮"],"styles":["手繪","水彩"]}')})}}};
const editor = new ShakeSaveTagEditor(document.querySelector('#host').attachShadow({mode:'open'}), async (url,tags,categories) => {
  localStorage.setItem('history',JSON.stringify(ShakeSave.mergeHistory(JSON.parse(localStorage.getItem('history') || '{}'),tags,categories)));
  document.querySelector('#result').textContent = ShakeSave.taggedFilename(url,'image/png',tags,undefined,categories);
  return true;
});
document.querySelector('#open').onclick = event => editor.open('/sample.svg',event.clientX,event.clientY,JSON.parse(localStorage.getItem('settings') || '{}'));
document.querySelector('#simulateReload').onclick = () => {
  chrome.storage.local.get = () => { throw new Error('Extension context invalidated.'); };
  document.querySelector('#result').textContent = '已模擬舊網頁的失效環境；再開啟表單檢查提示。';
};
