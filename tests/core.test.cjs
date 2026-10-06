const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
require('../shared.js');
const S = globalThis.ShakeSave;

test('shake rejects jitter and straight dragging, accepts both starting directions', () => {
  for (const coords of [[1,-2,5,-4,7,-5,0],[30,50,80,100,150]]) {
    const shake = new S.Shake(0,24); for (const x of coords) assert.equal(shake.move(x), false);
  }
  for (const sign of [-1,1]) {
    const shake = new S.Shake(0,24);
    assert.equal(shake.move(sign*30),false); assert.equal(shake.move(sign*-30),false);
    assert.equal(shake.move(sign*30),true);
  }
});
test('folder validation prevents absolute paths, traversal and reserved Windows names', () => {
  assert.equal(S.folder('參考圖\\Pose'), '參考圖/Pose');
  for(const bad of ['', '/etc', 'D:\\Art', '../Pictures', 'a/../b', 'a//b', 'a/', 'a/.', 'a/NUL', 'a/con.jpg', 'a/aux', 'a/b.', 'a/b ', 'x\u0000y']) {
    // Outer whitespace is intentionally trimmed.
    if (bad === 'a/b ') continue;
    assert.throws(()=>S.folder(bad),bad);
  }
});
test('response MIME chooses extension and sanitizes names', () => {
  const date = new Date('2026-10-05T14:00:00Z');
  assert.equal(S.filename('https://site.test/a.jpg?token=x', 'image/webp',date),'20261005-140000_a.webp');
  assert.equal(S.filename('https://site.test/image', 'image/png',date),'20261005-140000_image.png');
  assert.equal(S.filename('data:image/png;base64,AA', 'image/png',date),'20261005-140000_reference.png');
  assert.ok(!S.filename('https://site.test/%3Cbad%3E.gif','image/gif',date).includes('<'));
});

