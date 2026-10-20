export function createPlatformDirectory({api,identity,escape,changed}) {
 let owner=null,generation=0, model={rows:[],total:0,page:1,pages:1,q:'',status:'all',loading:false,error:'',loaded:false};
 const clear=()=>{owner=null;generation++;model={rows:[],total:0,page:1,pages:1,q:'',status:'all',loading:false,error:'',loaded:false};};
 async function load({q=model.q,status=model.status,page=model.page}={}) {
  const actor=identity(),ticket=++generation;owner=actor;
  model={...model,rows:[],q,status,page,loading:true,error:'',loaded:false};changed();
  try {
   if(!actor)throw Error('僅限平台總裁');
   const result=await api({op:'platformDirectory',management:true,q,status,page});
   if(ticket!==generation||identity()!==actor)return;
   if(!Array.isArray(result.rows)||result.rows.length>20||!Number.isInteger(result.total)||result.total<0||!Number.isInteger(result.pages)||result.pages<1||!Number.isInteger(result.page)||result.page<1||result.page>result.pages)throw Error('管理清單尚未確認');
   model={...model,...result,loading:false,loaded:true};
  } catch(e) {if(ticket!==generation||identity()!==actor)return;model={...model,rows:[],loading:false,error:e.message};}
  changed();
 }
 function html(){const h=escape;return `<section class="card"><h1>PA Party｜平台總管理</h1><p>空間清單 · 租戶類型、負責人與訂閱資料尚未設定。</p><form id="platform-search" class="toolbar"><input name="q" maxlength="100" aria-label="搜尋名稱或 ID" placeholder="搜尋名稱或 ID" value="${h(model.q)}"><select name="status" aria-label="空間狀態">${[['all','全部'],['active','正常使用'],['suspended','已停用']].map(([v,n])=>`<option value="${v}" ${v===model.status?'selected':''}>${n}</option>`).join('')}</select><button type="submit">搜尋</button></form>${model.loading?'<p role="status">讀取中…</p>':model.error?`<p role="alert">${h(model.error)}</p>`:`<p>符合條件共 ${model.total} 個空間</p>${model.rows.map(r=>`<article class="card"><h2>${h(r.display_name)}</h2><p style="overflow-wrap:anywhere">ID：${h(r.id)}</p><p>${r.status==='active'?'正常使用':'已停用'} · 主播 ${h(r.streamer_count)} 位 · 有效管理帳號 ${h(r.manager_count)} 位</p><small>建立日期：${h(r.created_at)}</small></article>`).join('')||'<p>沒有符合條件的空間。</p>'}`}<form id="platform-page" class="toolbar"><button name="previous" type="button" ${model.page<=1||model.loading?'disabled':''}>上一頁</button><label>第 <input name="page" type="number" min="1" max="${model.pages}" value="${model.page}" style="width:5em"> 頁／共 ${model.pages} 頁</label><button type="submit" ${model.loading?'disabled':''}>跳頁</button><button name="next" type="button" ${model.page>=model.pages||model.loading?'disabled':''}>下一頁</button></form></section>`;}
 function bind(root){const search=root.querySelector('#platform-search'),pager=root.querySelector('#platform-page');search.onsubmit=e=>{e.preventDefault();load({q:search.elements.q.value,status:search.elements.status.value,page:1});};pager.onsubmit=e=>{e.preventDefault();const page=Number(pager.elements.page.value);if(Number.isInteger(page)&&page>0)load({page:Math.min(page,model.pages)});};pager.elements.previous.onclick=()=>load({page:model.page-1});pager.elements.next.onclick=()=>load({page:model.page+1});}
 return {load,clear,html,bind,sync:()=>{if(owner&&identity()!==owner)clear();},state:()=>model};
}
