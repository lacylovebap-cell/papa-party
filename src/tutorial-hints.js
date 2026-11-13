// Small "?" icons beside feature headings. Purely local: no fetch, no database.
// The tutorial files are only requested after someone presses "查看完整教學".
const norm=t=>String(t||'').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'').replace(/^\d+/,'');
export const HINTS=[
 {a:'streamer',t:['待播','待播管理'],id:'S01',text:'管理目前排隊的歌：完成、取消、過檔與排序。'},
 {a:'streamer',t:['批次操作'],id:'S17',text:'一次選多首待播歌，統一完成或取消。'},
 {a:'streamer',t:['專屬網址與QRCode'],id:'S11',text:'複製你的專屬網址與 QR Code 給玩家。'},
 {a:'streamer',t:['首頁主題設計'],id:'S07',text:'自訂你首頁、歌本與玩家頁的配色與圖片。'},
 {a:'streamer',t:['直播與價格'],id:'S12',text:'設定直播狀態與你的點歌價格。'},
 {a:'streamer',t:['歌詞處理'],id:'S13',text:'替歌曲整理歌詞與註記。'},
 {a:'streamer',t:['手動授予勳章'],id:'S16',text:'在勳章管理中查看與授予勳章。'},
 {a:'streamer',t:['玩家最近活動'],id:'S05',text:'查看玩家活動並進入玩家管理。'},
 {a:'streamer',t:['冠歌卡'],id:'S06',text:'設定冠歌卡的樣式與可冠歌的歌。'},
 {a:'player',t:['我的存歌'],id:'P02',text:'你的存歌額度與歌曲倍率怎麼算。'},
 {a:'player',t:['我的跨主播待播'],id:'P11',text:'同時向不同主播點歌與查看排隊。'},
 {a:'player',t:['登入帳號'],id:'P06',text:'登入、換裝置與帳號相關說明。'},
 {a:'player',t:['目前操作','我的目前操作','歷史紀錄','最近紀錄'],id:'P05',text:'查看點歌紀錄、取消與過檔後的狀態。'},
 {a:'player',t:['本機推播檢查'],id:'P04',text:'通知沒收到時，照步驟檢查本機設定。'}
];
const CSS=`.pa-hint{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:var(--help-d,24px)!important;height:var(--help-d,24px)!important;min-width:var(--help-d,24px)!important;min-height:var(--help-d,24px)!important;max-width:var(--help-d,24px);aspect-ratio:1;margin-left:6px;padding:0!important;border-radius:50%!important;border:1px solid var(--home-accent,#9b7bff)!important;background:transparent!important;box-shadow:none!important;color:var(--home-accent,#9b7bff)!important;font:700 var(--fs-xs,12px)/1 system-ui,sans-serif;cursor:pointer;vertical-align:middle;flex:none}
.pa-hint:hover,.pa-hint:focus-visible{background:var(--home-accent,#9b7bff);color:var(--home-panel,#1c1626)}
.pa-hint-pop{position:fixed;z-index:2147483000;max-width:min(300px,calc(100vw - 16px));padding:12px 34px 12px 12px;border-radius:12px;border:1px solid var(--home-line,#6d50a3);background:var(--home-panel,#2a2236);color:var(--home-text,#f4eefc);font-size:13px;line-height:1.6;box-shadow:0 8px 24px #0009}
.pa-hint-pop p{margin:0 0 8px}.pa-hint-pop button[data-hint-go]{border:0;border-radius:8px;padding:6px 10px;background:var(--home-accent,#9b7bff);color:var(--home-panel,#1c1626);font-weight:700;cursor:pointer}
.pa-hint-pop .pa-hint-x{position:absolute;top:4px;right:4px;width:28px;height:28px;border:0;background:transparent;color:inherit;font-size:16px;cursor:pointer}`;
export function createTutorialHints({document,tutorials,getAudience}){
 const win=document.defaultView||globalThis;let pop=null,owner=null,queued=false;
 const aud=()=>getAudience()==='streamer'?'streamer':'player';
 const find=text=>{const n=norm(text),a=aud();return HINTS.find(h=>h.a===a&&h.t.some(x=>norm(x)===n));};
 function close(){if(pop){pop.remove();pop=null;}owner=null;}
 function open(btn,hint){close();owner=btn;pop=document.createElement('div');pop.className='pa-hint-pop';pop.setAttribute('role','dialog');
  pop.innerHTML='<button type="button" class="pa-hint-x" aria-label="關閉說明">✕</button><p></p><button type="button" data-hint-go>📖 查看完整教學</button>';
  pop.querySelector('p').textContent=hint.text;pop.querySelector('[data-hint-go]').addEventListener('click',()=>{const id=hint.id;close();tutorials.open({id});});
  pop.querySelector('.pa-hint-x').addEventListener('click',close);document.body.append(pop);
  const r=btn.getBoundingClientRect(),w=pop.offsetWidth;pop.style.top=Math.min(win.innerHeight-pop.offsetHeight-8,r.bottom+6)+'px';pop.style.left=Math.max(8,Math.min(win.innerWidth-w-8,r.left-20))+'px';}
 function scan(){queued=false;if(!document.getElementById('pa-hint-css')){const s=document.createElement('style');s.id='pa-hint-css';s.textContent=CSS;document.head.append(s);}
  for(const el of document.querySelectorAll('h2,h3,summary,legend')){if(el.closest('dialog,.pa-hint-pop,.ts-root')||el.querySelector(':scope > .pa-hint')||el.nextElementSibling?.classList?.contains('pa-hint'))continue;const hint=find(el.textContent.replace('?',''));if(!hint)continue;
   const b=document.createElement('button');b.type='button';b.className='pa-hint';b.textContent='?';b.setAttribute('aria-label','這個功能的說明');b._hint=hint;
   el.append(b);}}
 const queue=()=>{if(!queued){queued=true;win.requestAnimationFrame(scan);}};
 document.addEventListener('click',e=>{const b=e.target.closest?.('.pa-hint');if(b){e.preventDefault();e.stopPropagation();if(owner===b)close();else open(b,b._hint);return;}if(pop&&!pop.contains(e.target))close();},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 win.addEventListener('scroll',close,{passive:true,capture:true});win.addEventListener('resize',close);
 new win.MutationObserver(queue).observe(document.body,{childList:true,subtree:true});queue();
 return {scan,close};
}
