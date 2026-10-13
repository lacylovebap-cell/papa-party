const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages={home:'首頁',book:'歌本','common-book':'共同歌本',center:'玩家中心',gallery:'卡片牆'};
export function activityPageHtml(result,{playerName,roomName}){
 const totalPages=Math.max(1,Math.ceil(result.total/50));
 return '<p class="muted">在線表示最近 3 分鐘有前景活動。此頁手動更新，最近紀錄保留顯示 24 小時。</p><button data-act="activityRefresh">重新整理</button>'+result.rows.map(row=>'<article class="song"><div class="info"><b>'+h(playerName(row.player_id))+'</b><p>'+h(roomName(row.streamer_id))+' · '+h(pages[row.page]||'頁面')+'</p><small>'+h(new Date(row.last_seen).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))+'</small></div><span class="tag">'+(row.online?'🟢 最近在線':'最近無活動')+'</span></article>').join('')+(result.rows.length?'':'<p>尚無最近活動。</p>')+'<div class="pagination"><button data-act="activityPrevious" '+(result.page===0?'disabled':'')+'>上一頁</button><label>第 <input id="activity-page" type="number" min="1" max="'+totalPages+'" value="'+(result.page+1)+'" aria-label="活動頁碼"> / '+totalPages+' 頁</label><button data-act="activityJump">跳頁</button><button data-act="activityNext" '+(result.page+1>=totalPages?'disabled':'')+'>下一頁</button></div>';
}
export function createActivityPage({api,context,render}){
 let generation=0,cached=null,pending=null,page=0;
 async function load(next=page,force=false){
  const c=context();if(!c.active)return;next=Math.max(0,Math.min(100000,Number.isInteger(next)?next:0));
  const key=c.key+'|'+next;if(!force&&cached?.key===key){render(cached.result);return;}if(!force&&pending?.key===key)return pending.promise;
  const g=++generation;render({loading:true});const valid=()=>context().active&&context().key===c.key&&generation===g;
  const promise=(async()=>{try{const result=await api({op:'activityPage',spaceId:c.spaceId,page:next});if(!valid())return;
   if(result?.version!==1||result.spaceId!==c.spaceId||result.page!==next||result.pageSize!==50||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.rows)||result.rows.length>50)throw Error('活動資料尚未確認');
   page=next;cached={key,result};render(result);
  }catch(error){if(valid())render({error:error.message});}finally{if(pending?.generation===g)pending=null;}})();pending={key,promise,generation:g};return promise;
 }
 return {load,refresh:()=>load(page,true),previous:()=>load(page-1),next:()=>load(page+1),jump:n=>load(n-1)};
}