function harness({state='in_progress', mime='image/png', error=null, fail=false, enabled=true, storageMode='downloads', nativeSave}={}) {
  const session={}, local={settings:{enabled,folder:'Art/Pose',storageMode}}, notifications=[], requests=[], listeners={};
  const item={id:7,state,mime,error,url:'https://site.test/image',byExtensionId:'test'};
  const storage = obj => ({get: async key=>typeof key==='string'?{[key]:obj[key]}:obj,set:async data=>Object.assign(obj,data),remove:async key=>{delete obj[key];}});
  const chrome = {runtime:{id:'test',getURL:file=>`chrome-extension://test/${file}`,onMessage:{addListener:fn=>listeners.message=fn}},
    storage:{session:storage(session),local:storage(local)},tabs:{sendMessage:async(...args)=>notifications.push(args)},
    downloads:{onDeterminingFilename:{addListener:fn=>listeners.filename=fn},onChanged:{addListener:fn=>listeners.change=fn},
      download:async opts=>{requests.push(opts);if(fail)throw new Error('NETWORK_FAILED');return 6+requests.length;},search:async()=>[item]}};
  const context=vm.createContext({chrome,console,URL,Date,Set,globalThis:null,saveNative:nativeSave});context.globalThis=context;
  context.importScripts=()=>vm.runInContext(fs.readFileSync(path.join(root,'shared.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
  const send=(msg={type:'SHAKE_SAVE',url:item.url,token:'token'},sender={id:'test',tab:{id:3},frameId:2})=>new Promise(resolve=>listeners.message(msg,sender,resolve));
  return {send,listeners,item,notifications,requests,local,session};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('custom category snapshot reaches native and download paths even after settings change',async()=>{
  const categories=[{id:'color',label:'色彩',prefix:'{',suffix:'}',kind:'tags'}];
  const message={type:'SHAKE_SAVE',url:'https://site.test/image',token:'custom',tags:{color:'暖色'},categories};
  const h=harness();await h.send(message);h.local.settings.categories=[{...categories[0],prefix:'!'}];
  const result=await new Promise(resolve=>h.listeners.filename(h.item,resolve));
  assert.equal(result.filename,'Art/Pose/{暖色}.png');
  let nativeSchema;
  const n=harness({storageMode:'native',nativeSave:async(url,tags,schema)=>{nativeSchema=schema;return {path:'D:\\Art\\{暖色}.png'};}});
  assert.equal((await n.send(message)).ok,true);assert.equal(nativeSchema[0].prefix,'{');
  assert.deepEqual(Array.from(n.local.tagHistory.color),['暖色']);
});
test('download is queued without premature success; completion routes to original frame',async()=>{
  const h=harness();assert.equal((await h.send()).ok,true);await tick();
  assert.equal(h.notifications.length,0);assert.equal(h.requests[0].saveAs,false);
  h.item.state='complete';h.listeners.change({id:7,state:{current:'complete'}});await tick();
  assert.equal(h.notifications.length,1);assert.equal(h.notifications[0][0],3);
  assert.equal(h.notifications[0][1].ok,true);assert.equal(h.notifications[0][2].frameId,2);
  assert.equal(Object.keys(h.session).length,0);
});
test('completion before job registration is reconciled',async()=>{
  const h=harness({state:'complete'});await h.send();await tick();assert.equal(h.notifications[0][1].ok,true);
});
test('interruptions and HTML responses are never reported as saved images',async()=>{
  for(const config of [{state:'interrupted',error:'SERVER_FORBIDDEN'},{state:'complete',mime:'text/html'}]){
    const h=harness(config);await h.send();await tick();assert.equal(h.notifications[0][1].ok,false);
  }
});
test('API rejection, disabled setting and invalid source are returned as errors',async()=>{
  assert.equal((await harness({fail:true}).send()).ok,false);
  assert.equal((await harness({enabled:false}).send()).ok,false);
  const h=harness();assert.equal((await h.send({type:'SHAKE_SAVE',url:'file:///private',token:'t'})).ok,false);
  assert.equal((await h.send(undefined,{id:'other',tab:{id:1}})).ok,false);assert.equal(h.requests.length,0);
});
test('filename suggestion uses response type and ignores other extensions downloads',async()=>{
  const h=harness({mime:'image/webp'});
  const result=await new Promise(resolve=>h.listeners.filename(h.item,resolve));
  assert.ok(result.filename.startsWith('Art/Pose/'));assert.ok(result.filename.endsWith('.webp'));
  assert.equal(result.conflictAction,'uniquify');
  assert.equal(h.listeners.filename({...h.item,byExtensionId:'other'},()=>assert.fail()),undefined);
});
test('native mode only reports success after host commit; errors never fall back to downloads', async () => {
  let commit;
  const h = harness({ storageMode: 'native', nativeSave: () => new Promise(r => commit = r) });
  let complete = false; const result = h.send().then(r => { complete = true; return r; }); await tick();
  assert.equal(complete, false); assert.equal(h.requests.length, 0);
  commit({ path: 'D:\\Art\\image.png' }); assert.equal((await result).complete, true);
  assert.equal(h.local.lastResult.ok, true);
  const failed = harness({ storageMode: 'native', nativeSave: async () => { throw new Error('not connected'); } });
  assert.equal((await failed.send()).ok, false); assert.equal(failed.requests.length, 0); assert.equal(failed.local.lastResult.ok, false);
});
test('page content cannot open the native folder chooser', async () => {
  const h = harness();
  const result = await h.send({ type: 'NATIVE_CHOOSE' }, { id: 'test', tab: { id: 3 }, url: 'https://site.test/' });
  assert.equal(result.ok, false);
});
test('download filename uses its saved tags, response MIME and original folder; history excludes descriptions', async () => {
  const h = harness({mime:'image/webp'});
  const tags = {artist:'Painter', subjects:'頭 人物',styles:'水彩',descriptions:'note'};
  await h.send({type:'SHAKE_SAVE',url:h.item.url,token:'tagged',tags});
  h.local.settings.folder = 'Changed';
  const result = await new Promise(resolve => h.listeners.filename(h.item,resolve));
  assert.equal(result.filename,'Art/Pose/@Painter [頭] [人物] #水彩 ＂note＂.webp');
  assert.match(h.requests[0].filename, /@Painter/);
  assert.deepEqual(Array.from(h.local.tagHistory.subjects),['頭','人物']); assert.equal(h.local.tagHistory.descriptions,undefined);
});
test('oversized tag filename is rejected before either download or native write', async () => {
  let nativeCalls = 0;
  for (const storageMode of ['downloads','native']) {
    const h = harness({storageMode,nativeSave:async()=>{nativeCalls++;}});
    assert.equal((await h.send({type:'SHAKE_SAVE',url:h.item.url,tags:{artist:'a'.repeat(111)}})).ok,false);
    assert.equal(h.requests.length,0);
  }
  assert.equal(nativeCalls,0);
});
test('concurrent saves of the same URL keep independent tags and merge history', async () => {
  const h = harness();
  await Promise.all(['Alice','Bob'].map(artist => h.send({type:'SHAKE_SAVE',url:h.item.url,token:artist,tags:{artist}})));
  const a = await new Promise(resolve=>h.listeners.filename({...h.item,id:7},resolve));
  const b = await new Promise(resolve=>h.listeners.filename({...h.item,id:8},resolve));
  assert.equal(a.filename,'Art/Pose/@Alice.png'); assert.equal(b.filename,'Art/Pose/@Bob.png');
  assert.equal(h.local.tagHistory.artist.length,2);
});
