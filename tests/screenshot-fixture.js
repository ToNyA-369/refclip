globalThis.chrome={storage:{local:{get:async()=>({tagHistory:{subjects:['山景','河流']}})}}};
const root=document.querySelector('#host').attachShadow({mode:'open'});
const editor=new ShakeSaveTagEditor(root,async(url,tags,categories)=>{
  const image=new Image();image.src=url;await image.decode();
  document.querySelector('#result').textContent=`${image.naturalWidth} × ${image.naturalHeight}\n${ShakeSave.taggedFilename(url,'image/png',tags,undefined,categories)}`;
  return true;
});
const shot=new ShakeSaveScreenshot(root,(data,rect)=>editor.open(data,rect.left+rect.width/2,rect.top+rect.height/2,{previewMode:'open'}),error=>{document.querySelector('#result').textContent=error.message;});
document.querySelector('#capture').onclick=async()=>{
  const canvas=document.createElement('canvas');canvas.width=innerWidth*2;canvas.height=innerHeight*2;
  const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#f6f7f3';ctx.fillRect(0,0,innerWidth,innerHeight);
  ctx.fillStyle='#335d46';ctx.font='24px system-ui';ctx.fillText('截圖測試：拖曳框選後加入標籤',40,55);
  const image=document.querySelector('img');await image.decode();ctx.drawImage(image,40,100,480,320);
  await shot.open(canvas.toDataURL('image/png'),{width:innerWidth,height:innerHeight});
};
