const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={public:'公開',condition_hidden:'隱藏條件',hidden:'完全隱藏',after_award:'取得後公開'};
const lifetimes={show:'本場',permanent:'永久',holding:'持有期間',rolling:'最近 3 日',rolling30:'最近 30 日','24h':'24 小時'};
export function achievementPanelHtml(rows,{manager=false}={}){
 return '<div class="medal-list">'+rows.map(row=>'<article class="medal-row"><div><strong>'+h(row.name)+'</strong><span class="tag">'+(row.qualified?'已獲得':'未獲得')+'</span></div><p>'+h(row.condition||'取得條件暫不公開')+'</p><small>'+h(lifetimes[row.lifetime]||'')+' · '+(row.acquiredAt?'取得：'+h(new Date(row.acquiredAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})):row.qualified?'符合條件；取得時間尚無紀錄':'尚未取得')+'</small>'+(manager?'<label>顯示方式<select data-achievement-code="'+h(row.code)+'">'+Object.entries(modes).map(([k,n])=>'<option value="'+k+'" '+(row.visibility===k?'selected':'')+'>'+n+'</option>').join('')+'</select></label>':'')+'</article>').join('')+'</div>';
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
