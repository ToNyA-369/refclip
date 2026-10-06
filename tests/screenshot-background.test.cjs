const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({url='https://site.test/',enabled=true,prepareError,showError,captureError,switchOnCapture=false}={}) {
  let listener,activeId=7,captureCount=0,release;
  const messages=[],local={},badges=[];
  const tab={id:7,windowId:3,url};
  const chrome={
    commands:{onCommand:{addListener:fn=>listener=fn}},
    storage:{local:{get:async()=>({settings:{enabled}}),set:async value=>Object.assign(local,value)}},
    windows:{get:async()=>({focused:true})},
    action:{setBadgeText:async value=>badges.push(value.text),setTitle:async()=>{}},
    tabs:{query:async()=>[{...tab,id:activeId}],sendMessage:async(id,message,options)=>{
      messages.push({id,message,options});
      if(message.type==='SCREENSHOT_PREPARE')return prepareError?{ok:false,error:prepareError}:{ok:true,viewport:{width:1000,height:700,x:0,y:0}};
      if(message.type==='SCREENSHOT_SHOW')return showError?{ok:false,error:showError}:{ok:true};
    },captureVisibleTab:async(windowId,options)=>{
      captureCount++;assert.equal(windowId,3);assert.equal(options.format,'png');
      if(captureError)throw new Error(captureError);
      if(switchOnCapture)activeId=8;
      if(release)await new Promise(resolve=>release.resolve=resolve);
      return 'data:image/png;base64,AAAA';
    }}
  };
  const context=vm.createContext({chrome,console,Date});
  for(const file of ['shared.js','screenshot-background.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return {messages,local,badges,command:(command='capture-image')=>listener(command,tab),count:()=>captureCount,hold:()=>{release={};},release:()=>release.resolve()};
}
test('shortcut captures PNG only after preparation, then opens top-frame selector and releases UI',async()=>{
  const h=harness();h.command();await tick();
  assert.equal(h.count(),1);assert.deepEqual(h.messages.map(x=>x.message.type),['SCREENSHOT_PREPARE','SCREENSHOT_SHOW','SCREENSHOT_RELEASE']);
  assert.ok(h.messages.every(x=>x.id===7&&x.options.frameId===0));assert.equal(h.messages[1].message.image,'data:image/png;base64,AAAA');
});
test('paused, unsupported and already editing pages do not capture and record understandable errors',async()=>{
  for(const config of [{enabled:false},{url:'chrome://settings/'},{prepareError:'請先完成目前表單'}]){
    const h=harness(config);h.command();await tick();assert.equal(h.count(),0);assert.equal(h.local.lastResult.ok,false);assert.deepEqual(h.badges,['!']);
  }
});
test('capture rejection and tab switches never deliver an image; prepared UI is always released',async()=>{
  for(const config of [{captureError:'capture denied'},{switchOnCapture:true}]){
    const h=harness(config);h.command();await tick();assert.equal(h.messages.some(x=>x.message.type==='SCREENSHOT_SHOW'),false);
    assert.equal(h.messages.at(-1).message.type,'SCREENSHOT_RELEASE');assert.equal(h.local.lastResult.ok,false);
  }
});
test('duplicate shortcuts serialize capture per tab and unrelated commands have no effect',async()=>{
  const h=harness();h.command('other');assert.equal(h.count(),0);
  h.hold();h.command();await tick();h.command();await tick();assert.equal(h.count(),1);
  h.release();await tick();assert.equal(h.messages.filter(x=>x.message.type==='SCREENSHOT_SHOW').length,1);
});
