// 跨主播熱門歌曲榜：只在管理後台顯示；資料由後端一次算好（60 秒快取），這裡不輪詢。
const PERIODS=[['today','🔥 今日'],['week','🎤 近 7 天'],['month','👑 本月'],['all','⭐ 累計']];
const ORIGINS=[['all','全部'],['player','玩家自點'],['proxy','主播代點']];
const CSS=`
.rk{--rk:var(--home-accent,#9a74d1)}
.rk-hero{padding:14px;border-radius:16px;border:1px solid color-mix(in srgb,var(--rk) 45%,transparent);background:linear-gradient(135deg,color-mix(in srgb,var(--rk) 24%,transparent),color-mix(in srgb,var(--rk) 5%,transparent))}
.rk-hero h2{margin:0 0 4px;font-size:18px}.rk-hero p{margin:0;font-size:12.5px;opacity:.78;line-height:1.55}
.rk-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 6px}.rk-tabs button{flex:1 1 auto;min-width:0;min-height:36px;font-size:12.5px;padding:4px 8px}
.rk-tabs button.on{background:color-mix(in srgb,var(--rk) 34%,transparent);border-color:var(--rk)}
.rk-list{display:grid;gap:8px;margin-top:8px}
.rk-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid var(--home-line,var(--line,#fff2));background:#ffffff08}
.rk-row.top{background:color-mix(in srgb,var(--rk) 14%,transparent);border-color:color-mix(in srgb,var(--rk) 45%,transparent)}
.rk-no{font-size:22px;text-align:center;line-height:1}.rk-no small{display:block;font-size:11px;opacity:.7;margin-top:2px}
.rk-title{font-weight:700;overflow-wrap:anywhere}.rk-sub{font-size:12px;opacity:.72;overflow-wrap:anywhere}
.rk-n{text-align:right;font-size:12px;opacity:.9}.rk-n b{display:block;font-size:20px}
.rk-chg{font-size:11px}.rk-up{color:#5fd39a}.rk-down{color:#f299ab}
.rk-note{margin-top:10px;font-size:12px;line-height:1.7;opacity:.75;padding:9px 11px;border-radius:10px;border:1px dashed #ffffff26}
`;
export function createSongRanking({h,api,render,toast}){
 let period='week',origin='all',style=null;const cache=new Map();let loading='';
 const key=()=>period+'|'+origin;
 function ensureStyle(){if(style||typeof document==='undefined')return;style=document.createElement('style');style.textContent=CSS;document.head.append(style);}
 async function load(force=false){const k=key(),hit=cache.get(k);if(!force&&hit&&Date.now()-hit.at<60000)return;if(loading===k)return;loading=k;try{const data=await api({op:'songRanking',period,origin,management:true});cache.set(k,{at:Date.now(),data});}catch(err){cache.set(k,{at:Date.now(),error:err.message||'讀取失敗'});}finally{if(loading===k)loading='';render();}}
 const medal=r=>r===1?'🥇':r===2?'🥈':r===3?'🥉':String(r);
 function change(r,hasPrev){if(!hasPrev)return '';if(r.prevRank==null)return '<span class="rk-chg">🆕 新上榜</span>';const d=r.prevRank-r.rank;return d>0?`<span class="rk-chg rk-up">▲ ${d}</span>`:d<0?`<span class="rk-chg rk-down">▼ ${-d}</span>`:'<span class="rk-chg">－</span>';}
 function html(){ensureStyle();const k=key(),hit=cache.get(k);if(!hit||Date.now()-hit.at>=60000)setTimeout(()=>load(),0);
  let body;if(!hit)body='<div class="rk-note">讀取排行榜中…</div>';else if(hit.error)body=`<div class="rk-note error">${h(hit.error)}</div>`;else{const d=hit.data,rows=d.rows||[];
   body=rows.length?`<div class="rk-list">${rows.map(r=>`<div class="rk-row ${r.rank<=3?'top':''}"><div class="rk-no">${medal(r.rank)}${r.rank<=3?'':''}</div><div><div class="rk-title">${h(r.title)}${r.versionLabel?` <small>（${h(r.versionLabel)}）</small>`:''}</div><div class="rk-sub">${h(r.artist)} · ${r.streamers} 位主播收到 · 玩家自點 ${r.player}／主播代點 ${r.proxy} ${change(r,d.hasPrev)}</div></div><div class="rk-n"><b>${r.count}</b>次</div></div>`).join('')}</div>`:'<div class="rk-note">這段期間還沒有點歌紀錄 🎶</div>';}
  return `<div class="rk"><div class="rk-hero"><h2>🏆 PA Party 熱門歌曲榜</h2><p>整個平台一起算：同一首歌（同版本）不管哪位主播收到都合併。只統計已完成演唱的有效點歌，取消和測試不計入，隱藏歌曲不顯示。</p></div>
  <div class="rk-tabs" role="tablist">${PERIODS.map(([id,l])=>`<button type="button" class="${period===id?'on':''}" data-rk="period" data-id="${id}">${l}</button>`).join('')}</div>
  <div class="rk-tabs">${ORIGINS.map(([id,l])=>`<button type="button" class="${origin===id?'on':''}" data-rk="origin" data-id="${id}">${l}</button>`).join('')}</div>
  ${body}<div class="rk-note">排名變化是和上一期比較（今日→昨天、近 7 天→再前 7 天、本月→上個月）。累計沒有上一期可比。「玩家自點」包含玩家自己抽歌；「主播代點」是主播幫玩家補登或代抽，兩者可分開看，避免榜單被大量代點拉高。舊資料來源不明的只算在「全部」。</div></div>`;}
 function click(e){const b=e.target.closest?.('[data-rk]');if(!b)return;if(b.dataset.rk==='period')period=b.dataset.id;else origin=b.dataset.id;render();}
 if(typeof document!=='undefined')document.addEventListener('click',click);
 return {html};
}
