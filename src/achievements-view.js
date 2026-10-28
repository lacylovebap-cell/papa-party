import {createMedalUnlockTracker} from './medal-animation.js';
const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={public:'公開',condition_hidden:'隱藏條件',hidden:'完全隱藏',after_award:'取得後公開'};
const lifetimes={show:'本場',day:'當日',permanent:'永久',holding:'持有期間',rolling:'最近 3 日',rolling30:'最近 30 日','24h':'24 小時','7d':'7 日（168 小時）','30d':'30 日（720 小時）'};
const categories={request:'點歌',stock:'存歌',saved:'提歌',performance:'演唱',hidden:'隱藏',random:'隨機'};
export function achievementCategory(row){
 if(row.badgeId)return ({P:'request',S:'stock',R:'saved',C:'performance',H:'hidden',L:'random'})[row.badgeId[0]]||'request';
 if(['chosen','insomnia','same10','legend'].includes(row.code))return 'hidden';
 if(row.code?.startsWith('stock'))return 'stock';
 if(/^(saved|failure|after_failure)/.test(row.code||''))return 'saved';
 if(/^(sung|first_mic|repeat_show|seventh)/.test(row.code||''))return 'performance';
 return 'request';
}
const earned=row=>!row.revoked&&(row.qualified||row.recorded);
export function achievementHoldingState(row,now=Date.now()){
 if(row.revoked||row.revokedAt)return '已摘除';
 if(row.currentActive===true)return '目前有效';
 if(row.currentActive==null)return '狀態待核對';
 if(row.lifetime==='permanent')return '判定未生效（非到期）';
 if(row.expiresAt&&Number.isFinite(Date.parse(row.expiresAt))&&Date.parse(row.expiresAt)<=now)return '已到期';
 if(['holding','rolling30'].includes(row.lifetime))return '目前未符合持有條件';
 return '判定未生效';
}
const icon=(row,secret)=>secret?'？':h(row.emoji||'—');
function concealed(row,manager){return !manager&&!row.qualified&&!row.recorded&&['hidden','after_award'].includes(row.visibility);}
export function achievementProgressHtml(row,{manager=false,compact=false}={}){
 const p=row.progress;
 if(!p||!Number.isFinite(p.current)||p.current<0||!Number.isFinite(p.target)||p.target<=0||!manager&&(concealed(row,false)||/^H/.test(row.badgeId||'')||row.visibility==='condition_hidden'&&!row.qualified&&!row.recorded))return '';
 const n=Math.min(p.target,p.current);
 return '<small class="medal-progress" aria-label="完成進度 '+n+'/'+p.target+'">'+n+'/'+p.target+(!compact&&p.unit?' '+h(p.unit):'')+(!compact&&p.window?' · '+h(p.window):'')+'</small>';
}
export function achievementDetailsHtml(row,{manager=false,managementCatalog=false}={}){
 const secret=concealed(row,manager),category=secret?'hidden':achievementCategory(row);
 if(managementCatalog)return '<div class="medal-details"><span class="medal-icon" aria-hidden="true">'+icon(row,false)+'</span><h3>'+h(row.name)+'</h3><p>'+h(row.condition)+'</p><dl><dt>類型</dt><dd>'+categories[category]+'</dd><dt>有效期限</dt><dd>'+h(lifetimes[row.lifetime]||'依勳章規則')+'</dd><dt>獲得者</dt><dd><span data-medal-recipient-total>'+Number(row.recipientCount||0)+'</span> 人</dd></dl></div>';
 return '<div class="medal-details"><span class="medal-icon" aria-hidden="true">'+icon(row,secret)+'</span><h3>'+h(secret?'？？？':row.name)+'</h3><p>'+h(secret||!manager&&row.visibility==='condition_hidden'&&(/^H/.test(row.badgeId||'')||!row.qualified&&!row.recorded)?'取得條件暫不公開':row.condition||'取得條件暫不公開')+'</p><dl><dt>類型</dt><dd>'+categories[category]+'</dd><dt>有效期限</dt><dd>'+h(secret?'解鎖後公開':lifetimes[row.lifetime]||'依勳章規則')+'</dd><dt>狀態</dt><dd>'+(row.revoked?'已摘除（保留取得紀錄）':row.recorded||row.qualified?'曾取得 · '+achievementHoldingState(row):'未獲得')+'</dd></dl>'+achievementProgressHtml(row,{manager})+(row.revoked?'<p>摘除原因：'+h(row.revocationReason)+'</p>':'')+(!secret?'<small>'+(row.manualVerified?'管理者授予：':row.acquiredAt?'取得：':'')+(row.acquiredAt?h(new Date(row.acquiredAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})):row.qualified?'符合條件；取得時間尚無紀錄':'尚未取得')+'</small>':'')+'</div>';
}
export function achievementPanelHtml(rows,{manager=false,managementCatalog=false,totalDefinitions=rows.length,unlocked=rows.filter(earned).length,category='all',status='all',scope='all',hideScopeFilter=false}={}){
 const shown=rows.map((row,index)=>({row,index})).filter(({row})=>!row.retired&&(scope==='all'||row.scope===scope)&&(manager||row.visibility!=='hidden'||row.qualified||row.recorded)&&(category==='all'||(concealed(row,manager)?'hidden':achievementCategory(row))===category)&&(managementCatalog||status==='all'||(status==='earned')===!!earned(row)));
 const filters='<div class="medal-filters">'+(hideScopeFilter?'':'<label>範圍<select data-medal-filter="scope">'+Object.entries({all:'全部',global:'全站勳章',streamer:'主播勳章',radio:'電台勳章'}).map(([key,label])=>'<option value="'+key+'" '+(scope===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label>')+'<label>類型<select data-medal-filter="category">'+Object.entries({all:'全部',...categories}).map(([key,label])=>'<option value="'+key+'" '+(category===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+(!managementCatalog?'<label>狀態<select data-medal-filter="status">'+Object.entries({all:'全部狀態',earned:'已獲得',locked:'未獲得'}).map(([key,label])=>'<option value="'+key+'" '+(status===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label>':'')+'</div>';
 return '<div class="medal-heading"><h3>'+(managementCatalog?'勳章管理':'勳章圖鑑')+'</h3><span>'+(managementCatalog?rows.length+' 枚':'目前持有 '+rows.filter(r=>r.currentActive).length+' 枚 · 已解鎖 '+unlocked+' / '+totalDefinitions)+'</span></div>'+filters+'<div class="medal-list">'+shown.map(({row,index})=>{const secret=concealed(row,manager);return '<article class="medal-row '+(earned(row)?'medal-earned':'medal-locked')+'"><button type="button" class="medal-help" data-medal-detail="'+index+'" aria-label="'+h(secret?'？？？':row.name)+'說明">!</button>'+(!managementCatalog&&!secret&&earned(row)?'<button type="button" class="medal-replay" data-medal-replay="'+h(row.code)+'" aria-label="重播'+h(row.name)+'解鎖動畫" title="重播解鎖動畫">▶</button>':'')+'<span class="medal-icon" aria-hidden="true">'+icon(row,secret)+'</span><strong>'+h(secret?'？？？':row.name)+'</strong><small>'+(managementCatalog?('已獲得 '+Number(row.recipientCount||0)+' 人'+(row.scope==='global'?' · '+(row.manualAllowed?'總裁可手動認證':'全站統一管理'):'')):row.revoked?'已摘除':earned(row)?'已獲得':'未獲得')+'</small>'+(!managementCatalog?achievementProgressHtml(row,{manager,compact:true}):'')+(!secret&&!row.emoji?'<small>圖示待核對</small>':'')+(manager&&managementCatalog&&row.scope!=='global'&&!/^[HL]/.test(row.badgeId||'')?'<label>顯示方式<select data-achievement-code="'+h(row.code)+'">'+Object.entries(modes).map(([key,name])=>'<option value="'+key+'" '+(row.visibility===key?'selected':'')+'>'+name+'</option>').join('')+'</select></label>':'')+'</article>';}).join('')+'</div>'+(shown.length?'':'<p class="subtle">'+(scope==='radio'?'電台勳章內容待補充；目前主播與全站勳章合併計算聲瑪、電台。':'沒有符合篩選的勳章')+'</p>');
}
export function createAchievementPanel({api,context,render,onUnlocked=()=>{}}){
 let generation=0,cache=null,pending=null;
 const trackUnlocks=createMedalUnlockTracker();
 const stamp=c=>c.key+'|'+c.revision+'|'+(c.day||'');
 const valid=c=>{const current=context();return current.active&&current.key===c.key;};
 async function load(force=false){
  const c=context();if(!c.active)return;
  const k=stamp(c);if(!force&&cache?.key===k&&Date.now()-cache.at<60000){render({...cache.value,manager:c.manager});return;}
  if(!force&&pending?.key===k)return pending.promise;
  const g=++generation;render({loading:true});
  const promise=(async()=>{try{
   const result=await api({op:'achievements',playerId:c.playerId,spaceId:c.spaceId});
   if(!valid(c)||g!==generation)return;
   if(result?.version!==1||result.scope?.spaceId!==c.spaceId||result.scope?.streamerId!==c.room||result.scope?.playerId!==c.playerId||!Array.isArray(result.rows)||result.rows.length>100||result.rows.some(row=>!row||typeof row.code!=='string'||typeof row.name!=='string'||typeof row.qualified!=='boolean'))throw Error('勳章資料尚未確認');
   const value={rows:result.rows,totalDefinitions:result.totalDefinitions,unlocked:result.unlocked};
   cache={key:k,at:Date.now(),value};const unlocked=trackUnlocks(c.key,result.rows);render({...value,manager:c.manager});if(unlocked.length)onUnlocked(unlocked);
  }catch(error){if(valid(c)&&g===generation)render({error:error.message});}finally{if(pending?.generation===g)pending=null;}})();
  pending={key:k,promise,generation:g};return promise;
 }
 async function visibility(code,visibility){const c=context();if(!c.active||!c.manager)throw Error('請先登入管理');
  await api({op:'achievementVisibility',code,visibility,spaceId:c.spaceId});if(valid(c))await load(true);
 }
 return {load,visibility};
}
