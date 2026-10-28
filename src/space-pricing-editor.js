// 價目設定: the president's editor for one 廳／獨立主播 Space (pricing spec
// sections 2–7). Pure HTML builders and form readers; platform-management.js
// owns the dialog, the network calls and the save. The draft keeps what was
// typed (as text) so switching billing mode never loses a value; forSave()
// drops the fees a mode does not collect.
import {hallPricingInput,normalizePricing,DEFAULT_NAMES} from './pricing-engine.js?v=10.29-SPACE.1';
import {priceGuide,crownGuide} from './pricing-ui.js?v=10.29-SPACE.1';

const PARTY_LABEL={singer:'主播',host:'主持',hall:'廳主號'};
export const pricingParties=p=>p.mode==='none'?['singer']:p.mode==='single'?['singer',p.singleFee==='hall'?'hall':'host']:['singer','host','hall'];
const hourLabel=hour=>String(hour).padStart(2,'0')+':00';
const newId=prefix=>prefix+'-'+Math.random().toString(36).slice(2,10);
const nameOf=(p,party)=>String(p.names?.[party]||'').trim()||DEFAULT_NAMES[party];

/** Values the form shows, from a stored record (numbers become text). */
export function pricingDraft(stored,rolloverHour){
 const text=v=>v===undefined||v===null?'':String(v);
 return {mode:stored.mode,singleFee:stored.singleFee||'host',names:{...stored.names},unit:stored.unit||'',rolloverHour:Number(rolloverHour)||0,policy:stored.policy||'auto',
  perUnit:{singer:text(stored.perUnit.singer),host:text(stored.perUnit.host),hall:text(stored.perUnit.hall)},
  plans:stored.plans.map(p=>({id:p.id,name:p.name,units:text(p.units),singer:text(p.singer),host:text(p.host),hall:text(p.hall),live:p.live!==false,enabled:p.enabled!==false})),
  tiers:stored.tiers.map(t=>({id:t.id,name:t.name,months:text(t.months),fee:text(t.fee),host:text(t.host),hall:text(t.hall),price:text(t.price),enabled:t.enabled!==false})),
  open:[]};
}

/** The record to save: fees the billing mode does not collect are 0. */
export function forSave(draft){
 const shown=new Set(pricingParties(draft)),fee=(row,party,key=party)=>shown.has(party)?row[key]:0;
 return hallPricingInput({mode:draft.mode,singleFee:draft.mode==='single'?draft.singleFee:'host',names:{...draft.names},unit:draft.unit,policy:draft.policy,
  perUnit:{singer:draft.perUnit.singer,host:fee(draft.perUnit,'host'),hall:fee(draft.perUnit,'hall')},
  plans:draft.plans.map(p=>({id:p.id,name:p.name,units:p.units,singer:p.singer,host:fee(p,'host'),hall:fee(p,'hall'),live:p.live,enabled:p.enabled})),
  tiers:draft.tiers.map(t=>({id:t.id,name:t.name,months:t.months===''?0:t.months,fee:t.fee,host:fee(t,'host'),hall:fee(t,'hall'),price:t.price,enabled:t.enabled}))});
}

/** Reads the open form into the draft; fields a mode hides keep their values. */
export function readPricingForm(form,previous){
 const f=new FormData(form),get=(key,fallback)=>f.has(key)?String(f.get(key)):fallback;
 const row=(prefix,old,keys)=>Object.fromEntries(keys.map(key=>[key,get(prefix+key,old[key])]));
 return {mode:get('mode',previous.mode),singleFee:get('singleFee',previous.singleFee),
  names:row('names.',previous.names,['singer','host','hall']),unit:get('unit',previous.unit),
  rolloverHour:Number(get('rolloverHour',previous.rolloverHour)),policy:get('policy',previous.policy),
  perUnit:row('perUnit.',previous.perUnit,['singer','host','hall']),
  plans:previous.plans.map((p,i)=>({...row('plan.'+i+'.',p,['name','units','singer','host','hall']),id:p.id,enabled:p.enabled,live:form.querySelector(`[name="plan.${i}.live"]`)?f.has('plan.'+i+'.live'):p.live})),
  tiers:previous.tiers.map((t,i)=>({...row('tier.'+i+'.',t,['name','months','fee','host','hall','price']),id:t.id,enabled:t.enabled})),
  // Which plan/card panels are unfolded, so a re-render keeps them open.
  open:[...form.querySelectorAll('details.pp-item[open]')].map(item=>item.dataset.item)};
}

