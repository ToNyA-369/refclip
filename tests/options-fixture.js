// Browser-only UI fixture; no extension APIs or native host are contacted.
globalThis.chrome = {
  commands:{getAll:async()=>[{name:'capture-image',shortcut:'Alt+Shift+S'}]},
  tabs:{create:async()=>{}},
  runtime: {id:'mock-extension-id',sendMessage:async()=>({ok:false,error:'測試頁：未連接本機程式，不會寫入圖片。'})},
  storage:{local:{get:async()=>({settings:JSON.parse(localStorage.getItem('settings') || '{}')}),set:async({settings})=>localStorage.setItem('settings',JSON.stringify(settings))}}
};
const banner=document.createElement('p');banner.textContent='設定介面測試：僅保存測試頁設定，不影響擴充功能。';
const link=document.createElement('a');link.href='/editor';link.textContent='返回標籤表單';banner.append(' ',link);document.body.prepend(banner);
