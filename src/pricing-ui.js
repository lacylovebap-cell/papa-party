// Player-facing gift value displays built on the shared pricing engine. Pure
// HTML builders (no DOM, no network) so the dialogs, the price guide and the
// crown guide all say the same short thing, in the Space's own words, and the
// page's theme colours style them through pricing-ui.css.
import {formatGift,quoteSummary,PRICING_NOTE} from './pricing-engine.js?v=10.29-SPACE.1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The extra fees are shown as one "雙費" figure when host and hall always take
// the same amount (聲瑪), as "單費" for a single-fee hall, and by their own names
// when a hall charges them differently.
export function feeColumns(pricing,extraRows=[]){
 const n=pricing.names,singer={key:'singer',label:n.singer,value:row=>row.singer};
 if(pricing.mode==='none')return {columns:[singer],explain:''};
 if(pricing.mode==='single'){const party=pricing.singleFee;return {columns:[singer,{key:party,label:'單費',value:row=>row[party]}],explain:'單費：給'+n[party]};}
 const rows=[pricing.perUnit,...pricing.plans,...extraRows];
 if(rows.every(row=>row.host===row.hall))return {columns:[singer,{key:'double',label:'雙費',value:row=>row.host}],explain:'雙費：'+n.host+'、'+n.hall+'各一份'};
 return {columns:[singer,{key:'host',label:n.host,value:row=>row.host},{key:'hall',label:n.hall,value:row=>row.hall}],explain:''};
}

function figures(pricing,row){
 return feeColumns(pricing,[row]).columns.map(col=>`<span class="pf-figure"><span class="pf-label">${esc(col.label)}</span><b>${esc(formatGift(col.value(row)))}</b></span>`).join('');
}

/** A gift slip: the singer's value and the extra fee(s), side by side. */
export function giftTicket(pricing,row,{caption=''}={}){
 const {explain}=feeColumns(pricing,[row]),each=pricing.mode==='double'&&explain?explain.replace('各一份','各 '+formatGift(row.host)):explain;
 return `<div class="pf-ticket">${caption?`<p class="pf-caption">${esc(caption)}</p>`:''}<div class="pf-figures">${figures(pricing,row)}</div>${each?`<p class="pf-explain">${esc(each)}</p>`:''}</div>`;
}

/** Collapsed by default: players open it only when they want the numbers. */
export function giftReveal(pricing,quote,{units=quote.units,showUnits=false,open=false}={}){
 const summary=quote.pieces?.length||quote.source==='crown'?quoteSummary(pricing,quote):'';
 const hints=[showUnits&&units!==1?'占 '+units+' 首':'',quote.source==='crown'?'冠歌價格':summary?'已套用優惠':''].filter(Boolean);
 return `<details class="pf-reveal"${open?' open':''}><summary><span class="pf-reveal-title">🎁 查看禮物值</span>${hints.length?`<span class="pf-hint">${hints.map(esc).join('，')}</span>`:''}<span class="pf-toggle" aria-hidden="true"></span></summary>`
  +giftTicket(pricing,quote,{caption:summary})
  +`<p class="pf-note">${pricing.unit?'單位：'+esc(pricing.unit)+'。':''}${esc(PRICING_NOTE)}</p></details>`;
}

// The price list drops the word 一般 from plan names (user request 2026-10-29).
const planLabel=name=>String(name).replace(/一般\s*/g,'').trim()||String(name);

/** 點歌教學・價目表 */
export function priceGuide(pricing,{policyNote=true}={}){
 const plans=pricing.plans.map(plan=>`<li class="pf-plan"><span class="pf-coin" aria-label="${plan.units} 首">${plan.units}<small>首</small></span><span class="pf-plan-name">${esc(planLabel(plan.name))}</span><span class="pf-figures">${figures(pricing,plan)}</span></li>`).join('');
 const rules=['歌曲占幾首，每一方都乘上首數。',
  ...(pricing.plans.length&&policyNote&&pricing.policy!=='fixed'?['一首歌占多首時，自動挑最划算的方案組合。']:[]),
  '半首歌要「唱兩次」或「搭配另一首半首歌」，合成 1 首計價。',
  (pricing.unit?'單位：'+pricing.unit+'。':'')+PRICING_NOTE];
 return `<div class="pf-guide">${giftTicket(pricing,pricing.perUnit,{caption:'一般現點，每 1 首'})}`
  +(plans?`<h3 class="pf-heading">存歌方案</h3><ul class="pf-plans">${plans}</ul>`:'')
  +`<ul class="pf-rules">${rules.map(rule=>`<li>${esc(rule)}</li>`).join('')}</ul></div>`;
}

/** 如何冠歌：cards cheapest first, as players compare them. */
export function crownGuide(pricing){
 const tiers=[...(pricing.tiers||[])].reverse();
 const opening=tier=>({singer:tier.fee,host:tier.host,hall:tier.hall});
 const after=tier=>({singer:tier.price,host:pricing.perUnit.host,hall:pricing.perUnit.hall});
 const {columns,explain}=feeColumns(pricing,tiers.flatMap(tier=>[opening(tier),after(tier)]));
 const line=row=>columns.map(col=>`<span class="pf-figure"><span class="pf-label">${esc(col.label)}</span><b>${esc(formatGift(col.value(row)))}</b></span>`).join('');
 const rows=tiers.map(tier=>`<li class="pf-tier"><div class="pf-tier-name"><b>👑 ${esc(tier.name)}</b><small>${tier.months?esc(tier.months)+' 個月':'永久'}</small></div>`
  +`<div class="pf-tier-cell"><span class="pf-tier-label">辦卡</span><span class="pf-figures">${line(opening(tier))}</span></div>`
  +`<div class="pf-tier-cell"><span class="pf-tier-label">冠後每首</span><span class="pf-figures">${line(after(tier))}</span></div></li>`).join('');
 if(!rows)return '<div class="pf-guide"><p class="pf-empty">這個廳目前沒有開放冠歌卡。</p></div>';
 return `<div class="pf-guide"><ul class="pf-tiers">${rows}</ul>`
  +`<ul class="pf-rules"><li>選歌曲、選卡別、送出辦卡禮物，確認後生效。</li>`
  +`<li>冠歌期間，其他玩家點這首只能現點、現場唱，不能使用提歌、不能使用存歌。</li>`
  +`<li>冠歌主人照一般規則。</li>`
  +`<li>${explain?esc(explain)+'。':''}${pricing.unit?'單位：'+esc(pricing.unit)+'。':''}${esc(PRICING_NOTE)}</li></ul></div>`;
}
