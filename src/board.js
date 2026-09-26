export function createBoard({api,context,toast}){
 const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={public:'所有人可見',include:'指定對象可見',exclude:'排除指定對象',streamers:'只給主播看'};
 const dialog=document.createElement('dialog');dialog.id='board-dialog';dialog.className='board-dialog';document.body.append(dialog);
 let scope='streamer',rootId=null,identity='',generation=0,next=null,rows=[],root=null,selected=new Map(),editing=null,pending=null,loading=false,sending=false,blockedView=false;
 const key=()=>{const c=context();return [c.streamer,c.manager,c.playerId,c.role,c.demo].join(':');};
 const active=()=>dialog.open&&identity===key();
 const call=b=>api({scope,management:context().manager,...b});
 const error=e=>{const el=dialog.querySelector('[data-board-error]');if(el)el.textContent=e.message||String(e);};
 function shell(){generation++;rows=[];next=null;root=null;editing=null;pending=null;selected.clear();blockedView=false;
  dialog.innerHTML=`<div class="dialog-head"><h2>💭 留言板</h2><button data-board="close" aria-label="關閉留言板">✕</button></div><div class="board-tabs"><button data-board="scope" data-scope="streamer" aria-pressed="${scope==='streamer'}">${h(context().streamerName)}留言板</button><button data-board="scope" data-scope="global" aria-pressed="${scope==='global'}">全站留言</button><button data-board="blocks">屏蔽設定</button></div><p class="subtle">匿名對一般讀者隱藏身分；本板管理者及總管理可查閱。管理權限不受可見名單或屏蔽限制。</p>${rootId?'<button data-board="back">← 回留言列表</button>':''}<div data-board-root></div><section data-board-settings hidden></section><form data-board-compose><label>${rootId?'回覆內容':'留言內容'}<textarea name="body" maxlength="2000" rows="3" required placeholder="想說些什麼？"></textarea></label><div data-board-options><label><input name="anonymous" type="checkbox">匿名發表</label>${rootId?'<p class="subtle">回覆沿用原留言的可見範圍。</p>':`<label>誰可以看到<select name="visibility">${Object.entries(labels).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><div data-board-audience hidden><label>尋找玩家或主播<input name="query" maxlength="80" placeholder="輸入名稱或玩家 ID"></label><button type="button" data-board="search">搜尋對象</button><div data-board-results></div><div data-board-selected></div><small>最多選擇 50 位；可見範圍發表後固定。</small></div>`}</div><div class="actions"><button type="button" data-board="cancelEdit" hidden>取消編輯</button><button type="submit" class="primary">${rootId?'送出回覆':'發表留言'}</button></div></form><p data-board-error role="status" class="error"></p><div class="board-feed" data-board-feed aria-live="polite">載入中…</div><button data-board="more" hidden>載入較早留言</button>`;
 }
 function cards(items,isRoot=false){return items.map(p=>`<article class="board-post" data-board-id="${h(p.id)}"><div class="board-post-head"><b>${h(p.author)}</b><small>${h(new Date(p.created_at).toLocaleString('zh-TW'))}${p.version>1?' · 已更新':''}</small></div>${p.managedAuthor?`<small class="board-moderation">管理可見：${h(p.managedAuthor)}</small>`:''}<small>${h(labels[p.visibility])}</small><p class="board-body">${p.deleted?'此留言已隱藏，管理紀錄保留。':h(p.body)}</p><div class="actions">${!rootId&&!isRoot?'<button data-board="thread" data-id="'+h(p.id)+'">查看／回覆</button>':''}${p.canEdit&&!p.deleted?'<button data-board="edit" data-id="'+h(p.id)+'">編輯</button>':''}${p.canManage?'<button data-board="'+(p.deleted?'restore':'remove')+'" data-id="'+h(p.id)+'">'+(p.deleted?'恢復留言':'隱藏留言')+'</button>':''}${p.canBlock&&!p.anonymous?'<button data-board="block" data-id="'+h(p.id)+'">屏蔽此作者</button>':''}</div></article>`).join('');}
 async function refresh(more=false){if(!active()||loading||document.hidden||blockedView)return;loading=true;const g=generation;try{const r=await call({op:'boardList',rootId,...(more&&next?{before:next}:{})});if(g!==generation||!active())return;
  root=r.root;if(more)rows.push(...r.rows.filter(p=>!rows.some(v=>v.id===p.id)));else rows=r.rows;next=r.next;
  dialog.querySelector('[data-board-root]').innerHTML=root?cards([root],true):'';dialog.querySelector('[data-board-feed]').innerHTML=cards(rows)||'<p class="empty">這一頁沒有可見留言。</p>';dialog.querySelector('[data-board="more"]').hidden=!next;
 }catch(e){error(e);}finally{loading=false;}}
 async function open(){const c=context();if(c.demo)return toast('留言板請在正式登入後使用；預覽不會發表留言');if(!c.playerId&&!c.manager)return toast('請先登入玩家或管理');identity=key();scope='streamer';rootId=null;shell();dialog.showModal();await refresh();}
 function pickUI(){dialog.querySelector('[data-board-selected]').innerHTML=[...selected].map(([k,v])=>`<button type="button" data-board="unpick" data-key="${h(k)}">${h(v)} ×</button>`).join('');}
 function resetEdit(){editing=null;pending=null;const form=dialog.querySelector('[data-board-compose]');form.reset();dialog.querySelector('[data-board-options]').hidden=false;dialog.querySelector('[data-board="cancelEdit"]').hidden=true;form.querySelector('[type="submit"]').textContent=rootId?'送出回覆':'發表留言';const box=dialog.querySelector('[data-board-audience]');if(box)box.hidden=true;selected.clear();}
 async function blocks(){blockedView=true;generation++;const g=generation,r=await call({op:'boardBlocks'});if(g!==generation||!active())return;dialog.querySelector('[data-board-compose]').hidden=true;dialog.querySelector('[data-board-feed]').hidden=true;dialog.querySelector('[data-board-root]').hidden=true;dialog.querySelector('[data-board="more"]').hidden=true;const box=dialog.querySelector('[data-board-settings]');box.hidden=false;box.innerHTML=`<h3>已屏蔽的帳號</h3><p class="subtle">隱藏這些帳號的留言；你管理的留言板仍保留完整管理視野。</p>${r.rows.map(x=>`<p>${h(x.name)} <button data-board="unblock" data-key="${h(x.key)}">取消屏蔽</button></p>`).join('')||'<p>尚未屏蔽任何帳號。</p>'}<button data-board="return">回到留言</button>`;}
 dialog.addEventListener('change',e=>{if(e.target.name==='visibility')dialog.querySelector('[data-board-audience]').hidden=!['include','exclude'].includes(e.target.value);});
 dialog.addEventListener('click',async e=>{const b=e.target.closest('[data-board]');if(!b)return;if(b.dataset.board==='close'){dialog.close();return;}if(!active()){dialog.close();return;}const action=b.dataset.board,p=[root,...rows].find(p=>p?.id===b.dataset.id);try{
  if(action==='scope'){scope=b.dataset.scope;rootId=null;shell();await refresh();}
  if(action==='back'){rootId=null;shell();await refresh();}
  if(action==='thread'){rootId=b.dataset.id;shell();await refresh();}
  if(action==='more')await refresh(true);
  if(action==='search'){const g=generation,q=dialog.querySelector('[name="query"]').value,r=await call({op:'boardDirectory',query:q});if(g!==generation||!active())return;dialog.querySelector('[data-board-results]').innerHTML=r.rows.map(v=>`<button type="button" data-board="pick" data-key="${h(v.key)}" data-name="${h(v.name)}">${h(v.name)} · ${h(v.role)}</button>`).join('')||'<p>找不到對象</p>';}
  if(action==='pick'){if(selected.size>=50&&!selected.has(b.dataset.key))throw Error('最多選擇 50 位');selected.set(b.dataset.key,b.dataset.name);pickUI();}
  if(action==='unpick'){selected.delete(b.dataset.key);pickUI();}
  if(action==='edit'&&p){editing=p;pending=null;dialog.querySelector('[name="body"]').value=p.body;dialog.querySelector('[data-board-options]').hidden=true;dialog.querySelector('[data-board="cancelEdit"]').hidden=false;dialog.querySelector('[data-board-compose] [type="submit"]').textContent='儲存修改';dialog.querySelector('[name="body"]').focus();}
  if(action==='cancelEdit')resetEdit();
  if(['remove','restore'].includes(action)&&p){await call({op:'boardChange',id:p.id,version:p.version,action});await refresh();}
  if(action==='block'&&p){await call({op:'boardBlock',id:p.id});toast('已屏蔽此作者，可在屏蔽設定恢復');await refresh();}
  if(action==='blocks')await blocks();
  if(action==='unblock'){await call({op:'boardUnblock',key:b.dataset.key});await blocks();}
  if(action==='return'){shell();await refresh();}
 }catch(err){error(err);}});
 dialog.addEventListener('submit',async e=>{if(!e.target.hasAttribute('data-board-compose'))return;e.preventDefault();if(sending||!active())return;const form=e.target,data=new FormData(form),g=generation;const body=String(data.get('body')||'').trim();if(!body)return;const payload=editing?{op:'boardChange',id:editing.id,version:editing.version,action:'edit',body}:{op:'boardCreate',rootId,body,anonymous:data.get('anonymous')==='on',visibility:data.get('visibility')||'public',targets:[...selected.keys()]};
  const signature=JSON.stringify(payload);if(!pending||pending.signature!==signature)pending={signature,clientId:crypto.randomUUID()};sending=true;const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try{await call({...payload,clientId:pending.clientId});if(g!==generation||!active())return;resetEdit();dialog.querySelector('[data-board-error]').textContent='';await refresh();toast(editing?'留言已修改':'已儲存留言');}catch(err){error(err);}finally{sending=false;submit.disabled=false;}
 });
 dialog.addEventListener('close',()=>{identity='';generation++;});
 setInterval(()=>{if(dialog.open&&!active())dialog.close();else if(!next)refresh().catch(()=>{});},8000);
 return {open,refresh,button:()=>'<button type="button" data-open-board>💭 留言板</button>'};
}
