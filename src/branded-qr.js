import {QrCode,QrSegment} from './vendor/qrcodegen.js';

export const OFFICIAL_LOGO_URL=new URL('../assets/pa-party-approved.png',import.meta.url);
const PUBLIC_ORIGIN='https://paparty.app';
const RESERVED=new Set(['admin','login','api','auth','settings','index.html','v2.html','preview.html','lobby.html','assets','src','supabase','songs','songbook','book','common-book','player','center','gallery','home','cards','cardwall','achievements','queue','history']);

/** Only a resolved public homepage is accepted. Never encode current navigation/auth state. */
export function publicShareUrl(value){
 let url;try{url=new URL(String(value));}catch{throw Error('請先取得有效的公開首頁網址');}
 const segments=url.pathname.split('/').filter(Boolean);
 if(url.origin!==PUBLIC_ORIGIN||url.username||url.password||url.search||url.hash||
    segments.length<1||segments.length>2||url.href.length>260||segments.some(x=>!/^[-A-Za-z0-9_.]+$/.test(x)||x==='.'||x==='..'||RESERVED.has(x.toLowerCase())))
  throw Error('分享網址必須是公開首頁，不能包含管理路徑或登入資料');
 return url.href.replace(/\/$/,'');
}

export function publicQrSymbol(value){
 const url=publicShareUrl(value),segments=QrSegment.makeSegments(url);
 let qr=QrCode.encodeSegments(segments,QrCode.Ecc.HIGH);
 // Versions 7–13 have an alignment pattern in the centre. Versions 14–20
 // leave a clear centre for the small official logo, without covering that pattern.
 if(qr.version>=7&&qr.version<=13)qr=QrCode.encodeSegments(segments,QrCode.Ecc.HIGH,14,20);
 if(qr.version>20)throw Error('網址過長，請使用較短的專屬首頁網址');
 const modules=Array.from({length:qr.size},(_,y)=>Array.from({length:qr.size},(_,x)=>qr.getModule(x,y)));
 return {url,modules,size:qr.size,version:qr.version,quietZone:4,errorCorrection:'H',logoRatio:.16};
}

/** Exact existing approved dark-logo crop; original image bytes are embedded, not replaced. */
export function brandedQrSvg(value,{logoDataUrl,size=1024,branded=true}={}){
 if(!Number.isInteger(size)||size<128||size>4096)throw Error('QR 圖片尺寸不正確');
 if(branded&&!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(logoDataUrl||''))throw Error('官方 LOGO 尚未載入');
 const qr=publicQrSymbol(value),border=qr.quietZone,total=qr.size+border*2;
 let path='';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.modules[y][x])path+=`M${x+border},${y+border}h1v1h-1z`;
 const width=qr.size*qr.logoRatio,left=(total-width)/2,pad=.45;
 const logo=branded?`<rect x="${left-pad}" y="${left-pad}" width="${width+pad*2}" height="${width+pad*2}" rx=".5" fill="#fff"/><svg x="${left}" y="${left}" width="${width}" height="${width}" viewBox="818 270 568 472" preserveAspectRatio="xMidYMid meet"><image width="1448" height="1086" href="${logoDataUrl}"/></svg>`:'';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" role="img" aria-label="PA Party 公開首頁 QR Code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000" shape-rendering="crispEdges"/>${logo}</svg>`;
}

let officialLogoPromise;
export function loadOfficialLogo({fetchImpl=globalThis.fetch}={}){
 if(!officialLogoPromise)officialLogoPromise=(async()=>{
  const response=await fetchImpl(OFFICIAL_LOGO_URL,{cache:'force-cache'});
  if(!response.ok)throw Error('官方 LOGO 載入失敗，請重試');
  const bytes=new Uint8Array(await response.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return 'data:image/png;base64,'+btoa(binary);
 })().catch(error=>{officialLogoPromise=undefined;throw error;});
 return officialLogoPromise;
}

export async function renderBrandedQr(value,{document=globalThis.document,ImageImpl=globalThis.Image,URLImpl=globalThis.URL,loadLogo=loadOfficialLogo,size=1024}={}){
 const logoDataUrl=await loadLogo(),svg=brandedQrSvg(value,{logoDataUrl,size}),svgBlob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
 const objectUrl=URLImpl.createObjectURL(svgBlob);
 try{
  const image=await new Promise((resolve,reject)=>{const node=new ImageImpl();node.onload=()=>resolve(node);node.onerror=()=>reject(Error('QR 圖片產生失敗，請重試'));node.src=objectUrl;});
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
  const context=canvas.getContext('2d');if(!context)throw Error('此裝置無法產生 PNG，請使用 SVG');
  context.fillStyle='#fff';context.fillRect(0,0,size,size);context.drawImage(image,0,0,size,size);
  const pngBlob=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG 產生失敗，請重試')),'image/png'));
  return {svg,svgBlob,pngBlob,url:publicShareUrl(value)};
 }catch(error){
  // SVG remains a complete local, printable QR even on browsers without canvas PNG export.
  return {svg,svgBlob,pngBlob:null,url:publicShareUrl(value),warning:error.message||'PNG 暫時無法產生，請下載 SVG'};
 }finally{URLImpl.revokeObjectURL(objectUrl);}
}
