import {publicShareUrl,renderBrandedQr} from './branded-qr.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const filename=name=>'PA-Party-'+String(name||'share').replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,60)+'-QR';

/** Same dialog for visitors, players and managers. The caller resolves the viewed public homepage. */
export function createPublicShare({modal,toast=()=>{},document=globalThis.document,navigator=globalThis.navigator,
 URLImpl=globalThis.URL,FileImpl=globalThis.File,renderQr=renderBrandedQr,setTimer=globalThis.setTimeout}={}){
 let generation=0,cleanup=()=>{};
 async function open({name,url,kind='streamer'}){
  const canonical=publicShareUrl(url),title=kind==='hall'?'分享'+name+'大廳':'分享【'+name+'】的首頁';
  cleanup();const turn=++generation;
  modal(title,`<section class="public-share" aria-label="公開首頁分享"><p class="public-share-name">${escape(name)}</p><div class="public-share-qr" data-share-preview><p role="status">QR Code 產生中…</p></div><label class="public-share-link">公開網址<input data-share-url value="${escape(canonical)}" readonly aria-label="公開首頁網址"></label><div class="public-share-actions"><button type="button" data-share-copy>複製網址</button><button type="button" data-share-png disabled>儲存 QR</button><button type="button" class="primary" data-share-native disabled>分享出去</button></div><div class="public-share-secondary"><button type="button" data-share-svg disabled>下載 SVG</button><a data-share-image hidden target="_blank" rel="noopener">開啟圖片另存</a></div><p class="public-share-status" data-share-status role="status" aria-live="polite"></p><p class="public-share-tip">手機若無法直接下載，可開啟圖片後長按儲存。</p></section>`);
  const dialog=document.querySelector('#dialog'),panel=dialog?.querySelector('.public-share');
  if(!panel)throw Error('分享視窗無法開啟');
  const get=selector=>panel.querySelector(selector),status=get('[data-share-status]');let current=true,artifact,busy=false;
  const ownedUrls=new Set(),active=()=>current&&turn===generation&&panel.isConnected!==false&&dialog.open!==false;
  const own=blob=>{const value=URLImpl.createObjectURL(blob);ownedUrls.add(value);return value;};
  const say=value=>{if(active())status.textContent=value;};
  cleanup=()=>{current=false;dialog.removeEventListener('close',close);for(const value of ownedUrls)URLImpl.revokeObjectURL(value);ownedUrls.clear();};
  function close(){cleanup();}dialog.addEventListener('close',close,{once:true});
  async function copy(){
   let copied=false;try{if(navigator?.clipboard?.writeText){await navigator.clipboard.writeText(canonical);copied=true;}}catch{}
   if(!copied&&active()){const input=get('[data-share-url]');input.focus();input.select();try{copied=document.execCommand?.('copy')===true;}catch{}}
   if(copied){say('已複製');if(active())get('[data-share-copy]').textContent='已複製';toast('已複製');}
   else say('請長按或選取上方網址複製');return copied;
  }
  function download(blob,extension){
   if(!blob||!active())return false;
   const anchor=document.createElement('a');anchor.href=own(blob);anchor.download=filename(name)+'.'+extension;anchor.hidden=true;
   document.body.append(anchor);try{anchor.click();say('已準備下載；若未儲存，請開啟圖片後另存。');}finally{anchor.remove();}
   // Keep the preview URL alive until dialog close; downloads get a short bounded lifetime.
   const href=anchor.href;setTimer(()=>{if(ownedUrls.delete(href))URLImpl.revokeObjectURL(href);},30000);return true;
  }
  async function share(){
   if(busy||!active())return;busy=true;
   const payload={title,text:title,url:canonical};
   try{
    if(typeof navigator?.share!=='function'){await copy();return 'copied';}
    let file;try{if(artifact?.pngBlob&&FileImpl){file=new FileImpl([artifact.pngBlob],filename(name)+'.png',{type:'image/png'});}}catch{}
    let imageSupported=false;try{imageSupported=!!file&&navigator.canShare?.({files:[file]})===true;}catch{}
    if(imageSupported){
     try{await navigator.share({...payload,files:[file]});say('已開啟分享');return 'shared-image';}
     catch(error){if(error?.name==='AbortError')return 'cancelled';if(!['TypeError','NotSupportedError','DataError'].includes(error?.name))throw error;}
    }
    await navigator.share(payload);say('已開啟分享');return 'shared-link';
   }catch(error){if(error?.name==='AbortError')return 'cancelled';await copy();say('此裝置暫時無法分享，請複製上方網址。');return 'fallback';}
   finally{busy=false;}
  }
  get('[data-share-copy]').onclick=copy;
  get('[data-share-native]').onclick=share;
  get('[data-share-png]').onclick=()=>download(artifact?.pngBlob,'png');
  get('[data-share-svg]').onclick=()=>download(artifact?.svgBlob,'svg');
  try{
   artifact=await renderQr(canonical,{document,URLImpl});if(!active())return;
   const pngUrl=own(artifact.pngBlob||artifact.svgBlob),preview=get('[data-share-preview]'),image=document.createElement('img');
   image.src=pngUrl;image.alt=name+'的 PA Party 官方 LOGO QR Code';image.width=1024;image.height=1024;preview.replaceChildren(image);
   const alternative=get('[data-share-image]');alternative.href=pngUrl;alternative.hidden=false;
   for(const selector of ['[data-share-svg]','[data-share-native]'])get(selector).disabled=false;
   get('[data-share-png]').disabled=!artifact.pngBlob;if(artifact.warning)say('PNG 暫時無法產生，可下載 SVG 或複製網址分享。');
  }catch(error){if(active()){get('[data-share-preview]').textContent='QR Code 暫時無法產生';get('[data-share-native]').disabled=false;say(error.message||'請複製公開網址分享');}}
  return {copy,share,downloadPng:()=>download(artifact?.pngBlob,'png'),downloadSvg:()=>download(artifact?.svgBlob,'svg'),url:canonical};
 }
 return {open,dispose(){generation++;cleanup();}};
}
