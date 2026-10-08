export const canonicalLanguage=value=>value==='國語'?'華語':value;
// Search uses the existing local button handler. IME, multiline input and
// unrelated forms retain their normal keyboard behavior.
export function installSearchShortcuts(root=document,instantSearch={}){
 root.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.defaultPrevented||e.isComposing||e.keyCode===229||e.repeat||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey)return;
  const input=e.target;if(input?.tagName!=='INPUT'||!['text','search','email',''].includes(input.type||''))return;
  if(input.closest('.entity-picker'))return;
  if(instantSearch[input.id]){e.preventDefault();instantSearch[input.id](input);return;}
  const scope=input.closest('.toolbar,.catalog-browse-filters,[data-board-audience],form');if(!scope)return;
  const buttons=[...scope.querySelectorAll('button')].filter(b=>/^搜尋(?:玩家|對象|歌曲)?$/.test(b.textContent.trim())&&!b.hidden);
  if(buttons.length!==1)return;
  e.preventDefault();if(!buttons[0].disabled)buttons[0].click();
 });
}
export const catalogGroupKey=row=>String(row?.title||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function eventDescription(event,{playerName=()=>'',songName=()=>'',roomName=id=>id}={}){
 const row=event.after_data||event.before_data||{},details=row.details||{};
 event={...event,actor_role:event.actor_role||event.actorId};
 const role=event.actor_role;
 const actor=event.actor_display_name_snapshot||
  (role==='president'||['admin','super_admin'].includes(role)?'PA Party總裁':
  role==='system'?'系統':
  role==='streamer_admin'?roomName(event.actor_streamer_id||event.streamer_id)||'主播管理員':
  role?.startsWith('streamer:')?roomName(role.slice(9))||'主播管理員':
  role==='player'?playerName(event.actor_player_id)||'玩家':
  '舊紀錄／操作者未知');
 const targetId=row.playerId||row.player_id||event.target_player_id||
  (role==='player'?event.actor_player_id:null);
 const player=event.target_player_name_snapshot||row.name||playerName(targetId)||'玩家';
 const title=row.songSnapshot?.title||row.title||row.titles?.join('、')||details.title||songName(row.songId||row.song_id)||'歌曲',artist=row.songSnapshot?.artist||row.artist;
 const labels={candidate_edit:'編輯待審共同資料',independent:'獨立建立另一首歌曲',different_versions:'建立同一作品的不同版本',approve_new:'建立共同歌曲',confirm_same:'確認是同一首共同歌曲',link_variant:'確認是同一首並連到共同歌曲',create_variant:'建立同一首的不同版本',reject:'判定不是同一首',remove:'移除待審候選',unlink:'從共同曲庫分開',merge_family:'整理為同一首的不同版本',split_variant:'分開共同版本',update_variant:'更新共同主資料',lyric_save:'更新共同歌詞',lyric_choice:'修改歌詞來源',batch_add:'從共同曲庫加入歌本',template_change:'修改共用設定',language_filter:'修改語言篩選'};
 if(event.entity_kind==='shared_catalog'||event.actorId)return `${actor}將《${title}》${labels[event.action]||'更新共同曲庫'}${row.rooms?.length?'（'+row.rooms.map(roomName).join('、')+'）':''}`;
 if(['request_failed','failed_request'].includes(event.action))return `${player}提歌《${title}》失敗：本小時提歌額度已滿`;
 if(event.entity_kind==='players')return `${actor}${event.before_data?'編輯':'新增'}玩家${player}的基本資料`;
 if(event.entity_kind==='queue'){
  const states={waiting:'加入待播',pending:'送出現點，等待確認禮物',completed:'完成演唱',cancelled:'取消待播',stored:'轉為存歌'};
  const description=row.status!=='waiting'?states[row.status]:row.awaitingAcknowledgment?'收到提歌，等待主播確認':row.awaitingPreparation?'已確認，等待準備時間':row.preparationEndsAt?(row.readyAt?'已準備好':`設定準備 ${row.preparationMinutes} 分鐘`):states[row.status];
  return `${actor}為${row.kind==='self'?'主播自帶':player}的《${title}》${description||'修改待播資料'}`;
 }
 if(event.entity_kind==='ledger')return `${actor}調整${player}的存歌紀錄${row.amount!=null?'（'+row.amount+' 首）':''}`;
 if(event.entity_kind==='chat')return `${player}與${roomName(event.streamer_id)}的私訊新增訊息`;
 const kinds={songs:'歌曲',crowns:'冠歌',cards:'卡片',wishes:'許願',settings:'直播設定',meta:'主播設定',board:'留言'};
 return `${actor}${event.action?.includes('delete')||event.before_data&&event.after_data===null?'刪除':event.before_data?'更新':'新增'}${kinds[event.entity_kind]||'操作紀錄'}${row.title||row.songSnapshot?.title?'《'+title+'》'+(artist?'－'+artist:''):''}`;
}
export const actionHints={
 catalogReviewSame:'將你確認相同的來源連到同一筆共同歌曲；主播標籤、Key、歌詞及扣歌設定保留。',
 catalogReviewGroupVersion:'選擇這一組來源，再指定共同作品及版本；不同版本保留獨立歌詞。',
 catalogReviewGroupReject:'只拒絕這一組候選，不會刪除主播歌本或已確認歌曲。',
 catalogReviewLink:'選擇已確認歌曲，決定連到同一版本或另建版本；不刪主播原歌本。',
 catalogReviewAction:'先顯示選取數量供確認，再批次審核或分開關聯；原歌本與歷史保留。',
 catalogSelectAll:'分頁取得目前篩選結果的識別資料，保留跨頁選取，不下載歌詞。',
 catalogBrowse:'搜尋共同歌曲並加入目前主播歌本；已有歌曲不會重複加入。',
 catalogMerge:'把不同版本放到同一作品底下，保留每個版本的歌詞與主播設定。',
 catalogSameVersions:'人工確認多筆為同一版本，選擇保留的共同資料與歌詞；自訂歌詞、私人設定及歷史保留。',
 catalogRestore:'重新啟用停用的共同歌曲，不重新建立或覆寫主播原歌本。',
 catalogSplit:'將已選來源分成另一版本，保留演唱歷史與原歌本。',
 catalogDeactivate:'停用共同歌曲並保留歷史與主播原歌本；之後可重新啟用。',
 catalogScan:'每次核對最多 100 首原歌本，只產生候選，不會自動核准或合併。',
 catalogSharedLyrics:'按需載入共同歌詞；儲存建立新版本，不覆寫主播自訂歌詞。',
 catalogMetadata:'修改全站共同歌名、歌手、語言與版本，相關主播會看到更新；私有設定保留。',
 catalogBatchAdd:'分批將已選共同歌曲加入目前主播歌本，已有的會略過。',
 languageFilterSettings:'設定目前主播歌本顯示哪些語言；不改歌曲內容。',
 proxyDraw:'只抽目前主播可用歌曲，填入代播表單；保留已選玩家，儲存後依原使用方式處理。',
 allocate:'將收到的歌單分配為現點與存歌，總首數保持不變。',
 onBehalf:'代玩家補登點歌與實際時間，仍依所選使用方式計算存歌。',
 queueLyrics:'只在開啟時載入這筆待播的歌詞，玩家不會取得全文。',
 streamerLyrics:'設定目前主播使用的歌詞及私人註記；私人註記不會公開。',
 recordTime:'修改實際生效時間與備註，原始登記時間保留。',
 bulkEditSongs:'只修改你指定的歌曲欄位，其餘設定與歷史保留。',
 fate:'從目前主播符合標籤的可用歌曲抽一首，不會立即送出點歌。',
 draft:'建立本機草稿；修改不會同步到正式站，直到你確認正式同步。',
 publish:'核對正式資料版本後將草稿同步，若資料已變動就停止覆蓋。',
 editHome:'調整目前主播首頁外觀、顯示與排序，保留其他主播的設定。',
 queueOp:'依操作更新待播狀態；完成演唱才扣存歌，取消會解除保留額度。'
};
export function installActionHints(){
 const popup=document.createElement('div');popup.id='action-hint-popup';popup.className='action-hint-popup';popup.setAttribute('role','tooltip');popup.hidden=true;document.body.append(popup);
 popup.setAttribute('popover','manual');let owner=null;
 const hide=()=>{if(popup.matches?.(':popover-open'))popup.hidePopover();popup.hidden=true;owner=null;};
 const show=el=>{hide();owner=el;popup.textContent=el.dataset.hint;const overlay=el.closest('dialog[open]');(overlay||document.body).append(popup);popup.hidden=false;if(popup.showPopover)popup.showPopover();const r=el.getBoundingClientRect();popup.style.left=Math.max(8,Math.min(r.left,innerWidth-popup.offsetWidth-8))+'px';popup.style.top=Math.max(8,r.bottom+6+popup.offsetHeight>innerHeight-8?r.top-popup.offsetHeight-6:r.bottom+6)+'px';};
 function decorate(root){for(const b of root.querySelectorAll('button[data-act]')){const hint=actionHints[b.dataset.act];if(!hint||b.dataset.hintReady)continue;b.dataset.hintReady='1';b.title=hint;const info=document.createElement('button');info.type='button';info.className='action-help';info.textContent='ⓘ';info.dataset.hint=hint;info.setAttribute('aria-label','說明：'+b.textContent);info.setAttribute('aria-describedby',popup.id);{const wrap=document.createElement('span');wrap.className='queue-action-hint action-target-hint';b.before(wrap);wrap.append(b,info);}info.addEventListener('mouseenter',()=>show(info));info.addEventListener('focus',()=>{if(info.matches(':focus-visible'))show(info);});info.addEventListener('mouseleave',hide);info.addEventListener('blur',hide);info.addEventListener('click',e=>{e.stopPropagation();show(info);});}}
 decorate(document);new MutationObserver(()=>{if(owner&&!owner.isConnected)hide();decorate(document);}).observe(document.body,{childList:true,subtree:true});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});document.addEventListener('click',e=>{if(!e.target.closest('.action-help'))hide();});
 document.addEventListener('close',hide,true);document.addEventListener('cancel',hide,true);window.addEventListener('resize',hide);document.addEventListener('scroll',hide,true);
}
