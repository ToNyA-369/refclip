// Event-flow tests with a minimal DOM/Chrome simulation, not a real browser.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function harness({ storageMode = 'downloads', imageUrl, nativeComplete = false, fetchImpl } = {}) {
  const listeners={}, timers=new Map(), nodes={}, sent=[]; let timerId=0, resultListener, changeListener, editor;
  class Element {
    constructor(){this.style={};this.isConnected=false;this.textContent='';this.className='';this.classes=new Set();
      this.classList={add:x=>this.classes.add(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};}
    attachShadow(){return {set innerHTML(value){},querySelector:selector=>nodes[selector]??=new Element()};}
    getBoundingClientRect(){const left=parseFloat(this.style.left)||0,top=parseFloat(this.style.top)||0;return {left,right:left+264,top,bottom:top+154};}
  }
  class HTMLImageElement extends Element {constructor(){super();this.src='https://site.test/image.png';this.currentSrc=this.src;}}
  const target=new HTMLImageElement();
  if (imageUrl) target.currentSrc = target.src = imageUrl;
  const register=(name,fn)=>{(listeners[name]??=[]).push(fn);};
  const document={hidden:false,baseURI:'https://site.test/',body:new Element(),documentElement:new Element(),createElement:()=>new Element(),addEventListener:register};
  document.documentElement.append=el=>{el.isConnected=true;};
  const chrome={storage:{local:{get:async()=>({settings:{storageMode}})},onChanged:{addListener:fn=>changeListener=fn}},
    runtime:{id:'test',sendMessage:async msg=>{sent.push(msg);return nativeComplete ? {ok:true,complete:true,message:'已儲存：D:\\Art\\reference.png'} : {ok:true,id:1};},onMessage:{addListener:fn=>resultListener=fn}}};
  const window={addEventListener:register};window.top=window;
  const context=vm.createContext({chrome,document,Element,HTMLImageElement,SVGImageElement:class extends Element{},
    window,URL,Date,Math,Set,console,innerWidth:1024,innerHeight:768,scrollX:0,scrollY:0,requestAnimationFrame:fn=>queueMicrotask(fn),
    location: { origin: 'https://site.test' }, Blob, AbortController, fetch: fetchImpl,
    FileReader: class { async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload(); } },
    ShakeSaveTagEditor: class {
      constructor(root, save) { editor = this; this.save = save; this.opened = false; }
      open(url, x, y) { this.url = url; this.opened = true; this.x = x; this.y = y; }
      async submit(tags = {}) { const result = await this.save(this.url, tags); if (result) this.opened = false; return result; }
      close() { this.opened = false; }
    },
    ShakeSaveScreenshot: class {
      constructor(root,onSelect) { this.onSelect=onSelect;this.opened=false; }
      async open(data,viewport) { this.data=data;this.viewport=viewport;this.opened=true; }
      close() { this.opened=false; }
    },
    crypto:{randomUUID:()=>String(sent.length+1)},getComputedStyle:()=>({backgroundImage:'none'}),
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
  for(const file of ['shared.js','content.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  function event(name,extra={}){
    const e={isTrusted:true,button:0,pointerType:'mouse',buttons:1,pointerId:1,clientX:100,clientY:100,
      composedPath:()=>[target,document.body],preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const fn of listeners[name]||[])fn(e);return e;
  }
  function hold(){event('pointerdown');for(const [id,t] of timers)if(t.ms===350){timers.delete(id);t.fn();}}
  function shake(){for(const x of [130,70,130])event('pointermove',{clientX:x});}
  return {event,hold,shake,nodes,sent,editor:()=>editor,submit:tags=>editor.submit(tags),message:(msg,sender={id:'test'})=>new Promise(resolve=>{const waiting=resultListener(msg,sender,resolve);if(waiting!==true)resolve();}),result:msg=>resultListener(msg),disable:()=>changeListener({settings:{newValue:{enabled:false}}},'local')};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('screenshot preparation waits for repaint, preserves open editor, and validates viewport before showing',async()=>{
  const h=harness();await tick();
  assert.equal((await h.message({type:'SCREENSHOT_PREPARE'})).ok,true);
  assert.equal((await h.message({type:'SCREENSHOT_SHOW',image:'data:image/png;base64,AA',viewport:{width:900,height:768,x:0,y:0}})).ok,false);
  assert.equal((await h.message({type:'SCREENSHOT_SHOW',image:'data:image/png;base64,AA',viewport:{width:1024,height:768,x:0,y:0}})).ok,true);
  await h.message({type:'SCREENSHOT_RELEASE'});
  h.hold();h.shake();h.event('pointerup');assert.equal(h.editor().opened,false);assert.equal(h.sent.length,0);
  await h.message({type:'SCREENSHOT_ERROR',message:'busy'}); // Repeated command must keep the existing screenshot.
  h.hold();h.shake();h.event('pointerup');assert.equal(h.editor().opened,false);
  h.event('blur');h.hold();h.shake();h.event('pointerup',{clientX:130,clientY:100});assert.equal(h.editor().opened,true);
  assert.equal((await h.message({type:'SCREENSHOT_PREPARE'})).ok,false);assert.equal(h.editor().opened,true);
});
test('foreign screenshot messages and hidden-page requests cannot start capture',async()=>{
  const h=harness();assert.equal(await h.message({type:'SCREENSHOT_PREPARE'},{id:'other'}),undefined);
  await h.message({type:'SCREENSHOT_PREPARE'});h.event('resize');
  assert.equal((await h.message({type:'SCREENSHOT_SHOW',image:'data:image/png;base64,AA',viewport:{width:1024,height:768,x:0,y:0}})).ok,false);
});
test('ordinary click and quick native drag remain untouched',()=>{
  const h=harness();h.event('pointerdown');assert.equal(h.event('pointerup').prevented,undefined);
  assert.equal(h.event('click').prevented,undefined);assert.equal(h.sent.length,0);
  h.event('pointerdown');assert.equal(h.event('dragstart').prevented,undefined);
  assert.equal(h.event('pointerup',{clientX:800,clientY:650}).prevented,undefined);
});
test('drop opens editor at pointer and waits for tags before sending one save',async()=>{
  const h=harness();h.hold();assert.equal(h.event('dragstart').prevented,true);h.shake();
  assert.equal(h.nodes['.zone'].classes.has('active'),true);
  h.event('pointermove',{clientX:130,clientY:100});assert.equal(h.nodes['.zone'].classes.has('over'),true);
  h.event('pointerup',{clientX:130,clientY:100});await tick();assert.equal(h.sent.length,0);assert.equal(h.editor().opened,true);
  await h.submit({artist:'繪師',subjects:'人物 頭'});assert.equal(h.sent.length,1);assert.equal(h.sent[0].tags.subjects,'人物 頭');
  assert.equal(h.event('click').prevented,true);assert.match(h.nodes['.toast'].textContent,/正在下載/);
  h.result({type:'SHAKE_RESULT',token:h.sent[0].token,ok:true,message:'已存入素材資料夾'});
  assert.match(h.nodes['.toast'].textContent,/✓/);
});
test('outside drop, Escape, blur, leaving page, pointercancel and pause all cancel',()=>{
  for(const mode of ['outside','escape','blur','leave','pointercancel','disable']){
    const h=harness();h.hold();h.shake();
    if(mode==='escape')h.event('keydown',{key:'Escape'});
    if(mode==='blur')h.event('blur');
    if(mode==='leave')h.event('pointerout',{relatedTarget:null});
    if(mode==='pointercancel')h.event('pointercancel');
    if(mode==='disable')h.disable();
    h.event('pointerup',{clientX:mode==='outside'?800:130,clientY:mode==='outside'?650:100});
    assert.equal(h.sent.length,0,mode);
    assert.equal(h.editor()?.opened || false,false,mode);
  }
});
test('short movement, untrusted input, touch and modifier gestures do not activate',()=>{
  for(const input of [{isTrusted:false},{pointerType:'touch'},{ctrlKey:true},{button:2}]){
    const h=harness();h.event('pointerdown',input);h.shake();h.event('pointerup',{clientX:800,clientY:650});assert.equal(h.sent.length,0);
  }
  const h=harness();h.hold();for(const x of [104,97,106,99])h.event('pointermove',{clientX:x});
  h.event('pointerup',{clientX:800,clientY:650});assert.equal(h.sent.length,0);
});
test('native completion shows success; same-origin and blob keep bytes, data stays intact', async () => {
  const bytes = Buffer.from([137,80,78,71]); const data = `data:image/png;base64,${bytes.toString('base64')}`;
  for (const url of ['https://site.test/image.png', 'blob:https://site.test/123', data]) {
    const h = harness({ storageMode: 'native', imageUrl: url, nativeComplete: true,
      fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) });
    await tick(); h.hold(); h.shake(); h.event('pointerup', { clientX: 130, clientY: 100 }); await h.submit();
    await tick(); await tick();
    assert.equal(h.sent[0].url, data); assert.match(h.nodes['.toast'].textContent, /✓ 已儲存/);
  }
});
test('expired blob reports an error without submitting a save', async () => {
  const h = harness({ storageMode: 'native', imageUrl: 'blob:https://site.test/expired', fetchImpl: async () => { throw new Error('expired'); } });
  await tick(); h.hold(); h.shake(); h.event('pointerup', { clientX: 130, clientY: 100 }); await h.submit(); await tick();
  assert.equal(h.sent.length, 0); assert.match(h.nodes['.toast'].textContent, /暫存圖片無法讀取/);
});
test('drop zone stays fixed after activation and cancelling editor never saves', () => {
  const h = harness(); h.hold(); h.shake();
  const before = {...h.nodes['.zone'].style};
  assert.equal(before.left, '8px'); assert.equal(before.top, '23px');
  h.event('pointermove', { clientX: 700, clientY: 500 });
  assert.deepEqual(h.nodes['.zone'].style, before);
  h.event('pointerup', { clientX: 130, clientY: 100 }); h.editor().close(); assert.equal(h.sent.length, 0);
});
