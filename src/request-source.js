export const REQUEST_SOURCES=new Set(['manual','self','draw','cross_self','cross_draw','proxy_draw']);
export function requestSource(payload,{playerSide=true}={}){
 if(payload.selfProvided!==undefined&&typeof payload.selfProvided!=='boolean')throw Error('自帶設定不正確');
 let source=payload.source??(payload.selfProvided?'self':'manual');
 if(!REQUEST_SOURCES.has(source))throw Error('歌曲來源不正確');
 if(source==='manual'&&payload.selfProvided)source='self';
 if(!playerSide&&['draw','cross_draw'].includes(source))source='proxy_draw';
 return {source,selfProvided:source!=='manual'};
}
export function requestSourceLabel(row){
 if(!row.selfProvided)return '';
 return ['draw','cross_draw','proxy_draw','streamer_draw'].includes(row.source)?'🎲 骰子自帶（不計熱門／常聽）':'自帶（不計熱門／常聽）';
}
