// Demand-driven keyset reads: publish the cursor only after the entire batch succeeds.
const timeKey=value=>{
 const ms=Date.parse(value);
 if(!Number.isFinite(ms))throw Error('通知時間不正確');
 const fraction=String(value).match(/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/i)?.[1]||'';
 return BigInt(ms)*1000n+BigInt(fraction.padEnd(6,'0').slice(3,6));
};
const newer=(a,b)=>timeKey(a.created_at)>timeKey(b.created_at)||(timeKey(a.created_at)===timeKey(b.created_at)&&a.id>b.id);
export function createNoticeDelta(){
 let cursor=null,revision=0;
 return {
  reset(){cursor=null;revision++;},
  seed(rows){if(cursor)return;for(const row of rows){if(row?.id&&row.created_at&&(!cursor||newer(row,cursor)))cursor={id:row.id,created_at:row.created_at};}},
  async read(api,valid){
   if(!cursor)return {rows:[],more:false};
   const generation=revision,rows=[];let next={...cursor};
   const finish=more=>{if(generation!==revision||!valid())return {rows:[],more:false};cursor=next;return {rows,more};};
   for(let page=0;page<4;page++){
    const result=await api({op:'noticeDelta',afterTime:next.created_at,afterId:next.id});
    if(generation!==revision||!valid())return {rows:[],more:false};
    if(!Array.isArray(result)||result.length>51)throw Error('通知同步結果不正確');
    for(const row of result){if(!row?.id||!row.created_at||!newer(row,next))throw Error('通知同步游標未前進');next={id:row.id,created_at:row.created_at};}
    rows.push(...result);
    if(result.length<51)return finish(false);
   }
   return finish(true);
  }
 };
}
