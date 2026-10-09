const PLAYER_MANAGER_MODES=['stored','all'];
const playerManagerError=message=>new Error(message);
function playerManagerMode(mode){
 if(!PLAYER_MANAGER_MODES.includes(mode))throw playerManagerError('玩家清單模式不正確');
 return mode;
}
function playerManagerText(value,label,max=1000){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw playerManagerError(label+'不正確');
 return value;
}
function playerManagerList(value,label){
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>100)throw playerManagerError(label+'不正確');
 return Array.from(value,item=>playerManagerText(item,label));
}
function playerManagerRows(response,limit){
 if(!response||typeof response!=='object'||Array.isArray(response)||!Array.isArray(response.rows)||response.rows.length>limit||!Number.isSafeInteger(response.total)||response.total<response.rows.length)
  throw playerManagerError('玩家清單資料不正確');
 const ids=new Set(),rows=Array.from(response.rows,row=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw playerManagerError('玩家資料不正確');
  const playerId=playerManagerText(row.playerId,'玩家編號',128),name=playerManagerText(row.name,'玩家名稱');
  if(ids.has(playerId))throw playerManagerError('玩家清單包含重複玩家');
  ids.add(playerId);
  const storedCredits=row.storedCredits??0,certification=row.certification??'',test=row.test??false;
  if(typeof storedCredits!=='number'||!Number.isFinite(storedCredits)||Math.abs(storedCredits)>Number.MAX_SAFE_INTEGER||typeof certification!=='string'||certification.length>1000||typeof test!=='boolean')
   throw playerManagerError('玩家資料不正確');
  return {playerId,name,ids:playerManagerList(row.ids,'平台 ID'),names:playerManagerList(row.names,'玩家別名'),certification,test,storedCredits};
 });
 return {rows,total:response.total};
}
function playerManagerFreeze(value){
 if(value&&typeof value==='object'){for(const item of Object.values(value))playerManagerFreeze(item);Object.freeze(value);}
 return value;
}

// This controller owns two bounded page results; only load reads the server.
export function createPlayerManager({api,context,onChange=()=>{},pageLimit=20}){
 if(typeof api!=='function'||typeof context!=='function'||typeof onChange!=='function')throw playerManagerError('玩家清單控制器設定不正確');
 if(!Number.isSafeInteger(pageLimit)||pageLimit<20||pageLimit>50)throw playerManagerError('每頁玩家數量必須是 20 到 50');
 const fresh=mode=>({mode,q:'',page:0,rows:[],total:0,loading:false,error:null,key:null,pending:null});
 const modes=Object.fromEntries(PLAYER_MANAGER_MODES.map(mode=>[mode,fresh(mode)]));
 let currentMode='stored',scope=null,generation=0;
 const snapshot=(mode=currentMode)=>{
  const {q,page,rows,total,loading,error}=modes[playerManagerMode(mode)];
  return playerManagerFreeze(structuredClone({mode,q,page,rows,total,loading,error}));
 };
 let notified=JSON.stringify(snapshot());
 function notify(){
  const next=snapshot(),key=JSON.stringify(next);
  if(key!==notified){notified=key;onChange(next);}
 }
 function invalidate(){
  generation++;
  for(const mode of PLAYER_MANAGER_MODES){modes[mode].pending=null;modes[mode].loading=false;}
 }
 function syncContext(){
  const next=context();
  if(!next||typeof next.spaceId!=='string'||!next.spaceId||typeof next.roomId!=='string'||!next.roomId||!Number.isSafeInteger(next.revision)||next.revision<0||next.actorKey!=null&&(typeof next.actorKey!=='string'||next.actorKey.length>256))
   throw playerManagerError('玩家清單空間資訊不正確');
  const identity=JSON.stringify([next.spaceId,next.roomId,next.actorKey??null]),revision=next.revision;
  if(!scope){scope={identity,revision};return;}
  if(identity!==scope.identity||revision!==scope.revision){
   const changedIdentity=identity!==scope.identity;
   invalidate();
   for(const mode of PLAYER_MANAGER_MODES){
    const {q,page}=modes[mode];
    modes[mode]={...fresh(mode),q:changedIdentity?'':q,page:changedIdentity?0:page};
   }
   scope={identity,revision};
  }
 }
 const state=(mode=currentMode)=>{syncContext();return snapshot(mode);};
 function setMode(mode){
  syncContext();playerManagerMode(mode);
  if(mode!==currentMode){invalidate();currentMode=mode;}
  notify();return snapshot();
 }
 function search(query){
  syncContext();
  if(typeof query!=='string'||query.length>100)throw playerManagerError('玩家搜尋內容不正確');
  const q=query.trim(),view=modes[currentMode];
  if(q!==view.q||view.page!==0){invalidate();modes[currentMode]={...fresh(currentMode),q};}
  notify();return snapshot();
 }
 function setPage(page){
  syncContext();
  if(!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(page*pageLimit)||page*pageLimit>10000000)throw playerManagerError('玩家清單頁碼不正確');
  const view=modes[currentMode];
  if(page!==view.page){invalidate();modes[currentMode]={...fresh(currentMode),q:view.q,page};}
  notify();return snapshot();
 }
 function load({force=false}={}){
  syncContext();
  if(typeof force!=='boolean')throw playerManagerError('玩家清單重新讀取設定不正確');
  const mode=currentMode,view=modes[mode],key=JSON.stringify([scope.identity,scope.revision,mode,view.q,view.page,pageLimit]);
  if(view.pending?.key===key&&view.pending.generation===generation)return view.pending.promise;
  if(!force&&view.key===key)return Promise.resolve(snapshot(mode));
  const requestGeneration=generation,payload={op:'playerManagementPage',mode,query:view.q,page:view.page,limit:pageLimit};
  const active=()=>{
   syncContext();
   return generation===requestGeneration&&currentMode===mode&&modes[mode]===view;
  };
  const promise=Promise.resolve().then(()=>active()?api(payload):null).then(response=>{
   if(!active())return snapshot(mode);
   Object.assign(view,playerManagerRows(response,pageLimit),{loading:false,error:null,key,pending:null});
   notify();return snapshot(mode);
  }).catch(error=>{
   if(!active())return snapshot(mode);
   Object.assign(view,{loading:false,error:String(error?.message||'玩家清單讀取失敗').slice(0,500),key,pending:null});
   notify();return snapshot(mode);
  });
  view.pending={key,generation:requestGeneration,promise};view.loading=true;view.error=null;
  notify();return promise;
 }
 return Object.freeze({state,setMode,search,setPage,load});
}
