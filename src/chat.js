export function createChat({api,context,toast,onRead}){
 const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dialog=document.createElement('dialog');dialog.id='chat-dialog';dialog.className='chat-dialog';document.body.append(dialog);
 let peer=null,manager=false,identity='',generation=0,page=0,oldest=null,loading=null,sending=false,pending=null,lastRead=0;
 let messages=new Map(),latest=null,recipientRead=0,hasOlder=false;
 const active=()=>dialog.open&&identity===key(),key=()=>{const c=context();return [c.streamer,c.manager?(c.role||'manager'):c.playerId,c.demo].join(':');};
 const call=b=>api({...b,management:manager});
 const error=e=>{const el=dialog.querySelector('[data-chat-error]');if(el)el.textContent=e.message||String(e);};
 function shell(title,body){dialog.innerHTML=`<div class="dialog-head"><h2>${h(title)}</h2><button data-chat="close" aria-label="關閉私訊">✕</button></div>${body}<p class="error" data-chat-error role="status"></p>`;if(!dialog.open)dialog.showModal();}
 async function inbox(){peer=null;generation++;shell('💬 '+context().streamerName+'的私訊',`<form data-chat-search><label>找玩家開啟對話<input name="query" placeholder="玩家名稱或 ID" maxlength="80" required></label><button type="submit">搜尋玩家</button></form><div data-chat-peers></div><div data-chat-threads>載入對話中…</div><div class="actions"><button data-chat="prev" ${page===0?'disabled':''}>上一頁</button><button data-chat="next" hidden>下一頁</button></div>`);await refresh();}
 async function thread(playerId){peer=playerId;generation++;oldest=null;lastRead=0;pending=null;messages=new Map();latest=null;recipientRead=0;hasOlder=false;shell(manager?'💬 玩家私訊':'💬 與'+context().streamerName+'私訊',`${manager?'<button data-chat="inbox">← 對話列表</button>':''}<p class="subtle">${h(context().streamerName)}專屬私訊 · 主播與PA Party總裁可查看</p><button data-chat="older" hidden>載入較早訊息</button><div class="chat-messages" data-chat-messages aria-label="對話紀錄" aria-live="polite">載入中…</div><form data-chat-compose><label>訊息<textarea name="body" placeholder="輸入訊息…" maxlength="2000" rows="3" required></textarea></label><div class="actions"><small>最多 2,000 字</small><button class="primary" type="submit">送出訊息</button></div></form>`);await refresh();}
 function rowsHtml(rows,recipientRead){return rows.map(m=>`<article class="chat-bubble ${m.sender_side===(manager?'manager':'player')?'own':''}" data-chat-seq="${m.seq}"><small>${m.sender_side==='player'?'玩家':h(context().streamerName)+'管理'} · ${h(new Date(m.created_at).toLocaleString('zh-TW'))}</small><p>${h(m.body)}</p>${m.sender_side===(manager?'manager':'player')?`<small>${m.seq<=recipientRead?'已讀':'已送出'}</small>`:''}</article>`).join('');}
 async function refresh(older=false){if(!active()||loading?.generation===generation||document.hidden)return;const job={generation},g=generation,p=peer;loading=job;try{
  if(p){
   // The cursor advances only after each ascending page arrives, never from a
   // send response. A burst of messages therefore cannot skip an unseen page.
   for(let batch=0;batch<10;batch++){
    const initial=latest===null,cursor=latest;
    const result=await call({op:'chatMessages',playerId:p,...(older&&oldest?{before:oldest}:initial?{}:{after:latest})});if(g!==generation||!active())return;
    dialog.querySelector('h2').textContent='💬 '+(manager?result.playerName:'與'+result.streamerName+'私訊');
    const box=dialog.querySelector('[data-chat-messages]'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80,height=box.scrollHeight;
    for(const row of result.rows){const seq=Number(row.seq);if(Number.isSafeInteger(seq)&&seq>0)messages.set(seq,row);}
    const previousReceipt=recipientRead;recipientRead=Math.max(recipientRead,Number(result.recipientRead)||0);
    const rows=[...messages.entries()].sort((a,b)=>a[0]-b[0]).map(([,row])=>row);
    if(initial||result.rows.length||recipientRead!==previousReceipt)box.innerHTML=rowsHtml(rows,recipientRead)||'<p class="empty">還沒有訊息，打聲招呼吧 ♡</p>';
    oldest=rows.length?Number(rows[0].seq):null;
    if(older)box.scrollTop+=box.scrollHeight-height;else if(nearBottom)box.scrollTop=box.scrollHeight;
    if(older||initial)hasOlder=result.hasMore;
    dialog.querySelector('[data-chat="older"]').hidden=!hasOlder;
    if(!older)latest=Math.max(latest||0,...result.rows.map(row=>Number(row.seq)).filter(Number.isSafeInteger));
    if(older||initial||!result.hasMore||latest<=cursor||document.hidden)break;
   }
   const through=latest;if(!older&&through&&through>lastRead&&!document.hidden){await call({op:'chatRead',playerId:p,through});if(g!==generation||!active())return;lastRead=through;onRead?.();}
  }else if(manager){const result=await call({op:'chatInbox',page});if(g!==generation||!active())return;dialog.querySelector('[data-chat-threads]').innerHTML=result.rows.map(r=>`<button class="chat-thread" data-chat="thread" data-player="${h(r.player_id)}"><b>${h(r.player_name)} ${r.unread?`<span class="notice-count">${r.unread}</span>`:''}</b><span>${h(r.body)}</span><small>${h(new Date(r.created_at).toLocaleString('zh-TW'))}</small></button>`).join('')||'<p class="empty">還沒有對話，可搜尋玩家開始私訊。</p>';dialog.querySelector('[data-chat="next"]').hidden=!result.hasMore;}
 }catch(e){if(g===generation&&active())error(e);}finally{if(loading===job)loading=null;}}
 async function open(){const c=context();if(c.demo){toast('私訊請在正式登入後使用；預覽不會發送訊息');return;}if(!c.manager&&!c.playerId){toast('請先登入玩家');return;}manager=c.manager;identity=key();page=0;await (manager?inbox():thread(c.playerId));}
 dialog.addEventListener('click',async e=>{const b=e.target.closest('[data-chat]');if(!b)return;try{switch(b.dataset.chat){case'close':dialog.close();break;case'inbox':await inbox();break;case'thread':await thread(b.dataset.player);break;case'older':await refresh(true);break;case'prev':page=Math.max(0,page-1);await inbox();break;case'next':page++;await inbox();break;}}catch(err){error(err);}});
 dialog.addEventListener('submit',async e=>{e.preventDefault();if(!active()){dialog.close();return;}const form=e.target,f=new FormData(form),g=generation;try{
  if(form.hasAttribute('data-chat-search')){const r=await call({op:'search',query:String(f.get('query')||'')});if(g!==generation||!active())return;dialog.querySelector('[data-chat-peers]').innerHTML=r.players.map(p=>`<button data-chat="thread" data-player="${h(p.playerId)}">${h(p.name)}</button>`).join('')||'<p>找不到玩家</p>';return;}
  if(!form.hasAttribute('data-chat-compose')||sending)return;const body=String(f.get('body')||'').trim();if(!body)return;
  if(!pending||pending.body!==body)pending={body,clientId:crypto.randomUUID()};sending=true;const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{await call({op:'chatSend',playerId:peer,...pending});if(g!==generation||!active())return;form.reset();pending=null;dialog.querySelector('[data-chat-error]').textContent='';await refresh();const box=dialog.querySelector('[data-chat-messages]');box.scrollTop=box.scrollHeight;}finally{sending=false;button.disabled=false;}
 }catch(err){error(err);}});
 dialog.addEventListener('close',()=>{generation++;identity='';peer=null;});
 setInterval(()=>{if(dialog.open&&!active())dialog.close();else refresh().catch(()=>{});},4000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{});});
 return {open,refresh,button:()=>context().manager||context().playerId?'<button type="button" data-open-chat>💬 私訊</button>':''};
}
