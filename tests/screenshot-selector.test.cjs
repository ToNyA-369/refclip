const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function harness({encodeError=false}={}) {
  const saved=[],errors=[],draws=[];
  class Node {
    constructor(){this.style={};this.nodes={};this.events={};this.children=[];this.naturalWidth=2000;this.naturalHeight=1400;this.isConnected=true;this.classList={contains:()=>false};}
    setAttribute(){} removeAttribute(){} append(...nodes){this.children.push(...nodes);} focus(){}
    addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
    querySelector(selector){return this.nodes[selector]??=new Node();}
    async decode(){} setPointerCapture(){} hasPointerCapture(){return false;} releasePointerCapture(){}
    emit(type,extra={}){const event={button:0,pointerId:1,composedPath:()=>[this],preventDefault(){},stopPropagation(){},...extra};for(const fn of this.events[type]||[])fn(event);}
    getContext(){return {drawImage:(...args)=>draws.push(args.slice(1))};}
    toDataURL(format){assert.equal(format,'image/png');if(encodeError)throw new Error('encoding failed');return 'data:image/png;base64,AAAA';}
  }
  const context=vm.createContext({document:{createElement:()=>new Node(),activeElement:new Node(),hidden:false},innerWidth:1000,innerHeight:700});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../screenshot-selector.js'),'utf8'),context);
  const selector=new context.ShakeSaveScreenshot(new Node(),(data,rect)=>saved.push({data,rect}),error=>errors.push(error));
  return {selector,saved,errors,draws,open:()=>selector.open('data:image/png;base64,AAAA',{width:1000,height:700})};
}
test('reverse drag crops exact high-DPI source pixels and hands PNG to editor once',async()=>{
  const h=harness();await h.open();
  h.selector.layer.emit('pointerdown',{clientX:300,clientY:250});
  h.selector.layer.emit('pointermove',{clientX:100,clientY:50});
  h.selector.layer.emit('pointerup',{clientX:100,clientY:50});
  assert.deepEqual(h.draws[0],[200,100,400,400,0,0,400,400]);assert.equal(h.saved.length,1);assert.equal(h.selector.opened,false);
  assert.equal(h.saved[0].data,'data:image/png;base64,AAAA');
});
test('tiny selection and cancellation never save; full viewport uses all pixels',async()=>{
  const h=harness();await h.open();
  h.selector.layer.emit('pointerdown',{clientX:100,clientY:100});h.selector.layer.emit('pointerup',{clientX:101,clientY:101});
  assert.equal(h.saved.length,0);assert.equal(h.selector.opened,true);
  h.selector.cancel.emit('click');assert.equal(h.selector.opened,false);assert.equal(h.saved.length,0);
  await h.open();h.selector.full.emit('click');assert.deepEqual(h.draws[0],[0,0,2000,1400,0,0,2000,1400]);assert.equal(h.saved.length,1);
});
test('encoding failures keep selector open to retry and never deliver bad screenshot data',async()=>{
  const h=harness({encodeError:true});await h.open();h.selector.full.emit('click');
  assert.equal(h.saved.length,0);assert.equal(h.errors[0].message,'encoding failed');assert.equal(h.selector.opened,true);assert.equal(h.selector.busy,false);
  await assert.rejects(h.selector.open('https://example.test/pic.png',{width:1000,height:700}));
});
