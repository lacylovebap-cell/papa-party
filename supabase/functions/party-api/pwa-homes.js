// Public metadata only. This adapter never loads a business snapshot, actor,
// player data or a whole streamer directory; the existing rows are filtered
// and paginated by one service-only, read-only database function.
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u0020\u007f-\u009f]/u.test(value);
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const slug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const path=value=>typeof value==='string'&&/^\/[A-Za-z0-9][A-Za-z0-9.-]{0,80}$/.test(value);
const kinds=new Set(['hall','streamer']);

function sourceTarget(body){
 const source=object(body?.source)?body.source:body;
 if(!object(source)||source.v!==1||!kinds.has(source.kind)||!identity(source.spaceId)
  ||(source.kind==='hall')!==(source.streamerId===null)||source.streamerId!==null&&!identity(source.streamerId))throw Error('APP 首頁來源不正確');
 return {source_space:source.spaceId,source_room:source.streamerId,source_kind:source.kind};
}
function projection(row,source=null){
 if(!object(row)||!kinds.has(row.kind)||!identity(row.spaceId)||!label(row.name)||!label(row.spaceName)||row.active!==true
  ||(row.kind==='hall')!==(row.streamerId===null)||row.streamerId!==null&&!identity(row.streamerId)
  ||row.kind==='streamer'&&!slug(row.streamerSlug)||row.kind==='hall'&&row.streamerSlug!==null
  ||row.canonicalPath!==null&&!path(row.canonicalPath)
  ||source&&(row.kind!==source.source_kind||row.spaceId!==source.source_space||row.streamerId!==source.source_room))throw Error('APP 首頁資料尚未確認');
 const expected=row.canonicalPath??(row.kind==='hall'?'/lobby.html':'/v2.html?streamer='+encodeURIComponent(row.streamerSlug)+'#home');
 if(row.homePath!==expected)throw Error('APP 首頁網址尚未確認');
 return {kind:row.kind,spaceId:row.spaceId,streamerId:row.streamerId,name:row.name,spaceName:row.spaceName,
  streamerSlug:row.streamerSlug,canonicalPath:row.canonicalPath,homePath:row.homePath,active:true};
}
function envelope(value,page,pageSize,source=null){
 if(!object(value)||!Array.isArray(value.items)||value.items.length>pageSize||!Number.isSafeInteger(value.page)||value.page<1||value.page>page||value.pageSize!==pageSize
  ||!Number.isSafeInteger(value.total)||value.total<0||value.totalPages!==Math.max(1,Math.ceil(value.total/pageSize))
  ||value.page!==Math.min(page,value.totalPages)||value.items.length!==Math.min(pageSize,Math.max(0,value.total-(value.page-1)*pageSize)))throw Error('APP 首頁清單尚未確認');
 return {items:value.items.map(row=>projection(row,source)),page:value.page,pageSize,total:value.total,totalPages:value.totalPages};
}

export function createPublicAppHomes({api}){
 const rpc=args=>api('/rest/v1/rpc/papa_public_app_homes',args);
 return {
  async list(body={}){
   const q=body.q??'',page=body.page??1,pageSize=body.pageSize??12,kind=body.kind??'all';
   if(typeof q!=='string'||q.length>100||!['all','hall','streamer'].includes(kind)||!Number.isSafeInteger(page)||page<1||page>500
    ||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>12)throw Error('APP 首頁搜尋或頁碼不正確');
   return envelope(await rpc({query_text:q.trim(),requested_kind:kind,page_limit:pageSize,page_offset:(page-1)*pageSize,
    source_space:null,source_room:null,source_kind:null}),page,pageSize);
  },
  async one(body){
   const source=sourceTarget(body);
   const result=envelope(await rpc({query_text:'',requested_kind:source.source_kind,page_limit:1,page_offset:0,...source}),1,1,source);
   if(result.total>1)throw Error('APP 首頁來源尚未確認');
   return result.items[0]??null;
  }
 };
}
