// Browser-side image preparation: resize per role, encode WebP (alpha kept),
// and step quality down only until the role's target size is met. Nothing is
// uploaded here; the editor previews the compressed blob locally.
import {THEME_IMAGE_ROLES} from './theme-engine.js?v=10.28-THEME.1';

// Hard ceilings mirror the Edge upload limits.
export const THEME_UPLOAD_LIMIT={background:900*1024,banner:800*1024,card:600*1024,decor:500*1024};
const themeQualities=[.86,.8,.74,.68,.62];

function themeCanvasBlob(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('圖片壓縮失敗')),'image/webp',quality));}
export async function themeSha256(blob){const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function themeCompressImage(file,role){
 const spec=THEME_IMAGE_ROLES[role];
 if(!spec)throw Error('圖片用途不正確');
 if(!file||!/^image\/(png|webp|jpeg|jpg|gif|avif|heic|heif)$/i.test(file.type||''))throw Error('請選擇 PNG、WebP 或 JPG 圖片');
 if(file.size>40*1024*1024)throw Error('原始圖片超過 40 MB，請先縮小再上傳');
 const bitmap=await createImageBitmap(file).catch(()=>{throw Error('無法讀取這張圖片，請改用 PNG、WebP 或 JPG');});
 const sourceWidth=bitmap.width,sourceHeight=bitmap.height;
 // An already-small WebP within the size limit is kept byte-for-byte.
 if(file.type==='image/webp'&&file.size<=spec.targetKB*1024&&Math.max(sourceWidth,sourceHeight)<=spec.max){bitmap.close?.();return themePrepared({blob:file.slice(0,file.size,'image/webp'),width:sourceWidth,height:sourceHeight,quality:1},file,sourceWidth,sourceHeight,true);}
 let scale=Math.min(1,spec.max/Math.max(sourceWidth,sourceHeight)),best=null;
 try{
  for(let attempt=0;attempt<4;attempt++){
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sourceWidth*scale));canvas.height=Math.max(1,Math.round(sourceHeight*scale));
   const ctx=canvas.getContext('2d',{alpha:true});ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const q of themeQualities){
    const blob=await themeCanvasBlob(canvas,q);
    if(blob.type!=='image/webp')throw Error('此瀏覽器無法轉成 WebP，請改用新版 Chrome、Edge 或 Safari');
    best={blob,width:canvas.width,height:canvas.height,quality:q};
    if(blob.size<=spec.targetKB*1024)return themePrepared(best,file,sourceWidth,sourceHeight,true);
   }
   // Quality floor reached: accept it if under the ceiling, otherwise shrink.
   if(best.blob.size<=THEME_UPLOAD_LIMIT[role])return themePrepared(best,file,sourceWidth,sourceHeight,false);
   scale*=.82;
  }
 }finally{bitmap.close?.();}
 throw Error('圖片內容太複雜，壓縮後仍過大，請換一張或先裁小');
}
async function themePrepared(best,file,sourceWidth,sourceHeight,onTarget){
 return {blob:best.blob,bytes:best.blob.size,width:best.width,height:best.height,quality:best.quality,onTarget,
  originalBytes:file.size,sourceWidth,sourceHeight,hash:await themeSha256(best.blob),localUrl:URL.createObjectURL(best.blob)};
}
export function themeBlobBase64(blob){
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('讀取壓縮圖片失敗'));reader.readAsDataURL(blob);});
}
export const themeKB=bytes=>bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
