// 每月統計：每天收到幾首、唱幾首。自帶樣式與事件（data-ms），顏色跟隨主播主題。
const WD='日一二三四五六';
const CSS=`.ms{--ms-a:var(--home-accent,#9a74d1);margin-bottom:14px;padding:14px 14px 10px;border-radius:18px;background:linear-gradient(160deg,color-mix(in srgb,var(--ms-a) 22%,transparent),color-mix(in srgb,var(--ms-a) 5%,transparent));border:1px solid var(--home-line,var(--line,#ffffff22))}
.ms-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 12px}
.ms-nav b{font-size:17px;min-width:128px;text-align:center}
.ms-nav button{min-height:30px;min-width:34px;padding:2px 10px;border-radius:999px}
.ms-nav button[disabled]{opacity:.35}
.ms-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.ms-card{padding:10px 4px 9px;border-radius:16px;text-align:center;background:var(--home-panel,#ffffff0d);border:1px solid var(--home-line,var(--line,#ffffff1a))}
.ms-card .e{display:block;font-size:20px;line-height:1.2}.ms-card b{display:block;font-size:24px;line-height:1.2;margin-top:2px}.ms-card small{opacity:.8;font-size:11px}
.ms-best{margin:10px 0 0;padding:7px 10px;border-radius:12px;font-size:12.5px;text-align:center;background:color-mix(in srgb,#ffd36e 16%,transparent)}
.ms-key{display:flex;justify-content:center;gap:14px;font-size:11.5px;opacity:.9;margin:12px 0 4px}
.ms-key i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.ms-list{display:grid}
.ms-row{display:grid;grid-template-columns:44px 22px minmax(0,1fr) auto;align-items:center;gap:6px;padding:7px 0;border-top:1px dashed var(--home-line,#ffffff1a);font-size:13px}
.ms-row b{font-weight:700}.ms-row i{font-style:normal;opacity:.65;font-size:11px}
.ms-bars{display:grid;gap:3px}.ms-bar{height:7px;border-radius:999px;min-width:3px}
.ms-bar.r{background:var(--ms-a)}.ms-bar.s{background:#ffb454}
.ms-n{display:flex;gap:6px;font-size:12px;white-space:nowrap}.ms-n{align-items:center}.ms-n em{font-style:normal;min-width:34px;text-align:right}
.ms-row.off{opacity:.55}.ms-off{grid-column:3/-1;font-size:12px}
.ms-row.today{background:color-mix(in srgb,var(--ms-a) 14%,transparent);border-radius:10px;margin:0 -6px;padding:7px 6px}
.ms-tag{font-size:10px;padding:1px 6px;border-radius:999px;background:var(--ms-a);color:#fff;margin-left:2px}
.ms-mark{grid-column:3/-1;font-size:11px;margin-top:-2px}
.ms-state{padding:22px 8px;text-align:center;opacity:.85;font-size:13px}
.ms-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0 0;font-size:11px;opacity:.75}
.ms-foot button{min-height:26px;padding:1px 10px;font-size:11px}
@media(max-width:360px){.ms-row{grid-template-columns:40px 18px minmax(0,1fr) auto}.ms-card b{font-size:21px}.ms-n{align-items:center}.ms-n em{min-width:30px}}`;
export function createMonthStats({fetchMonth,today,onChange,scope=()=>''}){
 const cache=new Map(),key=m=>scope()+'|'+m;let month='',loading=false,error='';
 const dayOf=()=>today();
 const curMonth=()=>dayOf().slice(0,7);
 function shift(m,n){const[y,mo]=m.split('-').map(Number),d=new Date(Date.UTC(y,mo-1+n,1));return d.toISOString().slice(0,7);}
 function ensureStyle(){if(document.getElementById('month-stats-style'))return;const s=document.createElement('style');s.id='month-stats-style';s.textContent=CSS;document.head.append(s);}
 const fresh=(m,entry)=>entry&&(m<curMonth()?Date.now()-entry.at<3600e3:Date.now()-entry.at<120e3);
 async function load(m,force=false){
  if(loading)return;const hit=cache.get(key(m));if(!force&&fresh(m,hit))return;
  loading=true;error='';onChange();
  try{let f=force,r,n=0;do{n++;r=await fetchMonth(m,f);f=false;cache.set(key(m),{days:r.days||[],at:r.complete===false?0:Date.now()});if(r.complete===false)onChange();}while(r.complete===false&&n<12);}catch(e){error=e?.message||'讀取失敗';}
  loading=false;onChange();
 }
 function ensure(){if(!month)month=curMonth();if(!loading&&!error&&!fresh(month,cache.get(key(month))))load(month);}
 function html(){
  ensureStyle();if(!month)month=curMonth();
  const entry=cache.get(key(month)),[y,mo]=month.split('-'),t=dayOf();
  const nav=`<div class="ms-nav"><button type="button" data-ms="prev" aria-label="上個月">‹</button><b>🗓️ ${y} 年 ${Number(mo)} 月</b><button type="button" data-ms="next" aria-label="下個月" ${month>=curMonth()?'disabled':''}>›</button></div>`;
  if(!entry){return `<section class="ms">${nav}<div class="ms-state">${error?`${error}<br><button type="button" data-ms="retry" class="tiny">重試</button>`:'🎵 統計中…'}</div></section>`;}
  const days=entry.days.slice().sort((a,b)=>a.day<b.day?1:-1),mx=Math.max(1,...days.map(d=>Math.max(d.received,d.sung)));
  const rec=days.reduce((n,d)=>n+d.received,0),sung=days.reduce((n,d)=>n+d.sung,0),on=days.filter(d=>d.received||d.sung).length;
  const best=days.reduce((a,d)=>d.sung>(a?.sung||0)?d:a,null);
  const bestLine=best&&best.sung?`<p class="ms-best">⭐ 本月最忙的一天：${Number(best.day.slice(5,7))}/${Number(best.day.slice(8))}，唱了 ${best.sung} 首</p>`:'';
  const row=d=>{const dt=new Date(d.day+'T00:00:00Z'),label=`${d.day.slice(5,7)}/${d.day.slice(8)}`,w=WD[dt.getUTCDay()],isToday=d.day===t,tag=isToday?'<span class="ms-tag">今天</span>':'',star=best&&best.sung&&d.day===best.day?'<span class="ms-star">⭐</span>':'';
   const head=`<b>${label}</b><i>${w}</i>`;
   if(!d.received&&!d.sung)return `<div class="ms-row off ${isToday?'today':''}">${head}<span class="ms-off">${isToday?'🌱 今天還沒有紀錄':'😴 休息'}</span></div>`;
   return `<div class="ms-row ${isToday?'today':''}">${head}<div class="ms-bars"><div class="ms-bar r" style="width:${Math.max(3,d.received/mx*100).toFixed(0)}%"></div><div class="ms-bar s" style="width:${Math.max(3,d.sung/mx*100).toFixed(0)}%"></div></div><span class="ms-n">${tag}${star}<em>🎁 ${d.received}</em><em>🎤 ${d.sung}</em></span></div>`;};
  const list=days.length?`<div class="ms-list">${days.map(row).join('')}</div>`:'<div class="ms-state">這個月還沒有資料 🌱</div>';
  return `<section class="ms">${nav}<div class="ms-cards"><div class="ms-card"><span class="e">🎁</span><b>${rec}</b><small>收到新歌</small></div><div class="ms-card"><span class="e">🎤</span><b>${sung}</b><small>已唱</small></div><div class="ms-card"><span class="e">🌙</span><b>${on}</b><small>開台天數</small></div></div>${bestLine}<div class="ms-key"><span><i style="background:var(--ms-a)"></i>收到新歌</span><span><i style="background:#ffb454"></i>已唱</span></div>${loading?'<div class="ms-state">更新中…</div>':''}${list}<div class="ms-foot"><span>依換場時間計算，不含測試資料</span><button type="button" data-ms="refresh">重新計算</button></div></section>`;
 }
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-ms]');if(!b)return;const a=b.dataset.ms;
  if(a==='prev'){month=shift(month||curMonth(),-1);error='';load(month);onChange();}
  else if(a==='next'&&month<curMonth()){month=shift(month,1);error='';load(month);onChange();}
  else if(a==='retry'){error='';load(month||curMonth(),true);}
  else if(a==='refresh')load(month||curMonth(),true);});
 return {html,ensure,reset(){cache.clear();error='';}};
}
