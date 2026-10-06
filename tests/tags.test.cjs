const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../shared.js');
const raw = globalThis.ShakeSave;
// Explicit platform keeps filename contracts deterministic on both CI runners.
const S = {...raw,
  tagStem:(input,schema,os='win')=>raw.tagStem(input,schema,os),
  taggedFilename:(url,mime,input,date,schema,os='win')=>raw.taggedFilename(url,mime,input,date,schema,os)
};
test('settings migrate existing users and retain category order, wrappers and preview preference',()=>{
  assert.equal(S.settings({folder:'Art'}).categories.length,4);
  const schema=[{id:'color',label:'色彩',prefix:'{',suffix:'}',kind:'tags'},{id:'note',label:'觀察',prefix:'',suffix:'',kind:'text'}];
  const settings=S.settings({categories:schema,previewMode:'hidden',holdMs:450});
  assert.deepEqual(S.settings(settings),settings);assert.equal(settings.previewMode,'hidden');
  assert.equal(S.taggedFilename('https://test/x.png','image/png',{color:'暖色 冷色',note:'light  and shadow'},undefined,schema),'{暖色} {冷色} light  and shadow.png');
  assert.equal(S.tagStem({color:'A'},[{...schema[0],prefix:'<',suffix:'>'}],'mac'),'<A>');
  assert.throws(()=>S.tagStem({color:'A'},[{...schema[0],prefix:'<',suffix:'>'}],'win'),/前後綴/);
  assert.throws(()=>S.tagStem({note:'NUL'},[schema[1]]),/保留名稱/);
});
test('custom affixes are preserved literally; platform-forbidden characters are rejected instead of converted',()=>{
  const schema=[{id:'note',label:'描述',prefix:"'(",suffix:")'",kind:'text'}];
  assert.equal(S.tagStem({note:'one two'},schema,'win'),"'(one two)'");
  const quotes=[{...schema[0],prefix:'"',suffix:'"'}];
  assert.equal(S.tagStem({note:'one two'},quotes,'mac'),'"one two"');
  assert.throws(()=>S.validateAffixes(quotes,'win'),/Windows/);
  assert.throws(()=>S.validateAffixes([{...schema[0],prefix:'../'}],'mac'),/分隔/);
  assert.equal(S.tagStem({note:'x'},[{...schema[0],prefix:'(',suffix:'). '}],'win'),'(x). ');
  assert.throws(()=>S.tagStem({note:'圖'.repeat(80)},[{...schema[0],prefix:'',suffix:''}],'mac'),/230/);
});
test('invalid category schemas cannot supply duplicate IDs, excessive fields or control characters',()=>{
  const c=S.categories()[0];
  for(const schema of [[],Array(13).fill(c),[c,c],[{...c,id:'__proto__'}],[{...c,label:''}],[{...c,prefix:'\n'}],[{...c,kind:'script'}]]) assert.throws(()=>S.categories(schema));
});
test('custom history is isolated and survives saves from older open forms',()=>{
  const schema=[{id:'color',label:'色彩',prefix:'',suffix:'',kind:'tags'},{id:'note',label:'觀察',prefix:'',suffix:'',kind:'text'}];
  const history=S.mergeHistory({artist:['Alice'],color:['暖光'],note:['old']},{color:'暖色',note:'private'},schema);
  assert.deepEqual(history.artist,['Alice']);assert.equal(history.note,undefined);
  assert.deepEqual(S.suggestions(history,'color','暖',1,schema),['暖色','暖光']);
  assert.deepEqual(S.mergeHistory(history,{artist:'Bob'}).color,['暖色','暖光']);
});
test('tag filename follows the four fields and uses Windows-safe separators', () => {
  assert.equal(S.taggedFilename('https://test/x.jpg', 'image/png', {artist:'繪師名',subjects:'人物 頭',styles:'手繪',descriptions:'鼻子的畫法很漂亮'}), '@繪師名 [人物] [頭] #手繪 ＂鼻子的畫法很漂亮＂.png');
  assert.equal(S.tagStem({artist:'Artist Name',subjects:'人物\t頭 人物',styles:'手繪 水彩',descriptions:'鼻子漂亮 光影好'}), '@Artist @Name [人物] [頭] #手繪 #水彩 ＂鼻子漂亮 光影好＂');
  const name = S.taggedFilename('https://test/no-ext', '', {artist:'A/B',subjects:'<頭>',styles:'a:b',descriptions:'"hi"'});
  assert.doesNotMatch(name, /[<>:"/\\|?*\x00-\x1f]/); assert.match(name, /\.image$/);
  assert.equal(S.tagStem({artist:'name.'}), '@name．');
});
test('empty tags retain original naming, excess length and nonstring inputs are rejected', () => {
  const date = new Date('2026-10-06T01:02:03Z');
  assert.equal(S.taggedFilename('https://test/x.gif','image/gif',{},date), S.filename('https://test/x.gif','image/gif',date));
  assert.throws(() => S.tagStem({descriptions:'圖'.repeat(110)}), /110/);
  assert.throws(() => S.tags({artist:['bad']}));
});
test('prefix history is scoped to each field, recent first, bounded, excludes descriptions', () => {
  const h = S.mergeHistory({artist:['Alice'],subjects:['人物','頭髮'],styles:['手繪']}, {artist:'Bob',subjects:'頭 人物',styles:'手繪 水彩',descriptions:'private'});
  assert.deepEqual(h.artist,['Bob','Alice']); assert.deepEqual(h.subjects,['頭','人物','頭髮']); assert.equal(h.descriptions,undefined);
  assert.deepEqual(S.suggestions(h,'artist','al',2),['Alice']);
  assert.deepEqual(S.suggestions(h,'subjects','人物 頭',4),['頭髮']);
  assert.deepEqual(S.suggestions(h,'descriptions','pri',3),[]);
  assert.equal(S.mergeHistory({subjects:Array.from({length:600},(_,i)=>`tag${i}`)},{}).subjects.length,500);
});
test('completion replaces the token under the caret; positioning clamps at edges', () => {
  assert.deepEqual(S.tokenRange('人物 hea 身體',6), {start:3,end:6,prefix:'hea'});
  assert.deepEqual(S.tokenRange('Artist Name',4,true), {start:0,end:11,prefix:'Artist Name'});
  assert.deepEqual(S.placement(500,400,264,154,1000,800), {left:368,top:323});
  assert.deepEqual(S.placement(999,799,264,154,1000,800), {left:728,top:638});
});
test('artist history from older versions splits into individual names; descriptions preserve spaces and repetition', () => {
  const h = S.mergeHistory({artist:['Alice Bob','王 小明']},{artist:'Alice Carol'});
  assert.deepEqual(h.artist,['Alice','Carol','Bob','王','小明']);
  assert.deepEqual(S.suggestions({artist:['Alice Bob','Boris']},'artist','Alice Bo',8),['Bob','Boris']);
  assert.equal(S.tagStem({descriptions:'鼻子  很漂亮 鼻子'}),'＂鼻子  很漂亮 鼻子＂');
});
