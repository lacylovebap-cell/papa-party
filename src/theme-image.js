// Browser-side image preparation: resize per role, encode WebP (alpha kept),
// and step quality down only until the role's target size is met. Nothing is
// uploaded here; the editor previews the compressed blob locally.
import {THEME_IMAGE_ROLES} from './theme-engine.js?v=10.28-UI.2';

// Hard ceilings mirror the Edge upload limits.
export const THEME_UPLOAD_LIMIT={background:900*1024,banner:800*1024,card:600*1024,decor:500*1024};
const themeQualities=[.86,.8,.74,.68,.62];

function themeCanvasBlobNative(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('圖片壓縮失敗')),'image/webp',quality));}
// iPhone/iPad browsers (all WebKit) can read WebP but their canvas cannot write
// it. Only there, a WebAssembly build of libwebp (~320 KB, cached by the
// browser) is loaded on first use; other devices never download it.
let themeNativeWebp=null,themeWasmEncoder=null;
async function themeCanWriteWebp(){
 if(themeNativeWebp===null){try{const c=document.createElement('canvas');c.width=c.height=1;const b=await themeCanvasBlobNative(c,.8);themeNativeWebp=b.type==='image/webp';}catch{themeNativeWebp=false;}}
 return themeNativeWebp;
}
function themeLoadWasmEncoder(){
 themeWasmEncoder??=import('./vendor/webp-enc/webp_enc.js').then(m=>m.default({noInitialRun:true})).catch(error=>{themeWasmEncoder=null;throw error;});
 return themeWasmEncoder;
}
export const THEME_WASM_WEBP_OPTIONS={quality:75,target_size:0,target_PSNR:0,method:4,sns_strength:50,filter_strength:60,filter_sharpness:0,filter_type:1,partitions:0,segments:4,pass:1,show_compressed:0,preprocessing:0,autofilter:0,partition_limit:0,alpha_compression:1,alpha_filtering:1,alpha_quality:100,lossless:0,exact:0,image_hint:0,emulate_jpeg_size:0,thread_level:0,low_memory:0,near_lossless:100,use_delta_palette:0,use_sharp_yuv:0};
async function themeCanvasBlob(canvas,quality){
 if(await themeCanWriteWebp())return themeCanvasBlobNative(canvas,quality);
 const encoder=await themeLoadWasmEncoder().catch(()=>{throw Error('圖片轉檔工具載入失敗，請確認網路後再試一次');});
 const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
 const out=encoder.encode(pixels.data,canvas.width,canvas.height,{...THEME_WASM_WEBP_OPTIONS,quality:Math.round(quality*100)});
 if(!out)throw Error('圖片壓縮失敗');
 return new Blob([out],{type:'image/webp'});
}
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
    if(blob.type!=='image/webp')throw Error('圖片轉檔失敗，請再試一次');
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
