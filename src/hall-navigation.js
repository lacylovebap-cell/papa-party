import {canonicalPublicHome} from './public-route-location.js';
import {PUBLIC_SITE_ORIGIN} from './public-links.js';

const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\u0000-\u001f\u007f]/.test(value);
const name=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);

// Read one already-public hall only when requested. Neither a Space ID nor a
// streamer name is used to infer a hall's identity, label or URL.
export function createHallNavigation({api,origin=PUBLIC_SITE_ORIGIN,now=Date.now,ttl=300000}={}){
 const cache=new Map(),pending=new Map();let generation=0;
 const peek=spaceId=>{const hit=cache.get(spaceId);return hit&&now()-hit.at<ttl?hit.value:undefined;};
 async function get(spaceId){
  if(!identity(spaceId))return null;
  const hit=peek(spaceId);if(hit!==undefined)return hit;
  if(pending.has(spaceId))return pending.get(spaceId);
  const turn=generation,request=Promise.resolve().then(()=>api({op:'publicAppHome',v:1,kind:'hall',spaceId,streamerId:null})).then(row=>{
   if(turn!==generation)return null;
   if(row!==null&&(row?.active!==true||row.kind!=='hall'||row.spaceId!==spaceId||row.streamerId!==null||!name(row.name)))throw Error('所屬廳資料尚未確認');
   const url=row?.canonicalPath?canonicalPublicHome(origin,row.canonicalPath):null;
   if(row?.canonicalPath&&!url)throw Error('所屬廳網址尚未確認');
   const value=url?Object.freeze({spaceId,name:row.name.trim(),canonicalPath:row.canonicalPath,url}):null;
   cache.set(spaceId,{at:now(),value});if(cache.size>16)cache.delete(cache.keys().next().value);
   return value;
  }).finally(()=>{if(pending.get(spaceId)===request)pending.delete(spaceId);});
  pending.set(spaceId,request);return request;
 }
 return {get,peek,invalidate(){generation++;cache.clear();pending.clear();}};
}
