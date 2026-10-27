// 首頁主題設計 — interactive editor (controls + live preview).
// All edits stay in this module's memory. The network is used only for:
// one access check when opening, one hall-theme read when switching to the
// hall, image uploads on save/publish, and the save/publish write itself.
import {THEME_COLOR_KEYS,THEME_COLOR_LABELS,THEME_TEMPLATES,THEME_SWATCHES,THEME_IMAGE_ROLES,THEME_IMAGE_DEFAULTS,THEME_DECOR_LIMIT,
 themeSmartPalette,themeNormalize,themeValidate,themeContrastReport,themeAsset,themeImageValue,themeSame,themeImageUrls,themeLuminance} from './theme-engine.js?v=10.28-THEME.1';
import {themeApply,themeBannerImageStyle,themeDecorHtml} from './theme-render.js?v=10.28-THEME.1';
import {themeCompressImage,themeBlobBase64,themeKB} from './theme-image.js?v=10.28-THEME.1';
import {THEME_LOCKED_MESSAGE} from './theme-access.js?v=10.28-THEME.1';

const LOCAL_HOST='https://local.preview';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const THEME_HELP={
 target:'選擇要設計的頁面。主播主題會套用到主播首頁、歌本、玩家頁與主播後台；廳主題只套用到廳首頁。兩者互不覆蓋。',
 base:'選一個你喜歡的顏色（任何顏色都可以）。系統會用它自動搭配整套協調的配色。不需要上傳圖片。',
 smart:'依目前主色與深淺模式，重新產生整套建議配色（包含背景、卡片、按鈕、文字）。會覆蓋你個別微調過的顏色。',
 mode:'深色：深底亮字；淺色：淺底深字。切換後會自動重新搭配，但保留你手動微調過的顏色。',
 button:'漸層：按鈕主色漸變到第二色；單色：只用按鈕主色。按鈕形狀、大小與圓角都不會改變。',
 logo:'Logo 後方的底色。Logo 圖案本身不會改變。Logo 是發光混合效果，底色太淺會讓 Logo 變淡，建議使用深色。',
 panel:'所有卡片的底色。沒有上傳卡片底圖時，卡片就顯示這個純色。',
 colors:'可以個別修改任一顏色，其他顏色不會被重置。按 ↺ 可以讓該顏色回到自動配色。',
 background:'整個頁面最底層的圖片，主播首頁、歌本、後台都會看到。不上傳就用純色底色。可拖曳小框中的圓點決定圖片焦點。',
 banner:'首頁最上方的橫幅圖。不上傳就沿用原本的主圖。可拖曳預覽中的圖片或小框圓點，調整顯示焦點。',
 card:'所有一般卡片（搜尋歌本、新練歌曲、公告等）共用的一張底圖。不上傳就是純色卡片。',
 decor:'透明貼圖或插畫（建議 PNG／WebP 透明背景），可在預覽中直接拖曳位置。只顯示在首頁，不會擋住點歌、搜尋或登入按鈕。',
 opacity:'圖片顯示程度：0% 完全透明、50% 半透明、100% 完全顯示。只影響圖片本身，文字與按鈕不會變透明。',
 mask:'遮罩深淺：在圖片上蓋一層與頁面底色相同的顏色，數值越高圖片越暗（淺色模式越淡），文字越清楚。和透明度是兩支不同的滑桿。',
 maskWidth:'遮罩寬度：遮罩覆蓋範圍的寬窄（以橫幅寬度的百分比計算，手機和電腦都會等比例套用）。',
 maskPosition:'遮罩位置：把遮罩主要覆蓋的區域往左或往右移。0% 在最左、100% 在最右。也可以直接拖曳預覽中的中央控制線。',
 maskFeather:'遮罩羽化：遮罩邊緣的柔和程度。數值低邊界較明顯，數值高過渡較自然。',
 hallCard:'同一張橫幅圖也會顯示在廳首頁的主播卡片。卡片比例不同，所以可以另外調整焦點與顯示程度，不需要再上傳一次圖片，也不會改變你的主播首頁橫幅。',
 draft:'儲存草稿：保存目前設定，但玩家仍看到上一次發布的版本。下次打開編輯器會從草稿繼續。',
 publish:'發布主題：正式套用到玩家看得到的頁面。同一位主播的首頁、歌本、後台會一起換成新主題。',
 reset:'還原 PA Party 原本的預設外觀。不會刪除任何歌曲、玩家或其他設定。需按「發布主題」才會套用到玩家頁面。'
};

