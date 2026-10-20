// Installation hints contain public stable IDs only. They are never an account,
// a permission, or a mutable URL. The launch resolver verifies them again.
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
const MAX_TOKEN=1024;

export function normalizeInstallSource(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!['hall','streamer'].includes(value.kind)||!identity(value.spaceId)||value.v!==undefined&&value.v!==1)return null;
 const streamerId=value.kind==='hall'?null:value.streamerId;
 if(value.kind==='hall'&&value.streamerId!=null||value.kind==='streamer'&&!identity(streamerId))return null;
 return {v:1,kind:value.kind,spaceId:value.spaceId,streamerId};
}
export function encodeInstallSource(value){
 const source=normalizeInstallSource(value);if(!source)return null;
 try{const bytes=new TextEncoder().encode(JSON.stringify(source));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const token=btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');return token.length<=MAX_TOKEN?token:null;}catch{return null;}
}
export function decodeInstallSource(token){
 if(typeof token!=='string'||!token.length||token.length>MAX_TOKEN||!/^[A-Za-z0-9_-]+$/.test(token)||token.length%4===1)return null;
 try{const binary=atob(token.replaceAll('-','+').replaceAll('_','/')),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0)),raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.v!==1||Object.keys(raw).some(key=>!['v','kind','spaceId','streamerId'].includes(key)))return null;
  const value=normalizeInstallSource(raw);return value&&encodeInstallSource(value)===token?value:null;
 }catch{return null;}
}

// Use a real same-origin manifest URL: iOS installation may start in an isolated
// store where the browser's pre-install localStorage does not exist.
export function installManifestUrl({source=null,mountUrl=globalThis.location?.origin+'/'}={}){
 try{const mount=new URL(mountUrl);if(!['http:','https:'].includes(mount.protocol)||mount.username||mount.password||mount.search||mount.hash)return null;
  const url=new URL('manifest.webmanifest',mount),token=encodeInstallSource(source);if(token)url.searchParams.set('install',token);return url.href;
 }catch{return null;}
}
export function prepareInstallManifest({document=globalThis.document,source=null,mountUrl=globalThis.location?.origin+'/'}={}){
 const href=installManifestUrl({source,mountUrl});if(!href||!document)return null;
 try{const base=new URL(document.baseURI||mountUrl);if(new URL(href).origin!==base.origin)return null;
  let link=document.querySelector?.('link[rel="manifest"]');
  if(!link){if(!document.createElement||!document.head?.appendChild)return null;link=document.createElement('link');link.setAttribute('rel','manifest');document.head.appendChild(link);}
  if(link.getAttribute?.('href')!==href)link.setAttribute('href',href);return href;
 }catch{return null;}
}