/** Add, remove or reorder a save-song plan or crown card. */
export function changePricingDraft(draft,change,index){
 const next={...draft,plans:[...draft.plans],tiers:[...draft.tiers],open:[...(draft.open||[])]},i=Number(index);
 const move=(list,from,to)=>{if(to<0||to>=list.length)return;const [item]=list.splice(from,1);list.splice(to,0,item);};
 if(change==='add-plan'){const id=newId('plan');next.plans.push({id,name:'',units:'2',singer:'',host:'',hall:'',live:true,enabled:true});next.open.push(id);}
 if(change==='add-tier'){const id=newId('tier');next.tiers.push({id,name:'',months:'1',fee:'',host:'',hall:'',price:'',enabled:true});next.open.push(id);}
 if(change==='remove-plan')next.plans.splice(i,1);
 if(change==='remove-tier')next.tiers.splice(i,1);
 if(change==='plan-up')move(next.plans,i,i-1);
 if(change==='plan-down')move(next.plans,i,i+1);
 if(change==='tier-up')move(next.tiers,i,i-1);
 if(change==='tier-down')move(next.tiers,i,i+1);
 return next;
}

/** Billing mode, the three names, gift unit and daily rollover (also used when a Space is created). */
export function pricingBasicsHtml(d,{h,legend='基本設定'}={}){
 const radio=(name,value,title,note)=>`<label class="pp-option"><input type="radio" name="${name}" value="${value}" ${d[name]===value?'checked':''}><span><b>${title}</b>${note?`<small>${note}</small>`:''}</span></label>`;
 const parties=pricingParties(d);
 const nameInput=party=>`<label>${PARTY_LABEL[party]}稱呼<input name="names.${party}" value="${h(d.names[party]??'')}" maxlength="10" required placeholder="${PARTY_LABEL[party]}"></label>`;
 return `<fieldset class="pp-section"><legend>${legend}</legend>
  <p class="pp-label">計費方式</p><div class="pp-choice">${radio('mode','double','雙費','主持、廳主號都收')}${radio('mode','single','單費','只收其中一方')}${radio('mode','none','無雙費','只收主播')}</div>
  ${d.mode==='single'?`<p class="pp-label">單費收給</p><div class="pp-choice pp-choice-two">${radio('singleFee','host',h(nameOf(d,'host')),'')}${radio('singleFee','hall',h(nameOf(d,'hall')),'')}</div>`:''}
  <div class="pp-grid">${['singer','host','hall'].filter(party=>party==='singer'||parties.includes(party)||d.mode==='single').map(nameInput).join('')}</div>
  <div class="pp-grid pp-grid-two"><label>禮物單位<input name="unit" value="${h(d.unit??'')}" maxlength="10" placeholder="例如：探鑽"></label>
   <label>每日換場<select name="rolloverHour">${Array.from({length:24},(_,hour)=>`<option value="${hour}" ${Number(d.rolloverHour)===hour?'selected':''}>${hourLabel(hour)}</option>`).join('')}</select></label></div>
  <p class="pp-hint">稱呼會顯示在歌本、點歌視窗與價目表。換場時間決定一天從幾點開始算，帳務與本晚回顧都依它分日。</p>
 </fieldset>`;
}

// Folded panel summary: the fees in the hall's words (雙費 when host and hall match).
const shown=v=>{const t=String(v??'').trim();const n=Number(t);return t!==''&&Number.isSafeInteger(n)?n.toLocaleString('en-US'):t||'—';};
function feeSummary(d,singer,host,hall){
 const name=party=>nameOf(d,party),parts=[name('singer')+' '+shown(singer)];
 if(d.mode==='single')parts.push('單費 '+shown(d.singleFee==='hall'?hall:host));
 if(d.mode==='double')parts.push(String(host??'').trim()===String(hall??'').trim()?'雙費 '+shown(host):name('host')+' '+shown(host)+'＋'+name('hall')+' '+shown(hall));
 return parts.join('＋');
}
const money=(name,label,value)=>`<label>${label}<input name="${name}" value="${value??''}" inputmode="numeric" pattern="[0-9]*" autocomplete="off"></label>`;