export function openThemeStudio(options){
 const {api,room,settings,saveStreamer,toast,songs=[],hallName='本廳',defaultBanner='',streamerNames=[],onClose=()=>{}}=options;
 document.querySelector('.ts-root')?.remove();
 const pending=new Map();// hash -> prepared image (local, not uploaded)
 const knownUrls=new Map();// hash -> real uploaded url
 const remember=t=>{for(const u of themeImageUrls(t)){const a=themeAsset(u);if(a&&!u.startsWith(LOCAL_HOST))knownUrls.set(a.hash,u);}};
 const ui={target:'streamer',page:'home',device:'mobile',access:null,accessError:'',busy:false,guides:true,status:''};
 const targets={streamer:makeTarget(settings?.theme||null,settings?.themeDraft||null,room.id,false),hall:null};
 remember(settings?.theme);remember(settings?.themeDraft);
 function makeTarget(published,draft,owner,hall){
  const base=draft||published,working=base?themeNormalize(base,{hall}):themeNormalize({base:'#8b5cf6',mode:'dark'},{hall});
  return {owner,hall,published:published?themeNormalize(published,{hall}):null,draft:draft?themeNormalize(draft,{hall}):null,working,manual:new Set(working.manual||[]),reset:false,dirty:false,fromDraft:!!draft};
 }
 const current=()=>targets[ui.target];
 const features=()=>ui.target==='hall'?ui.access?.hall?.features||[]:ui.access?.streamer?.features||[];
 const can=kind=>features().includes((ui.target==='hall'?'theme_hall_':'theme_streamer_')+kind);
 const resolve=url=>{if(typeof url==='string'&&url.startsWith(LOCAL_HOST)){const a=themeAsset(url);return pending.get(a?.hash)?.localUrl||'';}return url;};

 // ---------- shell ----------
 const root=document.createElement('div');root.className='ts-root';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','首頁主題設計');
 root.innerHTML=`<div class="ts-top"><strong>🎨 首頁主題設計</strong><span class="ts-status" data-ts-status></span><button type="button" class="ts-btn ts-ghost" data-ts="close" aria-label="關閉">✕</button></div>
 <div class="ts-body"><div class="ts-preview-col"><div class="ts-preview-bar"><div class="ts-seg" data-ts-pages></div><div class="ts-seg"><button type="button" data-ts-device="mobile" class="on">📱 手機</button><button type="button" data-ts-device="desktop">🖥 電腦</button></div></div>
 <div class="ts-frame-wrap" data-ts-wrap><iframe class="ts-frame" title="主題即時預覽" data-ts-frame></iframe></div><p class="ts-note">預覽只在這台裝置計算，不會寫入資料庫，也不會影響玩家頁面。</p></div>
 <div class="ts-controls" data-ts-controls></div></div>
 <div class="ts-actions"><button type="button" class="ts-btn ts-ghost" data-ts="discard">放棄未儲存修改</button><button type="button" class="ts-btn ts-ghost" data-ts="reset">還原預設</button><span class="ts-grow"></span><button type="button" class="ts-btn" data-ts="draft">儲存草稿</button><button type="button" class="ts-btn ts-main" data-ts="publish">發布主題</button></div>
 <div class="ts-help-pop" data-ts-help-pop hidden></div>`;
 document.body.append(root);document.documentElement.classList.add('ts-open');
 const $=s=>root.querySelector(s),frame=$('[data-ts-frame]');
 let doc=null,frameReady=false,raf=0;

 // ---------- controls ----------
 const help=key=>`<button type="button" class="ts-help" data-help="${key}" aria-label="說明">?</button>`;
 const slider=(path,label,value,min=0,max=100,helpKey='',unit='%',disabled=false)=>`<label class="ts-slider"><span>${h(label)} ${helpKey?help(helpKey):''}<output>${value}${unit}</output></span><input type="range" min="${min}" max="${max}" value="${value}" data-path="${path}" ${disabled?'disabled':''}></label>`;
 function locked(text){return `<p class="ts-locked">🔒 ${h(text||THEME_LOCKED_MESSAGE)}</p>`;}
 function imageBlock(role){
  const t=current().working,img=themeImageValue(t.images[role],role),has=!!t.images[role]?.url,spec=THEME_IMAGE_ROLES[role],dis=!can('images');
  const prepared=has&&t.images[role].url.startsWith(LOCAL_HOST)?pending.get(themeAsset(t.images[role].url)?.hash):null;
  const shown=has?resolve(t.images[role].url):role==='banner'&&ui.target==='streamer'?defaultBanner:'';
  let html=`<div class="ts-img-row"><label class="ts-btn ts-file ${dis?'disabled':''}">${has?'更換圖片':'上傳圖片'}<input type="file" accept="image/png,image/webp,image/jpeg" data-upload="${role}" ${dis?'disabled':''}></label>${has?`<button type="button" class="ts-btn ts-ghost" data-remove="${role}" ${dis?'disabled':''}>移除圖片（恢復${role==='banner'?'原本主圖':'純色'}）</button>`:''}</div>
  <p class="ts-hint">建議來源尺寸 ${spec.source}，其他比例也可以，系統會自動縮放與壓縮成 WebP（目標約 ${spec.targetKB} KB）。${prepared?`<br>✅ 已壓縮：${prepared.width}×${prepared.height}，${themeKB(prepared.originalBytes)} → <b>${themeKB(prepared.bytes)}</b>（儲存或發布時才上傳）`:''}</p>`;
  if(has||role==='banner'&&shown){
   html+=`<div class="ts-focus" data-focus="${role}" style="background-image:url('${h(shown)}')"><span class="ts-dot" style="left:${img.x}%;top:${img.y}%"></span></div><p class="ts-hint">拖曳圓點選擇圖片焦點（裁切時優先保留的位置）。</p>`
    +slider(`images.${role}.opacity`,'圖片顯示程度',img.opacity,0,100,'opacity','%',dis&&!can('basic'))+slider(`images.${role}.mask`,'遮罩深淺',img.mask,0,95,'mask','%',!can('basic'));
  }
  if(role==='banner'&&(has||shown)){
   html+=`<div class="ts-sub"><b>橫幅遮罩進階設定</b><label class="ts-check"><input type="checkbox" data-guides ${ui.guides?'checked':''}> 在預覽顯示遮罩控制線（玩家看不到）</label>`
    +slider('images.banner.maskWidth','遮罩寬度',img.maskWidth,0,100,'maskWidth')+slider('images.banner.maskPosition','遮罩位置',img.maskPosition,0,100,'maskPosition')+slider('images.banner.maskFeather','遮罩羽化',img.maskFeather,0,100,'maskFeather')+'</div>';
   if(ui.target==='streamer')html+=`<div class="ts-sub"><b>廳內主播卡片裁切 ${help('hallCard')}</b><div class="ts-focus ts-focus-card" data-focus="hall" style="background-image:url('${h(shown)}')"><span class="ts-dot" style="left:${img.hallX}%;top:${img.hallY}%"></span></div>`
    +slider('images.banner.hallOpacity','卡片圖片顯示程度',img.hallOpacity,0,100,'opacity')+`<button type="button" class="ts-btn ts-ghost" data-page-jump="hallcard">預覽廳內主播卡片</button></div>`;
  }
  return html;
 }
 function decorBlock(){
  const t=current().working,dis=!can('images');
  return `<div class="ts-img-row"><label class="ts-btn ts-file ${dis||t.decor.length>=THEME_DECOR_LIMIT?'disabled':''}">＋ 新增裝飾圖片<input type="file" accept="image/png,image/webp" data-upload="decor" ${dis||t.decor.length>=THEME_DECOR_LIMIT?'disabled':''}></label><span class="ts-hint">最多 ${THEME_DECOR_LIMIT} 張；建議 800 × 800 px 透明 PNG／WebP</span></div>`
   +t.decor.map((d,i)=>{const prepared=d.url.startsWith(LOCAL_HOST)?pending.get(themeAsset(d.url)?.hash):null;return `<div class="ts-decor-item"><img src="${h(resolve(d.url))}" alt=""><div class="ts-grow">${prepared?`<p class="ts-hint">✅ 已壓縮：${prepared.width}×${prepared.height}，${themeKB(prepared.originalBytes)} → <b>${themeKB(prepared.bytes)}</b></p>`:''}${slider(`decor.${i}.size`,'大小',d.size,4,60,'','%',dis)}${slider(`decor.${i}.opacity`,'顯示程度',d.opacity,0,100,'opacity','%',dis)}</div><div class="ts-col"><button type="button" class="ts-btn ts-ghost" data-decor-reset="${i}">重設位置</button><button type="button" class="ts-btn ts-ghost" data-decor-remove="${i}">移除</button></div></div>`;}).join('')
   +(t.decor.length?'<p class="ts-hint">在左側預覽的主播首頁直接拖曳裝飾圖片來移動位置。</p>':'');
 }
 function renderControls(){
  const tg=current(),t=tg.working,box=$('[data-ts-controls]');
  if(!ui.access){box.innerHTML=ui.accessError?`<div class="ts-section">${locked(ui.accessError)}</div>`:'<div class="ts-section"><p>讀取權限中…</p></div>';return;}
  const basic=can('basic'),images=can('images'),publish=can('publish');
  const hallOption=ui.access.hall?.editable;
  const report=themeContrastReport(t),bad=report.filter(r=>!r.ok);
  box.innerHTML=`<section class="ts-section"><h3>1. 設計對象 ${help('target')}</h3><div class="ts-seg ts-wide"><button type="button" data-target="streamer" class="${ui.target==='streamer'?'on':''}">主播首頁・${h(room.display_name)}</button>${hallOption?`<button type="button" data-target="hall" class="${ui.target==='hall'?'on':''}">廳首頁・${h(hallName)}</button>`:''}</div>
   <p class="ts-hint">${tg.reset?'⚠️ 目前為「還原預設」狀態，按「發布主題」後套用。':tg.fromDraft?'目前從未發布的草稿繼續編輯。':tg.published?'目前從已發布版本開始編輯。':'目前使用 PA Party 預設外觀。'}</p>
   ${!basic?locked():''}${basic&&!publish?locked('目前會員方案不包含「草稿與發布」，可以預覽但無法儲存。如需使用，請聯絡平台管理員。'):''}</section>
  <fieldset class="ts-fieldset" ${basic?'':'disabled'}>
  <section class="ts-section"><h3>2. 主色 ${help('base')}</h3><div class="ts-row"><input type="color" value="${t.base}" data-base-color aria-label="主色"><input class="ts-hex" value="${t.base.toUpperCase()}" maxlength="7" data-base-hex aria-label="HEX 色碼"><button type="button" class="ts-btn ts-main" data-ts="smart">✨ 一鍵智慧配色</button>${help('smart')}</div>
   <div class="ts-swatches">${THEME_SWATCHES.map(c=>`<button type="button" data-swatch="${c}" style="background:${c}" aria-label="${c}" class="${c===t.base?'on':''}"></button>`).join('')}</div>
   <p class="ts-label">快速配色範本</p><div class="ts-templates">${THEME_TEMPLATES.map(x=>`<button type="button" data-template="${x.id}"><i style="background:${x.base}"></i>${x.name}<small>${x.mode==='dark'?'深色':'淺色'}</small></button>`).join('')}</div></section>
  <section class="ts-section"><h3>3. 模式與按鈕</h3><div class="ts-row"><span class="ts-label">深淺模式 ${help('mode')}</span><div class="ts-seg"><button type="button" data-mode="dark" class="${t.mode==='dark'?'on':''}">🌙 深色</button><button type="button" data-mode="light" class="${t.mode==='light'?'on':''}">☀️ 淺色</button></div></div>
   <div class="ts-row"><span class="ts-label">按鈕樣式 ${help('button')}</span><div class="ts-seg"><button type="button" data-btnstyle="gradient" class="${t.button==='gradient'?'on':''}">漸層</button><button type="button" data-btnstyle="solid" class="${t.button==='solid'?'on':''}">單色</button></div></div></section>
  <section class="ts-section"><h3>4. 自動配色展示與個別微調 ${help('colors')}</h3><div class="ts-palette">${THEME_COLOR_KEYS.map(k=>`<div class="ts-color"><input type="color" value="${t.colors[k]}" data-color="${k}" aria-label="${h(THEME_COLOR_LABELS[k])}"><span>${h(THEME_COLOR_LABELS[k])}${k==='logo'?help('logo'):k==='panel'?help('panel'):''}<small>${t.colors[k].toUpperCase()}${tg.manual.has(k)?' ・手動':''}</small></span>${tg.manual.has(k)?`<button type="button" class="ts-reset" data-color-auto="${k}" title="回到自動配色" aria-label="${h(THEME_COLOR_LABELS[k])}回到自動配色">↺</button>`:''}</div>`).join('')}</div>
   ${themeLuminance(t.colors.logo)>.35?'<p class="ts-warn">Logo 區底色偏淺，Logo 可能看不清楚，建議改深一點。</p>':''}
   <p class="ts-hint">文字對比：${report.map(r=>`<span class="${r.ok?'ok':'bad'}">${h(r.label)} ${r.ratio}:1</span>`).join('、')}${bad.length?'<br>⚠️ 有項目對比不足，文字可能不易閱讀。':''}</p></section>
  </fieldset>
  <fieldset class="ts-fieldset" ${basic?'':'disabled'}>
  <section class="ts-section"><h3>5. 整頁背景圖片 ${help('background')}</h3>${images?'':locked()}${imageBlock('background')}</section>
  <section class="ts-section"><h3>6. ${ui.target==='hall'?'廳首頁':'首頁'}橫幅 ${help('banner')}</h3>${images?'':locked()}${imageBlock('banner')}</section>
  <section class="ts-section"><h3>7. 統一卡片底圖 ${help('card')}</h3>${images?'':locked()}${imageBlock('card')}</section>
  <section class="ts-section"><h3>8. 裝飾圖片 ${help('decor')}</h3>${images?'':locked()}${decorBlock()}</section>
  </fieldset>
  <section class="ts-section"><h3>9. 儲存與發布</h3><p class="ts-hint">儲存草稿 ${help('draft')}　發布主題 ${help('publish')}　還原預設 ${help('reset')}</p>
   ${ui.target==='streamer'?`<p class="ts-hint">發布後會同時套用到：主播首頁、歌本與歌曲頁、玩家相關頁面、主播後台（待播、歌曲管理）。裝飾圖片只出現在首頁。</p>`:'<p class="ts-hint">發布後只套用到廳首頁；旗下主播卡片依各主播自己的橫幅與卡片裁切顯示。</p>'}
   <details class="ts-cleanup"><summary>清理不再使用的主題圖片</summary><p class="ts-hint">只會刪除「已發布版本」與「草稿」都沒有用到、且上傳超過 24 小時的圖片。先檢查，確認後才刪除。</p><button type="button" class="ts-btn ts-ghost" data-ts="cleanup-check" ${publish?'':'disabled'}>檢查可清理的圖片</button><span data-cleanup-result class="ts-hint"></span></details></section>`;
  syncActions();
 }
 function syncActions(){
  const tg=current(),publish=can('publish')&&can('basic'),busy=ui.busy;
  $('[data-ts=draft]').disabled=busy||!publish||tg.reset||!tg.dirty;
  $('[data-ts=publish]').disabled=busy||!publish||(!tg.dirty&&!tg.reset&&!tg.fromDraft);
  $('[data-ts=discard]').disabled=busy||!tg.dirty&&!tg.reset;
  $('[data-ts=reset]').disabled=busy||!can('basic');
  $('[data-ts-status]').textContent=ui.status||(tg.reset?'還原預設（未發布）':tg.dirty?'● 有未儲存修改':tg.fromDraft?'草稿已儲存・尚未發布':tg.published?'已發布':'預設外觀');
 }

 // ---------- preview ----------
 const pages=()=>ui.target==='hall'?[['hall','廳首頁']]:[['home','主播首頁'],['book','歌本'],['admin','主播後台'],['hallcard','廳內主播卡片']];
 function renderPageTabs(){if(!pages().some(([id])=>id===ui.page))ui.page=pages()[0][0];$('[data-ts-pages]').innerHTML=pages().map(([id,label])=>`<button type="button" data-page="${id}" class="${ui.page===id?'on':''}">${label}</button>`).join('');}
 const styleLinks=()=>[...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href).filter(href=>/\/src\/(style|mobile|theme|theme-v2|lobby|lobby-header)\.css/.test(href));
 function ensureFrame(){
  if(frameReady)return;
  const links=styleLinks(),need=href=>!links.some(l=>l.includes(href))?[new URL('./'+href,import.meta.url).href]:[];
  const all=[...links,...need('theme-v2.css'),...need('lobby.css')];
  frame.srcdoc=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${all.map(href=>`<link rel="stylesheet" href="${h(href)}">`).join('')}<style>body{margin:0;min-height:100vh}main{padding:12px}.ts-guide{position:absolute;top:0;bottom:0;z-index:5;pointer-events:auto;touch-action:none}.ts-guide.edge{width:14px;margin-left:-7px;cursor:ew-resize}.ts-guide.edge:before{content:'';position:absolute;left:6px;top:0;bottom:0;border-left:2px dashed #fff}.ts-guide.center{width:26px;margin-left:-13px;cursor:grab}.ts-guide.center:before{content:'⇆';position:absolute;top:50%;left:0;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;background:#000a;color:#fff;font:14px/26px sans-serif;text-align:center;border:1px solid #fff}.integrated-hero img,.ts-hallcard img{cursor:move;touch-action:none}.lobby-page .lobby-room{min-height:140px}</style></head><body></body></html>`;
  frame.addEventListener('load',()=>{doc=frame.contentDocument;frameReady=true;bindFrame();renderPage();},{once:true});
 }
 function previewTheme(){const tg=current();return tg.reset?null:tg.working;}
 function bannerSrc(){const t=current().working,url=t.images.banner?.url;return url?resolve(url):ui.target==='streamer'?defaultBanner:'';}
 function songList(n=5){const rows=songs.length?songs.slice(0,n):[['示範歌曲一','示範歌手'],['示範歌曲二','示範歌手'],['示範歌曲三','示範歌手']].map(([title,artist])=>({title,artist,tags:['抒情']}));return rows.map((s,i)=>`<div class="song"><span class="song-gutter"><span class="number">${i+1}</span></span><div class="info"><b>${h(s.title)}</b><small>${h(s.artist)}</small><div>${(s.tags||[]).slice(0,2).map(t=>`<span class="tag">${h(t)}</span>`).join('')}</div></div><div class="actions song-actions"><button type="button" class="tiny primary">點歌</button></div></div>`).join('');}
 function header(){if(ui.page==='hall')return `<header><div class="header-inner"><a class="brand"><span class="brand-logo" role="img" aria-label="PA • PARTY"></span></a><nav class="lobby-header-actions"><a>回官網</a><a>玩家登入</a><a>管理登入</a></nav></div></header>`;return `<header><div class="header-inner"><button type="button" class="brand"><span class="brand-logo" role="img" aria-label="PA • PARTY"></span></button><div class="header-tools"><label class="header-streamer"><span>主播</span><select><option>${h(room.display_name)}</option></select></label><div class="header-notice"><button type="button" class="tiny">🔔</button></div></div></div></header>`;}
 function renderPage(){
  if(!frameReady)return;
  const name=h(room.display_name),src=bannerSrc(),t=previewTheme();
  doc.documentElement.className='';doc.body.className=ui.page==='hall'||ui.page==='hallcard'?'lobby-page':'';
  let main='';
  if(ui.page==='home')main=`<div class="grid custom-home theme-home-host" data-home-host><div class="home-module home-module-hero wide"><section class="hero integrated-hero">${src?`<img data-banner-img src="${h(src)}" alt="">`:'<div class="hero-placeholder" aria-hidden="true"></div>'}<div class="hero-overlay"><h2>${name} PARTY</h2><div class="state-label" style="color:#79d5b0">🟢 空閒中</div><p class="status-note">歡迎點歌提歌 ♡</p><div class="hour"><strong>0/2</strong><small>本小時提歌額度</small></div></div><div data-guides-host></div></section></div>
   <div class="home-module wide"><section class="card wide home-search-card"><div class="section-head"><h2>找找${name}會唱的歌👀</h2><button type="button" class="tiny">完整歌本 ↗</button></div><input placeholder="歌名、歌手、語言、標籤都可以…"><p class="subtle">給我一點線索，幫你翻歌本 ♡</p></section></div>
   <div class="home-module wide"><section class="card wide"><div class="section-head"><h2>✨ 新練歌曲</h2><button type="button" class="tiny">查看更多</button></div>${songList(3)}</section></div>
   <div class="home-module"><section class="card"><div class="section-head"><h2>🎲 今天聽什麼？</h2></div><div class="fate">完全交給命運 🎲</div></section></div>
   <div class="home-module"><section class="card"><div class="section-head"><h2>💾 我的存歌</h2></div><div class="stat">登入後，幫你打開存歌袋 ♡</div><button type="button" class="primary">玩家登入</button></section></div><div data-decor-host></div></div>`;
  else if(ui.page==='book')main=`<section class="card wide"><div class="section-head"><h2>📖 ${name}的歌本</h2></div><div class="toolbar"><input placeholder="搜尋歌名、歌手"><button type="button" class="primary">搜尋</button></div><p><span class="tag">抒情</span> <span class="tag">台語</span> <span class="tag">英文</span></p>${songList(6)}</section>`;
  else if(ui.page==='admin')main=`<div class="admin-banner"><b>🔐 ${name}的管理後台</b><div class="actions"><button type="button" class="tiny">回${name}首頁</button><button type="button" class="tiny">登出管理</button></div></div><div class="tabs admin-section-tabs"><button type="button" class="tiny active">待播</button><button type="button" class="tiny">歌曲</button><button type="button" class="tiny">玩家</button><button type="button" class="tiny">設定</button></div><section class="card"><h3>待播管理</h3><p class="muted">目前待播 2 首</p>${songList(2)}<div class="actions"><button type="button" class="primary">完成演唱</button><button type="button">準備中</button></div></section>`;
  else if(ui.page==='hallcard')main=`<p class="ts-pv-tip" style="font-size:12px;opacity:.8">廳首頁的主播卡片（拖曳圖片可調整這裡的裁切，不會影響主播首頁橫幅）</p><div class="lobby-rooms">${[room.display_name,...streamerNames.filter(n=>n!==room.display_name).slice(0,3)].map((n,i)=>`<a class="lobby-room ${i?'':'ts-hallcard'}">${i===0&&src?`<img class="lobby-room-image" data-hall-img src="${h(src)}" alt="">`:''}<span aria-hidden="true">🎤</span><strong>${h(n)}</strong><small>進入主播首頁 →</small></a>`).join('')}</div>`;
  else main=`<div class="theme-home-host" data-home-host>${src?`<section class="theme-hall-banner"><img data-banner-img src="${h(src)}" alt=""><div class="theme-hall-banner-text"><h1>${h(hallName)}大廳</h1><p class="muted">選一位主播，或找一首想聽的歌。</p></div><div data-guides-host></div></section>`:`<section class="lobby-intro"><h1>${h(hallName)}大廳</h1><p class="muted">選一位主播，或找一首想聽的歌。</p></section>`}
   <section class="card"><h2>找主播</h2><div class="toolbar"><input placeholder="輸入主播名稱"><button type="button">搜尋</button></div><div class="lobby-rooms">${(streamerNames.length?streamerNames:['主播 A','主播 B','主播 C']).slice(0,6).map(n=>`<a class="lobby-room"><span aria-hidden="true">🎤</span><strong>${h(n)}</strong><small>進入主播首頁 →</small></a>`).join('')}</div></section>
   <section class="card lobby-songbook"><h2>${h(hallName)}廳內找歌</h2><div class="toolbar"><input placeholder="歌名、歌手都可以"><button type="button">搜尋</button></div>${songList(3)}</section><div data-decor-host></div></div>`;
  doc.body.innerHTML=header()+`<main>${main}</main>`;
  refreshPreview();
 }
 function refreshPreview(){
  if(!frameReady)return;
  const t=previewTheme(),hall=ui.target==='hall';
  // The hall card is shown on the hall page, which keeps the hall's own colours.
  themeApply(doc.documentElement,ui.page==='hallcard'?null:t,{resolve,hall});
  if(!t){for(const k of ['homeTheme'])delete doc.documentElement.dataset[k];}
  const banner=doc.querySelector('[data-banner-img]');
  if(banner){const src=bannerSrc();if(src&&banner.getAttribute('src')!==src)banner.setAttribute('src',src);banner.style.cssText=t?themeBannerImageStyle(t):'';}
  const hallImg=doc.querySelector('[data-hall-img]');if(hallImg)hallImg.style.cssText=t?themeBannerImageStyle(t,{hallCard:true}):'';
  const decorHost=doc.querySelector('[data-decor-host]');
  if(decorHost){
   const items=t?t.decor:[],imgs=decorHost.querySelectorAll('.theme-decor');
   if(imgs.length!==items.length||[...imgs].some((im,i)=>im.dataset.url!==items[i].url)){decorHost.innerHTML=t?themeDecorHtml(t,{resolve,editable:true,escape:h}):'';decorHost.querySelectorAll('.theme-decor').forEach((im,i)=>im.dataset.url=items[i].url);}
   else items.forEach((d,i)=>{imgs[i].style.left=d.x+'%';imgs[i].style.top=d.y+'%';imgs[i].style.width=`clamp(36px,${d.size}%,${Math.round(d.size*9)}px)`;imgs[i].style.opacity=d.opacity/100;});
  }
  const guides=doc.querySelector('[data-guides-host]');
  if(guides){
   const b=themeImageValue(t?.images.banner,'banner'),show=t&&ui.guides&&b.mask>0;
   guides.innerHTML=show?`<span class="ts-guide edge" data-guide="left" style="left:${Math.max(0,b.maskPosition-b.maskWidth/2)}%"></span><span class="ts-guide center" data-guide="center" style="left:${b.maskPosition}%"></span><span class="ts-guide edge" data-guide="right" style="left:${Math.min(100,b.maskPosition+b.maskWidth/2)}%"></span>`:'';
  }
  sizeFrame();
 }
 function schedule(){cancelAnimationFrame(raf);raf=requestAnimationFrame(refreshPreview);}
 function sizeFrame(){
  const wrap=$('[data-ts-wrap]'),w=ui.device==='mobile'?390:1180,avail=Math.max(200,wrap.clientWidth-4),scale=Math.min(1,avail/w);
  // On a phone the preview shares the screen with the controls, so the frame
  // scrolls inside itself instead of growing the page.
  const hgt=innerWidth<=860?Math.round(Math.max(300,innerHeight*.46)/scale):ui.device==='mobile'?760:820;
  frame.style.width=w+'px';frame.style.height=hgt+'px';frame.style.transform=`scale(${scale})`;wrap.style.height=Math.round(hgt*scale)+'px';
 }
 // Pointer interactions inside the preview: banner focus, hall card focus,
 // mask guides and decorations. All only change numbers in memory.
 function bindFrame(){
  let drag=null;
  doc.addEventListener('pointerdown',e=>{
   const t=current().working;if(current().reset||!can('basic'))return;
   const guide=e.target.closest('[data-guide]'),decor=e.target.closest('.theme-decor'),bannerImg=e.target.closest('[data-banner-img]'),hallImg=e.target.closest('.ts-hallcard');
   if(guide){const host=guide.parentElement.parentElement.getBoundingClientRect();drag={kind:'guide',which:guide.dataset.guide,host};}
   else if(decor&&can('images')){const host=doc.querySelector('[data-home-host]').getBoundingClientRect();drag={kind:'decor',index:Number(decor.dataset.decorIndex),host};}
   else if(bannerImg){const r=bannerImg.getBoundingClientRect();drag={kind:'focus',role:'banner',x:e.clientX,y:e.clientY,r,start:{...themeImageValue(t.images.banner,'banner')}};}
   else if(hallImg&&ui.target==='streamer'){const r=hallImg.getBoundingClientRect();drag={kind:'hall',x:e.clientX,y:e.clientY,r,start:{...themeImageValue(t.images.banner,'banner')}};}
   if(drag){e.preventDefault();e.target.setPointerCapture?.(e.pointerId);}
  });
  doc.addEventListener('pointermove',e=>{
   if(!drag)return;const t=current().working;
   if(drag.kind==='guide'){const pct=Math.max(0,Math.min(100,(e.clientX-drag.host.left)/drag.host.width*100)),b=ensureImage('banner');const v=themeImageValue(b,'banner');
    if(drag.which==='center')b.maskPosition=Math.round(pct);else{const half=Math.abs(pct-v.maskPosition);b.maskWidth=Math.round(Math.min(100,half*2));}}
   else if(drag.kind==='decor'){const d=t.decor[drag.index];if(d){d.x=Math.round(Math.max(0,Math.min(100,(e.clientX-drag.host.left)/drag.host.width*100)));d.y=Math.round(Math.max(0,Math.min(100,(e.clientY-drag.host.top)/drag.host.height*100)));}}
   else{const b=ensureImage('banner'),dx=(e.clientX-drag.x)/drag.r.width*100,dy=(e.clientY-drag.y)/drag.r.height*100;
    // Dragging the picture right reveals more of its left side.
    if(drag.kind==='focus'){b.x=Math.round(Math.max(0,Math.min(100,drag.start.x-dx)));b.y=Math.round(Math.max(0,Math.min(100,drag.start.y-dy)));}
    else{b.hallX=Math.round(Math.max(0,Math.min(100,drag.start.hallX-dx)));b.hallY=Math.round(Math.max(0,Math.min(100,drag.start.hallY-dy)));}}
   markDirty(false);schedule();
  });
  const end=()=>{if(drag){drag=null;renderControlsSoon();}};
  doc.addEventListener('pointerup',end);doc.addEventListener('pointercancel',end);
 }
 let controlsTimer=0;function renderControlsSoon(){clearTimeout(controlsTimer);controlsTimer=setTimeout(()=>{const scroll=$('[data-ts-controls]').scrollTop;renderControls();$('[data-ts-controls]').scrollTop=scroll;},60);}
 function ensureImage(role){const t=current().working;t.images[role]=t.images[role]||{};return t.images[role];}

 // ---------- state changes ----------
 function markDirty(render=true){const tg=current();tg.dirty=true;tg.reset=false;if(render)renderControlsSoon();syncActions();}
 function regenerate(all){
  const tg=current(),t=tg.working,auto=themeSmartPalette(t.base,t.mode);
  if(all)tg.manual.clear();
  for(const k of THEME_COLOR_KEYS)if(!tg.manual.has(k))t.colors[k]=auto[k];
  t.manual=[...tg.manual];
 }
 function setPath(path,value){
  const t=current().working,parts=path.split('.'),n=Number(value);
  if(parts[0]==='images'){ensureImage(parts[1])[parts[2]]=n;}
  else if(parts[0]==='decor'){const d=t.decor[Number(parts[1])];if(d)d[parts[2]]=n;}
 }
 root.addEventListener('input',e=>{
  const el=e.target,tg=current(),t=tg.working;
  if(el.matches('[data-path]')){setPath(el.dataset.path,el.value);const out=el.closest('.ts-slider')?.querySelector('output');if(out)out.textContent=el.value+'%';markDirty(false);schedule();return;}
  if(el.matches('[data-base-color]')){t.base=el.value.toLowerCase();regenerate(false);$('[data-base-hex]').value=t.base.toUpperCase();markDirty(false);schedule();renderControlsSoon();return;}
  if(el.matches('[data-base-hex]')){const v=el.value.trim();if(/^#?[0-9a-f]{6}$/i.test(v)){t.base=('#'+v.replace('#','')).toLowerCase();regenerate(false);markDirty(false);schedule();renderControlsSoon();}return;}
  if(el.matches('[data-color]')){t.colors[el.dataset.color]=el.value.toLowerCase();tg.manual.add(el.dataset.color);t.manual=[...tg.manual];markDirty(false);schedule();renderControlsSoon();return;}
 });
 root.addEventListener('change',async e=>{
  const el=e.target;
  if(el.matches('[data-guides]')){ui.guides=el.checked;schedule();return;}
  if(el.matches('[data-upload]')){const file=el.files?.[0];el.value='';if(file)await addImage(el.dataset.upload,file);}
 });
 async function addImage(role,file){
  const tg=current(),t=tg.working;
  try{
   ui.status='壓縮圖片中…';syncActions();
   const prepared=await themeCompressImage(file,role);
   const url=knownUrls.get(prepared.hash)||`${LOCAL_HOST}/storage/v1/object/public/papa-photos/themes/${tg.hall?'h':'s'}/${tg.owner}/${prepared.hash}.webp`;
   if(url.startsWith(LOCAL_HOST))pending.set(prepared.hash,prepared);else URL.revokeObjectURL(prepared.localUrl);
   if(role==='decor'){if(t.decor.length>=THEME_DECOR_LIMIT)throw Error('裝飾圖片最多 '+THEME_DECOR_LIMIT+' 張');t.decor.push({url,x:50,y:20+t.decor.length*8,size:18,opacity:100});}
   else{const old=t.images[role]||{};t.images[role]={...old,url};}
   ui.status=prepared.onTarget?'':'圖片內容較複雜，已在不模糊的前提下盡量壓縮';markDirty();renderPage();
  }catch(error){ui.status='';toast(error.message||'圖片處理失敗');syncActions();}
 }
 root.addEventListener('click',async e=>{
  const el=e.target.closest('button,[data-help]');if(!el)return;
  const tg=current(),t=tg.working;
  if(el.matches('[data-help]')){showHelp(el);return;}
  hideHelp();
  if(el.dataset.ts==='close'){if((targets.streamer?.dirty||targets.hall?.dirty)&&!confirm('有未儲存的修改，確定要關閉並放棄嗎？'))return;close();return;}
  if(el.dataset.ts==='smart'){regenerate(true);markDirty();schedule();return;}
  if(el.dataset.ts==='discard'){targets[ui.target]=makeTarget(tg.published,tg.draft,tg.owner,tg.hall);renderControls();renderPage();return;}
  if(el.dataset.ts==='reset'){tg.reset=true;tg.dirty=true;renderControls();renderPage();return;}
  if(el.dataset.ts==='draft'||el.dataset.ts==='publish'){await persist(el.dataset.ts);return;}
  if(el.dataset.ts==='cleanup-check'){await cleanup(true);return;}
  if(el.dataset.ts==='cleanup-run'){await cleanup(false);return;}
  if(el.dataset.target&&el.dataset.target!==ui.target){await switchTarget(el.dataset.target);return;}
  if(el.dataset.page){ui.page=el.dataset.page;renderPageTabs();renderPage();return;}
  if(el.dataset.pageJump){ui.page=el.dataset.pageJump;renderPageTabs();renderPage();return;}
  if(el.dataset.tsDevice){ui.device=el.dataset.tsDevice;root.querySelectorAll('[data-ts-device]').forEach(b=>b.classList.toggle('on',b===el));sizeFrame();return;}
  if(el.dataset.swatch){t.base=el.dataset.swatch;regenerate(false);markDirty();schedule();return;}
  if(el.dataset.template){const x=THEME_TEMPLATES.find(x=>x.id===el.dataset.template);t.base=x.base;t.mode=x.mode;regenerate(true);markDirty();schedule();return;}
  if(el.dataset.mode){t.mode=el.dataset.mode;regenerate(false);markDirty();schedule();return;}
  if(el.dataset.btnstyle){t.button=el.dataset.btnstyle;markDirty();schedule();return;}
  if(el.dataset.colorAuto){tg.manual.delete(el.dataset.colorAuto);t.manual=[...tg.manual];t.colors[el.dataset.colorAuto]=themeSmartPalette(t.base,t.mode)[el.dataset.colorAuto];markDirty();schedule();return;}
  if(el.dataset.remove){const role=el.dataset.remove;if(role==='banner'){const {url,...rest}=t.images.banner||{};t.images.banner=rest;}else delete t.images[role];markDirty();renderPage();return;}
  if(el.dataset.decorRemove!==undefined){t.decor.splice(Number(el.dataset.decorRemove),1);markDirty();renderPage();return;}
  if(el.dataset.decorReset!==undefined){const d=t.decor[Number(el.dataset.decorReset)];if(d){d.x=50;d.y=20;d.size=18;}markDirty();schedule();return;}
 });
 // Focus frames: drag the dot to choose which part of the picture stays visible.
 root.addEventListener('pointerdown',e=>{
  const box=e.target.closest('[data-focus]');if(!box||current().reset||!can('basic'))return;e.preventDefault();
  const role=box.dataset.focus,move=ev=>{const r=box.getBoundingClientRect(),x=Math.round(Math.max(0,Math.min(100,(ev.clientX-r.left)/r.width*100))),y=Math.round(Math.max(0,Math.min(100,(ev.clientY-r.top)/r.height*100)));
   const img=ensureImage(role==='hall'?'banner':role);if(role==='hall'){img.hallX=x;img.hallY=y;}else{img.x=x;img.y=y;}box.querySelector('.ts-dot').style.cssText=`left:${x}%;top:${y}%`;markDirty(false);schedule();};
  move(e);const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);};addEventListener('pointermove',move);addEventListener('pointerup',up);
 });
 function showHelp(el){const pop=$('[data-ts-help-pop]'),r=el.getBoundingClientRect();pop.textContent=THEME_HELP[el.dataset.help]||'';pop.hidden=false;pop.style.top=Math.min(innerHeight-140,r.bottom+6)+'px';pop.style.left=Math.max(8,Math.min(innerWidth-300,r.left-140))+'px';}
 function hideHelp(){$('[data-ts-help-pop]').hidden=true;}
 async function switchTarget(next){
  if(next==='hall'&&!targets.hall){
   try{ui.status='讀取廳主題…';syncActions();const r=await api({op:'hallThemeEdit',spaceId:ui.access.spaceId,management:true});targets.hall=makeTarget(r.published?.theme||null,r.draft?.theme||null,ui.access.spaceId,true);remember(r.published?.theme);remember(r.draft?.theme);ui.access.hall.features=r.features||ui.access.hall.features;}
   catch(error){ui.status='';toast(error.message||'廳主題讀取失敗');syncActions();return;}
   ui.status='';
  }
  ui.target=next;renderPageTabs();renderControls();renderPage();
 }

 // ---------- save / publish ----------
 async function uploadPending(theme){
  const t=structuredClone(theme),tg=current(),swap=async url=>{
   if(!url?.startsWith(LOCAL_HOST))return url;const a=themeAsset(url);if(knownUrls.has(a.hash))return knownUrls.get(a.hash);
   const prepared=pending.get(a.hash);if(!prepared)throw Error('圖片已失效，請重新選擇');
   const role=Object.entries(t.images).find(([,v])=>v?.url===url)?.[0]||'decor';
   const r=await api({op:'themeUpload',target:tg.hall?'hall':'streamer',spaceId:tg.hall?tg.owner:undefined,streamer:tg.hall?undefined:room.id,role,image:await themeBlobBase64(prepared.blob),mime:'image/webp',management:true});
   knownUrls.set(a.hash,r.url);return r.url;
  };
  for(const role of Object.keys(t.images))if(t.images[role].url)t.images[role].url=await swap(t.images[role].url);
  for(const d of t.decor)d.url=await swap(d.url);
  return t;
 }
 async function persist(mode){
  const tg=current();if(ui.busy)return;
  if(mode==='publish'&&!confirm(tg.reset?'確定要還原為 PA Party 預設外觀並發布嗎？玩家頁面會立即恢復預設。':'確定要發布嗎？玩家頁面會套用這個主題。'))return;
  ui.busy=true;ui.status=mode==='publish'?'發布中…':'儲存草稿中…';syncActions();
  try{
   let theme=null;
   if(!tg.reset){
    const local=themeValidate({...tg.working,manual:[...tg.manual]},{hall:tg.hall});// early format check before any upload
    theme=themeValidate(await uploadPending(local),{hall:tg.hall,owner:tg.owner});
   }
   if(tg.hall){
    const r=await api({op:'hallThemeSave',spaceId:tg.owner,mode,theme,management:true});
    tg.published=r.published?.theme||null;tg.draft=r.draft?.theme||null;
   }else{
    if(mode==='draft')await saveStreamer({themeDraft:theme});else await saveStreamer({theme,themeDraft:null});
    if(mode==='draft')tg.draft=theme;else{tg.published=theme;tg.draft=null;}
   }
   targets[ui.target]=Object.assign(makeTarget(tg.published,tg.draft,tg.owner,tg.hall),{});
   for(const p of pending.values())URL.revokeObjectURL(p.localUrl);pending.clear();
   ui.status='';toast(mode==='publish'?(theme?'主題已發布':'已恢復預設外觀'):'草稿已儲存，玩家仍看到已發布版本');
   renderControls();renderPage();
  }catch(error){ui.status='';toast(error.message||'儲存失敗，請稍後再試');}
  finally{ui.busy=false;syncActions();}
 }
 async function cleanup(dryRun){
  const tg=current(),out=$('[data-cleanup-result]');
  try{
   if(!dryRun&&!confirm('確定刪除這些未使用的圖片嗎？已發布與草稿使用中的圖片不會被刪除。'))return;
   const r=await api({op:'themeCleanup',target:tg.hall?'hall':'streamer',spaceId:tg.hall?tg.owner:undefined,streamer:tg.hall?undefined:room.id,dryRun,management:true});
   if(dryRun)out.innerHTML=r.removable?` 共 ${r.total} 張，使用中 ${r.referenced} 張，可清理 ${r.removable} 張（約 ${themeKB(r.bytes)}）。<button type="button" class="ts-btn ts-ghost" data-ts="cleanup-run">確認清理</button>`:` 共 ${r.total} 張，全部使用中或剛上傳，不需要清理。`;
   else out.textContent=` 已清理 ${r.removed} 張未使用圖片。`;
  }catch(error){out.textContent=' '+(error.message||'暫時無法清理');}
 }
 function close(){for(const p of pending.values())URL.revokeObjectURL(p.localUrl);root.remove();document.documentElement.classList.remove('ts-open');removeEventListener('resize',sizeFrame);removeEventListener('keydown',esc);onClose();}
 const esc=e=>{if(e.key==='Escape'){hideHelp();}};
 addEventListener('resize',sizeFrame);addEventListener('keydown',esc);

 renderPageTabs();renderControls();syncActions();ensureFrame();
 api({op:'themeAccess',streamer:room.id,management:true}).then(access=>{ui.access=access;renderControls();}).catch(error=>{ui.accessError=error.message||'權限讀取失敗';renderControls();});
 return {close};
}
