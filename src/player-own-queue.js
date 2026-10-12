// Own requests are loaded one server page at a time. Selection persists across
// pages but is discarded when account, Space or current Room changes.
export function createOwnQueue({identity,read,onChange=()=>{}}){
 let key='',generation=0,loadedKey='',view;
 const fresh=()=>({page:0,sort:'newest',rows:[],total:0,revision:0,loading:false,error:'',selected:new Map()});
 const ensure=()=>{const next=identity();if(!view||next!==key){key=next;generation++;loadedKey='';view=fresh();}return view;};
 const notify=()=>onChange(snapshot());
 function snapshot(){const v=ensure();return {...v,rows:[...v.rows],selected:new Map(v.selected)};}
 async function load(page=ensure().page,force=false,revision=0){
  const v=ensure(),scope=key,sort=v.sort,cache=JSON.stringify([scope,page,sort,revision]);
  if(!Number.isSafeInteger(page)||page<0||page*20>10000000)throw Error('待播頁碼不正確');
  if(!force&&loadedKey===cache)return snapshot();loadedKey=cache;
  const stamp=++generation;v.page=page;v.loading=true;v.error='';notify();
  try{
   const result=await read({page,limit:20,sort});
   if(stamp!==generation||scope!==identity())return snapshot();
   if(!result||!Array.isArray(result.rows)||result.rows.length>20||!Number.isSafeInteger(result.total)||result.total<result.rows.length||!Number.isSafeInteger(result.revision)||result.revision<0||new Set(result.rows.map(r=>r?.id)).size!==result.rows.length||result.rows.some(r=>!r||['id','streamerId','slug','name','title','artist'].some(k=>typeof r[k]!=='string')||!r.id||!r.streamerId||!r.slug||!['saved','live'].includes(r.kind)||!['pending','waiting'].includes(r.status)||typeof r.active!=='boolean'))throw Error('自己的待播資料不正確');
   v.rows=result.rows;v.total=result.total;v.revision=result.revision;
   for(const row of v.rows)if(v.selected.has(row.id))v.selected.set(row.id,row);
   const last=Math.max(0,Math.ceil(v.total/20)-1);if(page>last)return load(last,true,revision);
  }catch(error){if(stamp===generation&&scope===identity()){v.error=error.message;v.rows=[];loadedKey='';}}
  finally{if(stamp===generation&&scope===identity()){v.loading=false;notify();}}
  return snapshot();
 }
 function select(id,checked){const v=ensure(),row=v.rows.find(r=>r.id===id);if(!checked)v.selected.delete(id);else if(row){if(!v.selected.has(id)&&v.selected.size>=50)throw Error('一次最多選 50 首');v.selected.set(id,row);}notify();}
 function selectPage(){const v=ensure();if(new Set([...v.selected.keys(),...v.rows.map(r=>r.id)]).size>50)throw Error('一次最多選 50 首');for(const row of v.rows)v.selected.set(row.id,row);notify();}
 function clear(){ensure().selected.clear();notify();}
 function setSort(sort){if(!['newest','oldest'].includes(sort))throw Error('排序不正確');ensure().sort=sort;ensure().page=0;loadedKey='';return load(0,true);}
 function settle(jobs,result){
  if(!Array.isArray(result?.results)||result.results.length!==jobs.length||new Set(result.results.map(r=>r?.streamer)).size!==jobs.length||result.results.some(r=>!r||!jobs.some(j=>j.streamer===r.streamer)||typeof r.ok!=='boolean'||r.ok&&(r.count!==jobs.find(j=>j.streamer===r.streamer).rows.length||!Number.isSafeInteger(r.revision)||r.revision<0)))throw Error('操作結果未確認，請重新查看待播，勿重複送出');
  const v=ensure();loadedKey='';for(const resultRow of result.results)if(resultRow.ok||resultRow.unknown){for(const row of jobs.find(j=>j.streamer===resultRow.streamer).rows)v.selected.delete(row.id);}notify();return result.results;
 }
 return {snapshot,load,select,selectPage,clear,setSort,settle};
}
export function ownQueueCancelJobs(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>50||new Set(rows.map(r=>r?.id)).size!==rows.length||rows.some(r=>!r||typeof r.id!=='string'||!r.id||typeof r.slug!=='string'||!r.slug))throw Error('一次請選 1 到 50 首自己的待播');
 const rooms=new Map();for(const row of rows){if(!rooms.has(row.slug))rooms.set(row.slug,[]);rooms.get(row.slug).push({id:row.id,operation:'cancel'});}
 if(rooms.size>10)throw Error('一次最多操作 10 位主播');return [...rooms].map(([streamer,rows])=>({streamer,rows}));
}