/** The whole editor form. `button(action,label,id,extra)` is the dialog's action button. */
export function pricingEditorHtml(e,{h,button,saving=false}){
 const d=e.draft,parties=pricingParties(d),give=party=>'給'+h(nameOf(d,party));
 const status=e.info.stored?`目前生效的是第 ${e.info.revision} 版。儲存後，這個${e.info.kind==='independent'?'主播':'廳'}的主播與玩家畫面會一起更新。`
  :e.info.spaceId==='space-001'?'聲瑪還沒有廳級價目。下面已帶入聲瑪主播目前使用的數字，按「儲存價目」後價格不會改變，之後就在這裡統一修改。'
  :'這個空間還沒有價目，請從空白開始填寫。';
 const tools=(kind,i,count)=>`<span class="pp-tools">${button('pricing-'+kind+'-up','↑',String(i),'class="pp-tool" aria-label="上移" title="上移"'+(i===0?' disabled':''))}${button('pricing-'+kind+'-down','↓',String(i),'class="pp-tool" aria-label="下移" title="下移"'+(i===count-1?' disabled':''))}${button('pricing-remove-'+kind,'刪除',String(i),'class="pp-tool pp-remove"')}</span>`;
 const panel=(kind,item,i,title,meta,fees,body)=>`<li><details class="pp-item" data-item="${h(item.id)}" ${(d.open||[]).includes(item.id)?'open':''}><summary class="pp-summary"><span class="pp-badge" aria-hidden="true">${i+1}</span><span class="pp-summary-main"><b>${h(title)||'（尚未命名）'}</b><small>${h(meta)}</small></span><span class="pp-summary-fees">${h(fees)}</span><span class="pp-chevron" aria-hidden="true"></span></summary><div class="pp-item-body">${body}</div></details></li>`;
 const plans=d.plans.map((p,i)=>panel('plan',p,i,p.name,shown(p.units)+' 首',feeSummary(d,p.singer,p.host,p.hall),`<div class="pp-item-head"><label class="pp-grow">方案名稱<input name="plan.${i}.name" value="${h(p.name)}" maxlength="20" required></label><label class="pp-short">首數<input name="plan.${i}.units" value="${h(p.units)}" inputmode="numeric" pattern="[0-9]*"></label></div>
   <div class="pp-grid pp-money">${parties.map(party=>money('plan.'+i+'.'+party,give(party),h(p[party]))).join('')}</div>
   <div class="pp-item-foot"><label class="pm-check pp-check"><input type="checkbox" name="plan.${i}.live" ${p.live?'checked':''}>現點時可套用</label>${tools('plan',i,d.plans.length)}</div>`)).join('');
 const tiers=d.tiers.map((t,i)=>panel('tier',t,i,t.name,(Number(t.months)>0?shown(t.months)+' 個月':'永久'),'辦卡 '+feeSummary(d,t.fee,t.host,t.hall)+'｜冠後每首 '+shown(t.price),`<div class="pp-item-head"><label class="pp-grow">卡名<input name="tier.${i}.name" value="${h(t.name)}" maxlength="20" required></label><label class="pp-short">期限（月）<input name="tier.${i}.months" value="${h(t.months)}" inputmode="numeric" pattern="[0-9]*"></label></div>
   <p class="pp-sub">辦卡</p><div class="pp-grid pp-money">${parties.map(party=>money('tier.'+i+'.'+(party==='singer'?'fee':party),give(party),h(party==='singer'?t.fee:t[party]))).join('')}</div>
   <p class="pp-sub">冠歌後，其他玩家每首</p><div class="pp-grid pp-money">${money('tier.'+i+'.price',give('singer'),h(t.price))}</div>
   <div class="pp-item-foot"><small class="pp-hint">期限 0＝永久</small>${tools('tier',i,d.tiers.length)}</div>`)).join('');
 let preview='';
 if(e.preview){try{const p=normalizePricing(forSave(d));preview=`<div class="pp-preview-body"><h3>點歌教學・價目表</h3>${priceGuide(p)}<h3>👑 如何冠歌？</h3>${crownGuide(p)}</div>`;}
  catch(error){preview=`<p class="pp-preview-error" role="alert">${h(error.message)}</p>`;}}
 return `<div class="pm-editor pp-editor"><form data-pm-form="pricing" novalidate>
  <p class="pm-context">${status}</p>
  ${pricingBasicsHtml(d,{h})}
  <fieldset class="pp-section"><legend>一般現點（每 1 首）</legend><div class="pp-grid pp-money">${parties.map(party=>money('perUnit.'+party,give(party),h(d.perUnit[party]))).join('')}</div>
   <p class="pp-hint">歌曲占幾首，每一方都乘上首數。</p></fieldset>
  <fieldset class="pp-section"><legend>存歌方案</legend>
   <div class="pp-choice pp-choice-two"><label class="pp-option"><input type="radio" name="policy" value="auto" ${d.policy!=='fixed'?'checked':''}><span><b>自動套用最划算的方案</b><small>一首歌占多首時，自動挑最便宜的組合</small></span></label><label class="pp-option"><input type="radio" name="policy" value="fixed" ${d.policy==='fixed'?'checked':''}><span><b>固定一般原價</b><small>現點不套用存歌方案</small></span></label></div>
   ${plans?`<ol class="pp-items">${plans}</ol><p class="pp-hint">點方案可展開修改。</p>`:'<p class="pp-empty">還沒有存歌方案。</p>'}
   ${d.plans.length<20?button('pricing-add-plan','＋ 新增存歌方案','','class="pp-add"'):''}</fieldset>
  <fieldset class="pp-section"><legend>冠歌卡</legend><p class="pp-hint">第 1 張等級最高；點卡片可展開修改。辦卡費和冠歌後每首的價格分開設定。</p>
   ${tiers?`<ol class="pp-items">${tiers}</ol>`:'<p class="pp-empty">還沒有冠歌卡。</p>'}
   ${d.tiers.length<10?button('pricing-add-tier','＋ 新增冠歌卡','','class="pp-add"'):''}</fieldset>
  <div class="pp-preview">${button('pricing-preview',e.preview?'收起預覽':'預覽玩家看到的價目表','','class="pp-add"')}${preview}</div>
  <div class="pm-actions"><button type="button" data-pm-action="close-editor" data-pm-id="" ${saving?'disabled':''}>取消</button><button type="submit" ${saving?'disabled':''}>${saving?'儲存中…':'儲存價目'}</button></div>
 </form></div>`;
}
