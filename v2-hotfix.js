/* 怕怕 PARTY V2 測試修正版：2026-09-17 */
(()=>{
'use strict';
const w=window;

/* 待播清單：勾選 / 全選 / 刪除勾選 / 一鍵清空 */
w.papaQueueSelected = w.papaQueueSelected || new Set();
w.toggleQueueSelection=function(id,checked){
  const key=String(id); checked?w.papaQueueSelected.add(key):w.papaQueueSelected.delete(key);
  const count=document.getElementById('queueSelectedCount'); if(count)count.textContent=`已選 ${w.papaQueueSelected.size} 筆`;
  const del=document.getElementById('queueDeleteSelected'); if(del)del.disabled=!w.papaQueueSelected.size;
};
w.toggleQueueSelectAll=function(checked){
  w.papaQueueSelected.clear();
  if(checked) db.queue.forEach(item=>w.papaQueueSelected.add(String(item.id)));
  document.querySelectorAll('.queue-select').forEach(el=>el.checked=checked);
  w.toggleQueueSelection('__refresh__',false); w.papaQueueSelected.delete('__refresh__');
  const count=document.getElementById('queueSelectedCount'); if(count)count.textContent=`已選 ${w.papaQueueSelected.size} 筆`;
  const del=document.getElementById('queueDeleteSelected'); if(del)del.disabled=!w.papaQueueSelected.size;
};
w.deleteSelectedQueue=function(){
  const ids=[...w.papaQueueSelected]; if(!ids.length)return alert('請先勾選要刪除的待播紀錄。');
  if(!confirm(`確定永久刪除已勾選的 ${ids.length} 筆待播紀錄？`))return;
  const set=new Set(ids); db.queue=db.queue.filter(item=>!set.has(String(item.id))); w.papaQueueSelected.clear();
  syncPreparing(); save(); renderAdminAll(); renderFront(); alert(`已刪除 ${ids.length} 筆待播紀錄。`);
};
w.clearAllQueue=function(){
  if(!db.queue.length)return alert('待播清單目前是空的。');
  if(!confirm(`確定要清空全部 ${db.queue.length} 筆待播紀錄？此操作無法復原。`))return;
  if(!confirm('再次確認：真的要一鍵清空全部待播紀錄嗎？'))return;
  db.queue=[]; w.papaQueueSelected.clear(); syncPreparing(); save(); renderAdminAll(); renderFront(); alert('待播清單已全部清空。');
};
w.renderAdminQueue=function(){
  const box=document.getElementById('adminQueue'); if(!box)return;
  const allChecked=db.queue.length>0&&db.queue.every(item=>w.papaQueueSelected.has(String(item.id)));
  const toolbar=`<div class="queue-bulkbar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:10px;border:1px solid var(--line);border-radius:11px;background:#0d1420"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${allChecked?'checked':''} onchange="toggleQueueSelectAll(this.checked)"> 全選</label><span id="queueSelectedCount" class="tag">已選 ${w.papaQueueSelected.size} 筆</span><button id="queueDeleteSelected" class="tiny" ${w.papaQueueSelected.size?'':'disabled'} onclick="deleteSelectedQueue()">刪除勾選</button><button class="tiny" onclick="clearAllQueue()">一鍵清空</button></div>`;
  box.innerHTML=toolbar+(db.queue.map(item=>`<div class="rank"><label style="display:flex;align-items:flex-start;gap:9px;min-width:0;flex:1"><input class="queue-select" type="checkbox" ${w.papaQueueSelected.has(String(item.id))?'checked':''} onchange="toggleQueueSelection(${Number(item.id)},this.checked)" style="margin-top:4px"><span><b>${esc(item.crownTitle||db.songs.find(song=>song.id===item.songId)?.title||'冠歌')}</b> · ${esc(item.name)} ${isTestQueue(item)?'<span class="tag">測試・不計統計</span>':''} · ${esc(item.source)}<br><small style="color:#74819b">${esc(item.time)}</small></span></label><span class="queue-actions"><span class="tag">${esc(item.status)}</span>${!queueIsClosed(item)?`<button class="tiny" onclick="moveQueueRecord(${item.id},-1)">上移</button><button class="tiny" onclick="moveQueueRecord(${item.id},1)">下移</button>${item.source==='現點待確認'?`<button class="tiny" onclick="approveLive(${item.id})">確認收到</button>`:''}<button class="tiny" onclick="completeQueue(${item.id})">完成</button>${item.source.startsWith('現點')?`<button class="tiny" onclick="convertLiveToSaved(${item.id})">未唱→存歌</button>`:''}<button class="tiny" onclick="cancelQueue(${item.id})">取消</button>`:''}<button class="tiny" onclick="deleteQueueRecord(${item.id})">刪除</button></span></div>`).join('')||'<div class="empty">目前沒有紀錄</div>');
};

/* 標籤：編輯期間不重畫 checkbox；刪除建立 tombstone，避免 loadCloud / normalize 復活。 */
function deletedTags(){if(!db.settings)db.settings={};return new Set(Array.isArray(db.settings.deletedSongTags)?db.settings.deletedSongTags:[])}
w.allSongTags=function(){const deleted=deletedTags();return [...new Set([...listValues(db.settings?.songTags),...db.songs.flatMap(songTagList)])].filter(tag=>!deleted.has(tag)).sort((a,b)=>a.localeCompare(b,'zh-Hant'))};
w.renderSongTagPicker=function(){const picker=document.getElementById('sTagPicker'),input=document.getElementById('sTags');if(!picker||!input)return;const selected=new Set(listValues(input.value));picker.innerHTML=allSongTags().map(tag=>`<label><input type="checkbox" value="${esc(tag)}" ${selected.has(tag)?'checked':''} onchange="toggleSongTag(${JSON.stringify(tag)},this.checked)"><span>${esc(tag)}</span></label>`).join('')};
w.toggleSongTag=function(tag,checked){const input=document.getElementById('sTags');if(!input)return;const tags=listValues(input.value),next=checked?[...new Set([...tags,tag])]:tags.filter(value=>value!==tag);input.value=next.join(', ');const box=document.getElementById('sTagPreview');if(box)box.innerHTML=next.map(value=>`<span class="tag-chip">${esc(value)}</span>`).join('')};
w.previewSongTags=function(){const box=document.getElementById('sTagPreview'),input=document.getElementById('sTags');if(!box||!input)return;box.innerHTML=listValues(input.value).map(tag=>`<span class="tag-chip">${esc(tag)}</span>`).join('')};
w.addTag=function(){const input=document.getElementById('newTagName'),tag=(input?.value||'').trim();if(!tag)return alert('請輸入標籤名稱');if(!db.settings)db.settings={};db.settings.deletedSongTags=[...deletedTags()].filter(x=>x!==tag);db.settings.songTags=[...new Set([...listValues(db.settings.songTags),tag])];input.value='';save();renderTagTools();prepareMusicFilters();alert(`標籤「${tag}」已新增。`)};
w.removeSelectedTag=function(){const tag=document.getElementById('tagManageSelect')?.value;if(!tag)return alert('請先選擇要移除的標籤');if(!confirm(`確定移除「${tag}」？它會從所有歌曲中移除，而且重新整理後不會復活。`))return;if(!db.settings)db.settings={};const deleted=deletedTags();deleted.add(tag);db.settings.deletedSongTags=[...deleted];db.settings.songTags=listValues(db.settings.songTags).filter(value=>value!==tag);db.songs.forEach(song=>{song.tags=listValues(song.tags).filter(value=>value!==tag);if(song.cat===tag) song.cat='其他'});save();renderTagTools();prepareMusicFilters();renderSongManager();renderSongbook();alert(`標籤「${tag}」已刪除。`)};
const rawSaveSongForm=w.saveSongForm;
w.saveSongForm=function(){const editId=Number(document.getElementById('sEditId')?.value||0),title=(document.getElementById('sTitle')?.value||'').trim();rawSaveSongForm();if(title)alert(editId?'✓ 標籤與歌曲修改已儲存':'✓ 歌曲已新增')};

/* 測試帳號：功能完整，只隔離統計；冠歌必須有確認彈窗與明確回饋。 */
const rawSubmitCrown=w.submitCrownSong;
w.submitCrownSong=function(id,user,userId){
  if(!isTestPlayer(user))return rawSubmitCrown(id,user,userId);
  const crown=db.crowns.find(item=>Number(item.id)===Number(id));if(!crown)return alert('找不到這首冠歌，請重新整理後再試。');
  const price=Number(crown.price)||0;
  if(!confirm(`👑 冠歌點歌申請\n\n${crown.title}\n卡別：${crown.type||'冠歌'}\n現點價格：${price.toLocaleString()} 探鑽\n\n測試帳號會完整走流程，但不列入正式統計。\n確定送出嗎？`))return;
  db.queue.push({id:Date.now(),songId:crown.songId||null,userId:String(userId),name:user.name,source:'冠歌・現點待確認',status:'待主播確認',saved:false,liveOnly:true,time:now(),crownId:id,crownPrice:price,crownTitle:crown.title,testAccount:true,statsExcluded:true});
  save();renderAll();alert('👑 冠歌點歌申請已送出（測試資料，不計正式統計）。');
};

/* 雲端每次重載後，重新套用刪除標籤 tombstone，避免舊資料覆蓋畫面。 */
const rawLoadCloud=w.loadCloud;
w.loadCloud=async function(){await rawLoadCloud();const deleted=deletedTags();if(deleted.size){db.settings.songTags=listValues(db.settings.songTags).filter(x=>!deleted.has(x));db.songs.forEach(song=>song.tags=listValues(song.tags).filter(x=>!deleted.has(x)));localStorage.setItem(STORAGE_KEY,JSON.stringify(db));}if(document.getElementById('admin')?.classList.contains('show'))renderAdminAll();};

if(document.getElementById('admin')?.classList.contains('show'))renderAdminAll();
console.info('怕怕 PARTY V2 hotfix loaded');
})();
