export const MESSAGE_CATEGORIES={system:'系統',message:'私訊',board:'留言'};
export const messageCategory=type=>type==='message'?'message':['comment','announcement'].includes(type)?'board':'system';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function createMessageCenter({identity,context,api,onChange=()=>{},canUseSpace=c=>['admin','super_admin'].includes(c.role)}){
 let key,epoch=0,pageGeneration=0,countGeneration=0,writeGeneration=0,state,pages;
 const empty=()=>({category:'system',scopeMode:'room',rows:[],page:0,total:0,snapshotId:null,snapshotAt:null,hasMore:false,loading:false,error:'',writeBusy:false,writeUncertain:false,countsReady:false,countsError:'',unread:{system:0,message:0,board:0},badges:{system:0,message:0,board:0}});
 function ensure(){const next=identity();if(next!==key||!state){key=next;epoch++;pageGeneration++;countGeneration++;writeGeneration++;state=empty();pages=new Map();}return state;}
 const snapshot=()=>{const s=ensure();return {...s,rows:[...s.rows],unread:{...s.unread},badges:{...s.badges}};};
 const notify=()=>onChange(snapshot());
 function capture(){ensure();const c=context(),e=epoch,k=key,scopeMode=state.scopeMode;return {c,scopeMode,body:{streamer:c.streamer,scopeMode},valid:()=>identity()===k&&e===epoch&&state.scopeMode===scopeMode};}
 function checkScope(r,attempt){if(r?.version!==1||r.scope?.spaceId!==(attempt.c.spaceId||'space-001')||r.scope?.mode!==attempt.scopeMode||r.scope?.streamerId!==(attempt.scopeMode==='space'?null:attempt.c.streamerId))throw Error('訊息範圍未確認，請重新登入');}
 function checkPage(r,a,category,page){
  checkScope(r,a);if(r.category!==category||r.page!==page||r.pageSize!==50||!Number.isSafeInteger(r.total)||r.total<0||!uuid(r.snapshotId)||!Number.isFinite(Date.parse(r.snapshotAt))||typeof r.hasMore!=='boolean'||!Array.isArray(r.rows)||r.rows.length>50||r.total<r.rows.length||new Set(r.rows.map(x=>x?.id)).size!==r.rows.length||r.rows.some(x=>!x||!uuid(x.id)||messageCategory(x.type)!==category||x.space_id!==(a.c.spaceId||'space-001')||a.scopeMode==='room'&&x.streamer_id!==a.c.streamerId||typeof x.body!=='string'||typeof x.streamer_name!=='string'||!Number.isFinite(Date.parse(x.created_at))||x.read_at!==null&&!Number.isFinite(Date.parse(x.read_at))))throw Error('訊息分頁資料不正確');
 }
 function categoryCounts(value){if(!value||typeof value!=='object'||Object.keys(value).some(k=>!Object.hasOwn(MESSAGE_CATEGORIES,k))||Object.values(value).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('訊息未讀數未確認');return Object.fromEntries(Object.keys(MESSAGE_CATEGORIES).map(k=>[k,value[k]||0]));}
 async function refreshCounts(){const a=capture(),g=++countGeneration;try{const r=await api({op:'messageCenterCounts',...a.body});if(!a.valid()||g!==countGeneration)return;checkScope(r,a);state.unread=categoryCounts(r.unreadByCategory);state.badges=categoryCounts(r.badgeUnreadByCategory);state.countsReady=true;state.countsError='';}catch(error){if(a.valid()&&g===countGeneration){state.countsReady=false;state.countsError=error.message;}}if(a.valid()&&g===countGeneration)notify();}
 async function loadPage(page=ensure().page,fresh=false,restarted=false){
  const a=capture(),category=state.category;if(!Number.isSafeInteger(page)||page<0||page>100000)throw Error('訊息頁碼不正確');
  if(fresh){pages.delete(category);page=0;state.rows=[];state.writeUncertain=false;}const cached=pages.get(category),g=++pageGeneration;
  state.page=page;state.loading=true;state.error='';notify();
  try{const r=await api({op:'messageCenter',...a.body,category,page,snapshotId:cached?.snapshotId||null,snapshotAt:cached?.snapshotAt||null});if(!a.valid()||g!==pageGeneration||category!==state.category)return;checkPage(r,a,category,page);
   if(cached&&r.snapshotId!==cached.snapshotId)throw Error('訊息快照未確認');const last=Math.max(0,Math.ceil(r.total/50)-1);pages.set(category,r);if(page>last)return loadPage(last);
   Object.assign(state,{rows:r.rows,page:r.page,total:r.total,snapshotId:r.snapshotId,snapshotAt:r.snapshotAt,hasMore:r.hasMore});
  }catch(error){if(a.valid()&&g===pageGeneration&&category===state.category){if(!restarted&&(error.noticeSnapshotInvalid||error.code==='NOTICE_SNAPSHOT_INVALID'))return loadPage(0,true,true);state.rows=[];state.error=error.message;}}
  finally{if(a.valid()&&g===pageGeneration&&category===state.category){state.loading=false;notify();}}
 }
 async function open(){ensure();await Promise.all([loadPage(0,true),refreshCounts()]);}
 async function setCategory(category){if(!Object.hasOwn(MESSAGE_CATEGORIES,category))throw Error('訊息分類不正確');ensure();if(state.writeBusy)throw Error('已讀處理中，請稍候');state.category=category;state.rows=[];const saved=pages.get(category);await loadPage(saved?.page||0);}
 async function setScope(mode){const c=context();if(!['room','space'].includes(mode)||mode==='space'&&!canUseSpace(c))throw Error('訊息範圍不正確');ensure();if(mode===state.scopeMode)return;epoch++;pageGeneration++;countGeneration++;state={...empty(),category:state.category,scopeMode:mode};pages=new Map();notify();await open();}
 async function mark(ids,all=false){
  const a=capture(),category=state.category;if(state.loading||state.error||state.writeBusy||state.writeUncertain)throw Error('請先更新訊息，再操作已讀');
  if(!all&&(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>!state.rows.some(r=>r.id===id))))throw Error('請選本頁通知');
  const w=++writeGeneration,valid=()=>a.valid()&&w===writeGeneration&&category===state.category;state.writeBusy=true;notify();try{if(!valid())return;const r=await api({op:'messageCenterRead',...a.body,category,...(all?{all:true}:{ids})});if(!valid())return;checkScope(r,a);if(r.category!==category||!Number.isSafeInteger(r.marked)||r.marked<0)throw Error('已讀結果未確認');await Promise.all([loadPage(state.page),refreshCounts()]);
  }catch(error){if(valid()){state.writeUncertain=true;state.error=error.message+'；請更新訊息確認結果，勿重複送出';}}
  finally{if(valid()){state.writeBusy=false;notify();}}
 }
 async function preferences(settings=null){const a=capture(),r=await api({op:'messageCenterPreferences',...a.body,...(settings?{settings}:{})});if(!a.valid())throw Error('登入或訊息範圍已變更');checkScope(r,a);if(!r.settings||!r.settings.types||Object.values(r.settings.types).some(value=>!value||typeof value.center!=='boolean'||typeof value.badge!=='boolean'))throw Error('顯示設定未確認');return r.settings;}
 function cancelPending(){ensure();pageGeneration++;writeGeneration++;state.loading=false;state.writeBusy=false;}
 return {snapshot,open,loadPage,refreshCounts,setCategory,setScope,mark,preferences,cancelPending,reset:ensure};
}
