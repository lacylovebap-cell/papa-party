export const HOME_MODULES={hero:'本日狀態與主圖',search:'點歌查詢',fresh:'新練歌曲',fate:'抽歌',credits:'我的存歌',popular:'熱門點歌',recommendations:'為你推薦',crowns:'冠歌',ranking:'存歌排行榜',cards:'卡片牆',wishes:'許願池',recap:'本晚回顧',manual:'說明書'};
export const HERO_FIELDS={title:'首頁標題',subtitle:'副標題',status:'目前狀態',message:'自訂一句話',nowPlaying:'目前待播歌曲',preparation:'準備時間',hour:'本小時提歌額度',sung:'本場已唱次數',queue:'待播數量'};
const ordered=(input,keys)=>[...new Set([...(Array.isArray(input)?input:[]).filter(x=>keys.includes(x)),...keys])];
export function normalizeHome(input){
 const v=input&&typeof input==='object'&&!Array.isArray(input)?input:{},keys=Object.keys(HOME_MODULES),fields=Object.keys(HERO_FIELDS);
 return {color:/^#[0-9a-f]{6}$/i.test(v.color||'')?v.color:'#a886cc',imageMode:['default','custom','none'].includes(v.imageMode)?v.imageMode:'default',imageUrl:typeof v.imageUrl==='string'&&/^https:\/\//.test(v.imageUrl)?v.imageUrl:'',title:String(v.title||'').slice(0,80),subtitle:String(v.subtitle||'').slice(0,160),statusText:String(v.statusText||'').slice(0,80),message:String(v.message||'').slice(0,240),order:ordered(v.order,keys),visible:Object.fromEntries(keys.map(k=>[k,v.visible?.[k]!==false])),fieldOrder:ordered(v.fieldOrder,fields),fields:Object.fromEntries(fields.map(k=>[k,typeof v.fields?.[k]==='boolean'?v.fields[k]:!['sung','queue'].includes(k)]))};
}
export function validateHome(value){
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('首頁設定格式不正確');
 if(!/^#[0-9a-f]{6}$/i.test(value.color||''))throw Error('請選有效的主題顏色');
 if(!['default','custom','none'].includes(value.imageMode))throw Error('請選主圖顯示方式');
 if(String(value.imageUrl||'').length>2048)throw Error('主圖網址過長，請重新上傳圖片');
 if(value.imageMode==='custom'){try{const u=new URL(value.imageUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{throw Error('請先上傳或填寫有效的 HTTPS 主圖網址');}}
 return normalizeHome(value);
}
export function themePalette(color){
 const rgb=normalizeHome({color}).color.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)),mix=(ratio,base)=>'#'+rgb.map(n=>Math.round(n*ratio+base*(1-ratio)).toString(16).padStart(2,'0')).join('');
 return {accent:mix(.65,255),button:mix(.45,0),panel:mix(.12,15),background:mix(.04,8),line:mix(.22,25),glow:mix(.2,12)};
}
