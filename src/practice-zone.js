// 待練區：還沒上架的歌先放這裡（歌詞、標籤、筆記都能先填），學會後一鍵上架到歌本。
// 此模組自帶樣式與事件（data-pz-*），不改動其他頁面。
const STAGES=[
 {id:'want',icon:'💡',name:'想學',hint:'先收藏，還沒開始',pct:14,color:'#7aa2ff'},
 {id:'listen',icon:'🎧',name:'聽熟中',hint:'反覆聽、抓旋律',pct:50,color:'#4dd0c8'},
 {id:'sing',icon:'🎤',name:'練唱中',hint:'開口練、補歌詞',pct:88,color:'#ffb454'}];
const LANGS=['華語','台語','粵語','日語','韓語','英語','其他'];
const CSS=`
.pz{--pz-accent:var(--home-accent,#9a74d1)}
.pz-hero{position:relative;padding:16px 16px 14px;border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--pz-accent) 26%,transparent),color-mix(in srgb,var(--pz-accent) 6%,transparent));border:1px solid color-mix(in srgb,var(--pz-accent) 40%,transparent);overflow:hidden}
.pz-hero::after{content:"🎓";position:absolute;right:10px;top:-6px;font-size:64px;opacity:.12;transform:rotate(12deg)}
.pz-hero h2{margin:0 0 4px;font-size:18px}
.pz-hero p{margin:0;font-size:12.5px;opacity:.78;line-height:1.55;max-width:92%}
.pz-lock{display:inline-flex;align-items:center;gap:4px;margin-top:8px;padding:3px 9px;border-radius:999px;font-size:11px;background:#0003;border:1px solid #fff2}
.pz-bar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}
.pz-bar button{flex:1 1 auto;min-height:40px}
.pz-primary{background:linear-gradient(135deg,var(--pz-accent),color-mix(in srgb,var(--pz-accent) 55%,#000))!important;color:#fff!important;border-color:transparent!important;font-weight:700}
.pz-chips{display:flex;gap:6px;overflow-x:auto;padding:8px 0 10px;scrollbar-width:none}
.pz-chips::-webkit-scrollbar{display:none}
.pz-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:999px;font-size:12.5px;border:1px solid var(--line,#fff2);background:#ffffff08;white-space:nowrap}
.pz-chip b{font-size:11px;min-width:18px;height:18px;line-height:18px;text-align:center;border-radius:9px;background:#ffffff18;font-weight:600}
.pz-chip.on{background:color-mix(in srgb,var(--pz-accent) 32%,transparent);border-color:var(--pz-accent)}
.pz-list{display:grid;gap:10px}
.pz-card{position:relative;padding:13px 13px 12px 16px;border-radius:14px;border:1px solid var(--line,#fff2);background:linear-gradient(180deg,#ffffff0b,#ffffff04);overflow:hidden}
.pz-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--c)}
.pz-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
.pz-title{font-size:16px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.pz-artist{font-size:12.5px;opacity:.72;margin-top:2px}
.pz-stage{flex:none;display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
.pz-meta{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 2px}
.pz-tag{font-size:11px;padding:2px 8px;border-radius:999px;background:#ffffff10;border:1px solid #ffffff14}
.pz-tag.src{background:color-mix(in srgb,var(--pz-accent) 18%,transparent);border-color:color-mix(in srgb,var(--pz-accent) 40%,transparent)}
.pz-progress{display:flex;align-items:center;gap:8px;margin:10px 0 4px}
.pz-track{position:relative;flex:1;height:6px;border-radius:99px;background:#ffffff14}
.pz-fill{position:absolute;inset:0 auto 0 0;border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 55%,#fff0),var(--c))}
.pz-dots{position:absolute;inset:-2px 0;display:flex;justify-content:space-between;padding:0 1px}
.pz-dots i{width:10px;height:10px;border-radius:50%;background:#2a2433;border:2px solid #ffffff22}
.pz-dots i.on{background:var(--c);border-color:var(--c)}
.pz-pct{font-size:11px;opacity:.65;min-width:30px;text-align:right}
.pz-note{font-size:12.5px;line-height:1.55;opacity:.82;margin:6px 0 0;padding:7px 10px;border-radius:9px;background:#00000026}
.pz-due{font-size:11.5px;opacity:.7;margin-top:6px}
.pz-lyr{margin-top:8px}
.pz-lyr summary{cursor:pointer;font-size:12px;opacity:.8;list-style:none}
.pz-lyr summary::-webkit-details-marker{display:none}
.pz-lyr pre{white-space:pre-wrap;font:inherit;font-size:12.5px;line-height:1.7;margin:6px 0 0;padding:9px 11px;border-radius:9px;background:#0000002e;max-height:180px;overflow:auto}
.pz-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:11px}
.pz-actions button{min-height:28px;font-size:12px;padding:3px 10px}
.pz-spacer{flex:1}
.pz-stagesel{display:inline-flex;align-items:center;gap:5px;margin:0;font-size:12px;opacity:.9}
.pz-stagesel select{width:auto;margin:0;min-height:28px;padding:2px 24px 2px 8px;font-size:12px}
.pz-chk{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 4px}
.pz-chk label{display:inline-flex;align-items:center;gap:5px;margin:0;padding:5px 10px;border-radius:999px;border:1px solid var(--line,#fff2);font-size:12.5px;cursor:pointer}
.pz-chk input{width:auto;margin:0}
.pz-chk label:has(input:checked){background:color-mix(in srgb,var(--pz-accent) 30%,transparent);border-color:var(--pz-accent)}
.pz-go{background:linear-gradient(135deg,#ff7eb6,#b36bff)!important;color:#fff!important;border-color:transparent!important;font-weight:600}
.pz-empty{text-align:center;padding:28px 12px;opacity:.75;font-size:13.5px;line-height:1.8}
.pz-empty b{display:block;font-size:30px;margin-bottom:4px}
.pz-help{margin-top:12px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.7;opacity:.8;border:1px dashed #ffffff26}
`;
export function createPracticeZone({h,modal,field,select,area,toast,render,getItems=()=>[],save=async()=>{},publish=async()=>{},getLangs=()=>LANGS,getTags=()=>[]}){
 let filter='all',style=null;
 const items=()=>(getItems()||[]).map(i=>i.stage==='ready'?{...i,stage:'sing'}:i);
 const stage=id=>STAGES.find(s=>s.id===id)||STAGES[0];
 const uid=()=>'pz'+Math.random().toString(36).slice(2,9);
 function ensureStyle(){if(style||typeof document==='undefined')return;style=document.createElement('style');style.id='practice-zone-style';style.textContent=CSS;document.head.append(style);}
 function card(it){const s=stage(it.stage),idx=STAGES.indexOf(s),lyr=String(it.lyrics||'').trim();
  return `<article class="pz-card" data-pz-id="${h(it.id)}" style="--c:${s.color}"><div class="pz-top"><div><div class="pz-title">${h(it.title)}</div><div class="pz-artist">${h(it.artist)}</div></div><span class="pz-stage">${s.icon} ${s.name}</span></div>
  <div class="pz-meta"><span class="pz-tag">${h(it.lang||'華語')}</span>${(it.tags||[]).map(t=>`<span class="pz-tag">#${h(t)}</span>`).join('')}<span class="pz-tag src">${it.source==='catalog'?'📚 共同曲庫':'✍️ 自己新增'}</span></div>
  <div class="pz-progress"><div class="pz-track"><div class="pz-fill" style="width:${s.pct}%"></div><div class="pz-dots">${STAGES.map((_,i)=>`<i class="${i<=idx?'on':''}"></i>`).join('')}</div></div><span class="pz-pct">${s.pct}%</span></div>
  ${it.note?`<p class="pz-note">📝 ${h(it.note)}</p>`:''}${it.due?`<div class="pz-due">🎯 預計上架：${h(it.due)}</div>`:''}
  ${lyr?`<details class="pz-lyr"><summary>📜 歌詞（${lyr.split(/\\n/).filter(Boolean).length} 行）· 點開查看</summary><pre>${h(lyr)}</pre></details>`:'<div class="pz-due">📜 還沒填歌詞</div>'}
  <div class="pz-actions"><label class="pz-stagesel">階段<select data-pz="stage" data-id="${h(it.id)}">${STAGES.map(x=>`<option value="${x.id}" ${x.id===it.stage?'selected':''}>${x.icon} ${x.name}</option>`).join('')}</select></label><span class="pz-spacer"></span><button type="button" class="pz-go" data-pz="publish" data-id="${h(it.id)}">🎉 上架到歌本</button><button type="button" data-pz="edit" data-id="${h(it.id)}">編輯</button><button type="button" class="danger" data-pz="remove" data-id="${h(it.id)}">刪除</button></div></article>`;}
 function html(){ensureStyle();const count=id=>items().filter(i=>id==='all'||i.stage===id).length,rows=items().filter(i=>filter==='all'||i.stage===filter);
  return `<div class="pz"><div class="pz-hero"><h2>🎓 待練區</h2><p>還在練、還沒要上架的歌，先把歌名、歌詞、標籤都填好放這裡。學會了按一下就進歌本，資料直接沿用。</p><span class="pz-lock">🔒 只有你看得到・不會出現在歌本、也不能被點</span></div>
  <div class="pz-bar"><button type="button" class="pz-primary" data-pz="add">＋ 新增待練歌</button><button type="button" data-pz="catalog">📚 從共同曲庫挑歌</button></div>
  <div class="pz-chips" role="tablist">${[{id:'all',icon:'🗂️',name:'全部'},...STAGES].map(s=>`<button type="button" class="pz-chip ${filter===s.id?'on':''}" data-pz="filter" data-id="${s.id}">${s.icon} ${s.name}<b>${count(s.id)}</b></button>`).join('')}</div>
  <div class="pz-list">${rows.map(card).join('')||`<div class="pz-empty"><b>🎶</b>這裡還沒有歌<br>想練的歌先丟進來，慢慢練到可以上架</div>`}</div>
  <div class="pz-help">階段說明：${STAGES.map(s=>`${s.icon}${s.name}（${s.hint}）`).join(' → ')}</div></div>`;}
 function form(it={}){const langs=[...new Set([...getLangs(),...(it.lang?[it.lang]:[])])],tags=[...new Set([...getTags(),...(it.tags||[])])];
  return field('title','歌名',it.title||'','text','required maxlength="80"')+field('artist','歌手',it.artist||'','text','required maxlength="60"')+select('lang','語言（和歌本的語言一致）',langs,it.lang||langs[0]||'華語')+select('stage','目前階段',STAGES.map(s=>[s.id,s.icon+' '+s.name]),it.stage||'want')+`<div class="full"><span>標籤（和歌本的標籤一致）</span><div class="pz-chk">${tags.map(t=>`<label><input type="checkbox" name="tag" value="${h(t)}" ${(it.tags||[]).includes(t)?'checked':''}>#${h(t)}</label>`).join('')||'<small>歌本還沒有標籤，上架時再選。</small>'}</div></div>`+field('due','預計上架日（可不填）',it.due||'','date')+area('lyrics','歌詞（可先貼，之後再補）',it.lyrics||'')+area('note','備註／練習筆記（哪裡還不熟、key 要不要調…）',it.note||'');}
 const parse=f=>({title:String(f.get('title')||'').trim(),artist:String(f.get('artist')||'').trim(),lang:f.get('lang')||'華語',stage:f.get('stage')||'want',tags:f.getAll('tag').slice(0,20),due:f.get('due')||'',lyrics:String(f.get('lyrics')||''),note:String(f.get('note')||'').trim()});
 async function run(fn){try{await fn();}catch(err){toast(err.message||'儲存失敗');}}
 function click(e){const b=e.target.closest?.('[data-pz]');if(!b)return;const act=b.dataset.pz,id=b.dataset.id,it=items().find(x=>x.id===id);
  if(act==='filter'){filter=id;render();}
  else if(act==='add')modal('＋ 新增待練歌',form(),async f=>{const v=parse(f);if(!v.title||!v.artist)throw Error('請填歌名與歌手');await save([{id:uid(),source:'manual',...v},...items()]);toast('已放進待練區');});
  else if(act==='edit'&&it)modal('編輯待練歌',form(it),async f=>{const v=parse(f);if(!v.title||!v.artist)throw Error('請填歌名與歌手');await save(items().map(x=>x.id===id?{...x,...v}:x));toast('已儲存');});
  else if(act==='publish'&&it){if(confirm('「'+it.title+'」學會了？上架後玩家就能在歌本看到、也能點這首。'))run(async()=>{await publish(it);toast('已上架到歌本');});}
  else if(act==='remove'&&it){if(confirm('從待練區刪除「'+it.title+'」？'))run(()=>save(items().filter(x=>x.id!==id)));}
  else if(act==='catalog')document.querySelector('[data-act=adminTab][data-id=catalog]')?.click();}
 function change(e){const b=e.target.closest?.('select[data-pz=stage]');if(!b)return;const it=items().find(x=>x.id===b.dataset.id);if(it&&it.stage!==b.value)run(async()=>{await save(items().map(x=>x.id===it.id?{...x,stage:b.value}:x));toast('階段：'+stage(b.value).name);});}
 async function addFromCatalog(row){if(items().some(i=>i.variantId&&i.variantId===row.variantId)){toast('這首已經在待練區');return;}await run(async()=>{await save([{id:uid(),source:'catalog',stage:'want',tags:[],...row},...items()]);toast('已加入待練區（想學）');});}
 if(typeof document!=='undefined'){document.addEventListener('click',click);document.addEventListener('change',change);}
 async function addMany(rows){const have=new Set(items().filter(i=>i.variantId).map(i=>i.variantId)),fresh=[];for(const r of rows){if(!r.variantId||have.has(r.variantId))continue;have.add(r.variantId);fresh.push({id:uid(),source:'catalog',stage:'want',tags:[],...r});}if(!fresh.length){toast('這些歌都已經在待練區');return 0;}let ok=0;await run(async()=>{await save([...fresh,...items()]);ok=fresh.length;toast('已加入待練區 '+ok+' 首（想學）');});return ok;}
 return {html,items,addFromCatalog,addMany};
}
