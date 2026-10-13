export const CARD_FIELDS={description:'簡述',player:'玩家名稱',time:'展示時間',id:'卡片 ID'};
export const cardDisplay=c=>Object.fromEntries(Object.keys(CARD_FIELDS).map(k=>[k,typeof c.displayFields?.[k]==='boolean'?c.displayFields[k]:['description','time'].includes(k)]));
export const orderedCards=rows=>rows.map((row,i)=>({row,i,rank:Number.isFinite(row.sort_order)?row.sort_order:i})).sort((a,b)=>a.rank-b.rank||a.i-b.i).map(x=>x.row);
export function cardMediaInput(payload,old={}){
 const mediaType=payload.mediaType??old.mediaType??'image';if(!['image','video'].includes(mediaType))throw Error('卡片類型不正確');
 const displayFields=payload.displayFields??old.displayFields??cardDisplay(old);
 if(!displayFields||typeof displayFields!=='object'||Array.isArray(displayFields)||Object.entries(displayFields).some(([k,v])=>!Object.hasOwn(CARD_FIELDS,k)||typeof v!=='boolean'))throw Error('卡片顯示欄位不正確');
 for(const value of [payload.url,payload.thumbnail||payload.url]){let u;try{u=new URL(value);}catch{throw Error('請先上傳卡片');}if(u.protocol!=='https:'||u.username||u.password)throw Error('卡片網址不正確');}
 return {mediaType,displayFields:cardDisplay({displayFields})};
}
export function validCardUpload(bytes,mime){
 if(!(bytes instanceof Uint8Array)||bytes.length===0)return false;
 if(mime==='video/mp4')return bytes.length>=12&&String.fromCharCode(...bytes.subarray(4,8))==='ftyp'&&bytes.length<=20*1024*1024;
 if(mime==='video/webm')return bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3&&bytes.length<=20*1024*1024;
 return false;
}
