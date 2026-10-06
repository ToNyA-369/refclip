// Editor event contracts (including uncommitted IME input), using a minimal DOM.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(settings = {}, storageGet) {
  let root; const saved = [];
  class Node {
    constructor() { this.style={};this.attributes={};this.events={};this.nodes={};this.children=[];this.value='';this.isConnected=true;this.textContent=''; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(k,v) { this.attributes[k]=v; }
    removeAttribute(k) { delete this.attributes[k]; }
    querySelector(selector) {
      if(!this.nodes[selector]) {
        const node = new Node(); node.name=selector.match(/name="([^"]+)"/)?.[1]; this.nodes[selector]=node;
      }
      return this.nodes[selector];
    }
    addEventListener(name,fn) { (this.events[name]??=[]).push(fn); }
    emit(name,extra={}) { const event={target:this,preventDefault(){this.prevented=true;},stopPropagation(){},...extra};for(const fn of this.events[name]||[])fn(event);return event; }
    replaceChildren(...nodes) { this.children=nodes; }
    focus() { root.activeElement=this;this.emit('focus'); }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
    getBoundingClientRect() {return {width:parseFloat(this.style.width)||360,height:530};}
  }
  root = new Node();
  const context = vm.createContext({console,queueMicrotask,innerWidth:1024,innerHeight:768,
    document:{createElement:()=>new Node(),activeElement:new Node()},
    chrome:{storage:{local:{get:storageGet || (async()=>({tagHistory:{artist:['繪師甲','繪師乙'],subjects:['頭髮','頭部'],styles:['手繪']}}))}}}});
  for(const file of ['shared.js','tag-editor.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  const editor = new context.ShakeSaveTagEditor(root,async(url,tags,categories)=>{saved.push({url,tags,categories});return true;});
  editor.open('https://example.test/picture.png',500,350,settings);
  return {editor,saved,root};
}

test('synchronous invalidated extension context is caught with refresh guidance and no save',async()=>{
  const {editor,saved}=harness({},()=>{throw new Error('Extension context invalidated.');});
  await tick();assert.match(editor.error.textContent,/重新整理/);assert.equal(editor.saveButton.disabled,true);
  editor.fields[0].value='A';await editor.submit();assert.equal(saved.length,0);
});
test('ordinary history rejection still permits manual tags; stale requests cannot overwrite a new form',async()=>{
  const failed=harness({},()=>Promise.reject(new Error('storage unavailable')));await tick();
  assert.match(failed.editor.error.textContent,/手動輸入/);failed.editor.fields[0].value='A';await failed.editor.submit();assert.equal(failed.saved.length,1);
  const resolves=[];const {editor}=harness({},()=>new Promise(resolve=>resolves.push(resolve)));
  editor.close();editor.open('https://test/other.png',500,350);resolves[1]({tagHistory:{artist:['New']}});await tick();
  resolves[0]({tagHistory:{artist:['Old']}});await tick();assert.deepEqual(editor.history.artist,['New']);
});
test('uncommitted Chinese IME input shows prefix matches without intercepting Enter or saving',async()=>{
  const {editor,saved}=harness();await tick();
  const field=editor.fields[1];field.focus();field.emit('compositionstart');
  field.value='頭';field.selectionStart=1;field.emit('input',{isComposing:true});
  assert.deepEqual(Array.from(editor.options),['頭髮','頭部']);
  const event=field.emit('keydown',{key:'Enter',isComposing:true,keyCode:229});assert.equal(event.prevented,undefined);
  await editor.submit();assert.equal(saved.length,0);
  field.emit('compositionend');await editor.submit();assert.equal(saved.length,1);
});

test('custom fields submit a schema snapshot and preserve single text; preview can be hidden', async()=>{
  const categories=[{id:'color',label:'色彩',prefix:'{',suffix:'}',kind:'tags'},{id:'note',label:'觀察',prefix:'(',suffix:')',kind:'text'}];
  const {editor,saved}=harness({categories,previewMode:'hidden'});
  assert.deepEqual(Array.from(editor.fields,f=>f.name),['color','note']);
  assert.equal(editor.form.querySelector('details').hidden,true);
  categories[0].prefix='!';
  editor.fields[0].value='暖色 冷色';editor.fields[1].value='有  很多光';editor.updatePreview();
  assert.equal(editor.preview.textContent,'{暖色} {冷色} (有  很多光)');
  editor.history={color:['暖色系'],note:['有很多光']};
  editor.fields[1].emit('input');assert.equal(editor.options.length,0);
  await editor.submit();assert.equal(saved[0].categories[0].prefix,'{');assert.equal(saved[0].tags.note,'有  很多光');
});

test('preview preference resets on each new editor and custom categories support prefix completion',()=>{
  const categories=[{id:'color',label:'色彩',prefix:'',suffix:'',kind:'tags'}];
  const {editor}=harness({categories,previewMode:'open'});
  assert.equal(editor.form.querySelector('details').open,true);
  editor.history={color:['暖色系','暖光']};const field=editor.fields[0];field.value='暖';field.selectionStart=1;field.emit('input');
  assert.deepEqual(Array.from(editor.options),['暖色系','暖光']);
  editor.close();editor.open('https://example.test/picture.png',500,350);
  assert.equal(editor.fields.length,4);assert.equal(editor.form.querySelector('details').hidden,false);assert.equal(editor.form.querySelector('details').open,false);
});
test('multiple artists complete only the current token and description spaces survive submission',async()=>{
  const {editor,saved}=harness();await tick();
  const artist=editor.fields[0];artist.value='繪師甲 繪';artist.selectionStart=5;artist.emit('input');
  assert.deepEqual(Array.from(editor.options),['繪師乙']);editor.accept(artist,'繪師乙');
  assert.equal(artist.value,'繪師甲 繪師乙');
  editor.fields[3].value='鼻子  很漂亮 鼻子';await editor.submit();
  assert.equal(saved[0].tags.descriptions,'鼻子  很漂亮 鼻子');
});
test('thumbnail frame keeps landscape and portrait aspect ratios and releases image on close',()=>{
  const {editor}=harness();
  for(const [w,h] of [[1200,800],[800,1200]]) {
    editor.thumbnail.naturalWidth=w;editor.thumbnail.naturalHeight=h;editor.thumbnail.emit('load');
    const width=parseFloat(editor.thumbnail.style.width),height=parseFloat(editor.thumbnail.style.height);
    assert.ok(Math.abs(width/height-w/h)<.01);assert.ok(height<=210);assert.ok(width<=396);
    assert.equal(editor.imageInfo.textContent,`${w} × ${h}`);
  }
  editor.thumbnail.emit('error');assert.equal(editor.imageFallback.style.display,'block');
  editor.close();assert.equal(editor.opened,false);
});
