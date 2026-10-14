const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={public:'公開',condition_hidden:'隱藏條件',hidden:'完全隱藏',after_award:'取得後公開'};
const lifetimes={show:'本場',permanent:'永久',holding:'持有期間',rolling:'最近 3 日',rolling30:'最近 30 日','24h':'24 小時'};
const categories={request:'點歌',stock:'存歌',saved:'提歌',performance:'演唱',hidden:'隱藏'};
export function achievementCategory(row){
 if(['hidden','after_award'].includes(row.visibility))return 'hidden';
 if(row.code?.startsWith('stock'))return 'stock';
 if(/^(saved|failure|after_failure)/.test(row.code||''))return 'saved';
 if(/^(sung|first_mic|repeat_show|seventh)/.test(row.code||''))return 'performance';
 return 'request';
}
const icons={request:'🎵',stock:'💾',saved:'🎤',performance:'🏅',hidden:'✨'};
function concealed(row,manager){return !manager&&!row.qualified&&!row.recorded&&['hidden','after_award'].includes(row.visibility);}
export function achievementDetailsHtml(row,{manager=false}={}){
 const secret=concealed(row,manager),category=secret?'hidden':achievementCategory(row);
 return '<div class="medal-details"><span class="medal-icon" aria-hidden="true">'+(secret?'🔒':icons[category])+'</span><h3>'+h(secret?'神秘勳章':row.name)+'</h3><p>'+h(secret||!manager&&row.visibility==='condition_hidden'?'取得條件暫不公開':row.condition||'取得條件暫不公開')+'</p><dl><dt>類型</dt><dd>'+categories[category]+'</dd><dt>有效期限</dt><dd>'+h(secret?'解鎖後公開':lifetimes[row.lifetime]||'依勳章規則')+'</dd><dt>狀態</dt><dd>'+(row.currentActive!==undefined&&row.currentActive!==null?(row.currentActive?'曾取得 · 目前有效':'曾取得 · 目前未生效'):row.qualified||row.recorded?'已獲得':'未獲得')+'</dd></dl>'+(!secret?'<small>'+(row.manualVerified?'管理員認證：':row.acquiredAt?'取得：':'')+(row.acquiredAt?h(new Date(row.acquiredAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})):row.qualified?'符合條件；取得時間尚無紀錄':'尚未取得')+'</small>':'')+'</div>';
}
export function achievementPanelHtml(rows,{manager=false,publicControl=false,category='all',status='all'}={}){
 const shown=rows.map((row,index)=>({row,index})).filter(({row})=>(category==='all'||achievementCategory(row)===category)&&(status==='all'||(status==='earned')===(row.qualified||row.recorded===true)));
 return '<div class="medal-heading"><h3>勳章圖鑑</h3><span>已解鎖 '+rows.filter(row=>row.qualified||row.recorded).length+' / '+rows.length+'</span></div>'+(publicControl?'<p class="medal-public-note">已獲得的勳章由你決定是否公開；未公開不進入榮譽牆及排行。</p>':'')+'<div class="medal-filters"><label>類型<select data-medal-filter="category">'+Object.entries({all:'全部',...categories}).map(([key,label])=>'<option value="'+key+'" '+(category===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label>狀態<select data-medal-filter="status">'+Object.entries({all:'全部狀態',earned:'已獲得',locked:'未獲得'}).map(([key,label])=>'<option value="'+key+'" '+(status===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div><div class="medal-list">'+shown.map(({row,index})=>{const secret=concealed(row,manager),canPublish=publicControl&&(row.qualified||row.recorded)&&(row.recorded||row.lifetime==='permanent');return '<article class="medal-row '+((row.qualified||row.recorded)?'medal-earned':'medal-locked')+'"><button type="button" class="medal-help" data-medal-detail="'+index+'" aria-label="'+h(secret?'神秘勳章':row.name)+'說明">!</button><span class="medal-icon" aria-hidden="true">'+(secret?'🔒':icons[achievementCategory(row)])+'</span><strong>'+h(secret?'神秘勳章':row.name)+'</strong><small>'+((row.qualified||row.recorded)?'已獲得':'未獲得')+'</small>'+(canPublish?'<button type="button" class="medal-public" data-medal-public-code="'+h(row.code)+'" aria-pressed="'+!!row.published+'">'+(row.published?'公開中':'設為公開')+'</button>':publicControl&&(row.qualified||row.recorded)?'<small>舊限時勳章待授予紀錄</small>':'')+(manager?'<label>顯示方式<select data-achievement-code="'+h(row.code)+'">'+Object.entries(modes).map(([key,name])=>'<option value="'+key+'" '+(row.visibility===key?'selected':'')+'>'+name+'</option>').join('')+'</select></label>':'')+'</article>';}).join('')+'</div>'+(shown.length?'':'<p class="subtle">沒有符合篩選的勳章</p>');
}
export function createAchievementPanel({api,context,render}){
 let generation=0,cache=null,pending=null;
 const stamp=c=>c.key+'|'+c.revision+'|'+(c.day||'');
 const valid=c=>{const current=context();return current.active&&current.key===c.key;};
 async function load(force=false){
  const c=context();if(!c.active)return;
  const k=stamp(c);if(!force&&cache?.key===k&&Date.now()-cache.at<60000){render({rows:cache.rows,manager:c.manager});return;}
  if(!force&&pending?.key===k)return pending.promise;
  const g=++generation;render({loading:true});
  const promise=(async()=>{try{
   const result=await api({op:'achievements',playerId:c.playerId,spaceId:c.spaceId});
   if(!valid(c)||g!==generation)return;
   if(result?.version!==1||result.scope?.spaceId!==c.spaceId||result.scope?.streamerId!==c.room||result.scope?.playerId!==c.playerId||!Array.isArray(result.rows)||result.rows.length>100||result.rows.some(row=>!row||typeof row.code!=='string'||typeof row.name!=='string'||typeof row.qualified!=='boolean'))throw Error('勳章資料尚未確認');
   cache={key:k,at:Date.now(),rows:result.rows};render({rows:result.rows,manager:c.manager});
  }catch(error){if(valid(c)&&g===generation)render({error:error.message});}finally{if(pending?.generation===g)pending=null;}})();
  pending={key:k,promise,generation:g};return promise;
 }
 async function visibility(code,visibility){const c=context();if(!c.active||!c.manager)throw Error('請先登入管理');
  await api({op:'achievementVisibility',code,visibility,spaceId:c.spaceId});if(valid(c))await load(true);
 }
 return {load,visibility};
}
