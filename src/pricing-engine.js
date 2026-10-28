// PA Party shared pricing engine (pricing spec 2026/10/27, sections 2–8 and 19).
// One pure decision used by the player confirm dialog, the price guide and the
// server when a request is submitted, so all three show the same numbers.
// It only describes the gift values a request should carry; it never records a
// payment. Amounts are gift values in the Space's own unit (聲瑪: 探鑽).

const PARTIES=['singer','host','hall'];
const MODES=['double','single','none'];
const POLICIES=['fixed','auto','streamer'];
export const SHENGMA_NAMES=Object.freeze({singer:'歌手',host:'2號位主持',hall:'聲瑪樂團'});
export const DEFAULT_NAMES=Object.freeze({singer:'主播',host:'主持',hall:'廳主號'});
export const PRICING_NOTE='以上數值僅供參考，最終以實際狀況為主。';

const money=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;};
const text=(value,fallback,max=20)=>typeof value==='string'&&value.trim()&&value.trim().length<=max?value.trim():fallback;
const triple=(row={})=>({singer:money(row.singer),host:money(row.host),hall:money(row.hall)});

// The legacy (current production) settings carry one live price, one "雙費"
// value that is each of host and hall, and save-song plans whose `double` is
// likewise each of host and hall. A Space that has its own `pricing` object
// uses that instead.
export function pricingFromSettings(settings={},{shengma=true}={}){
 const own=settings&&typeof settings.pricing==='object'&&settings.pricing?settings.pricing:null;
 const extra=Number(settings.liveDouble??(shengma?500:0));
 const legacy={
  mode:'double',
  names:shengma?SHENGMA_NAMES:DEFAULT_NAMES,
  unit:shengma?'探鑽':'',
  perUnit:{singer:Number(settings.livePrice)||0,host:extra,hall:extra},
  plans:(Array.isArray(settings.plans)?settings.plans:[]).map((plan,index)=>({id:'plan-'+index,name:String(plan.name||''),units:Number(plan.amount),
   singer:Number(plan.fee)||0,host:Number(plan.double)||0,hall:Number(plan.double)||0,live:true,enabled:true})),
  policy:'auto',
 };
 return normalizePricing(own?{...legacy,...own,names:{...legacy.names,...(own.names||{})},perUnit:{...legacy.perUnit,...(own.perUnit||{})}}:legacy);
}

export function normalizePricing(value={}){
 const mode=MODES.includes(value.mode)?value.mode:'double';
 const names={};for(const party of PARTIES)names[party]=text(value.names?.[party],DEFAULT_NAMES[party]);
 const singleFee=value.singleFee==='hall'?'hall':'host';
 const limit=row=>{const r=triple(row);if(mode==='none'){r.host=0;r.hall=0;}if(mode==='single'){if(singleFee==='host')r.hall=0;else r.host=0;}return r;};
 const plans=(Array.isArray(value.plans)?value.plans:[]).filter(plan=>plan&&plan.enabled!==false&&Number.isSafeInteger(Number(plan.units))&&Number(plan.units)>=1)
  .map(plan=>({id:String(plan.id||plan.name),name:String(plan.name||''),units:Number(plan.units),...limit(plan),live:plan.live!==false}));
 return Object.freeze({mode,singleFee,names:Object.freeze(names),unit:typeof value.unit==='string'?value.unit.trim().slice(0,10):'',
  perUnit:Object.freeze(limit(value.perUnit)),plans:Object.freeze(plans),policy:POLICIES.includes(value.policy)?value.policy:'auto',
  streamerUsesPlans:value.streamerUsesPlans===true});
}

// Returns problems with a pricing form, so management screens can refuse an
// impossible fee combination before it is saved (spec 2.3).
export function pricingProblems(value={}){
 const problems=[];const mode=value.mode;
 if(!MODES.includes(mode))problems.push('請選擇計費模式');
 const rows=[['一般每首',value.perUnit],...(Array.isArray(value.plans)?value.plans:[]).map(plan=>[plan?.name||'方案',plan])];
 for(const [label,row] of rows){
  for(const party of PARTIES){const n=Number(row?.[party]??0);if(!Number.isFinite(n)||n<0)problems.push(label+'的金額需為 0 以上的數字');}
  const host=Number(row?.host)||0,hall=Number(row?.hall)||0;
  if(mode==='none'&&(host||hall))problems.push(label+'：無雙費模式不收主持或廳主號費');
  if(mode==='single'&&host&&hall)problems.push(label+'：單費模式只能收主持或廳主號其中一項');
 }
 return [...new Set(problems)];
}

const halves=units=>{const h=Number(units)*2;if(!Number.isSafeInteger(h)||h<1||h>2000)throw Error('首數請用 0.5 的倍數');return h;};
const sum=row=>row.singer+row.host+row.hall;

// The cheapest legal way to price one song that occupies `units` slots, using
// whole save-song plans and single slots at the per-slot price (spec 5.3).
function bestCombination(perUnit,plans,units){
 const total=halves(units),best=new Array(total+1).fill(null);best[0]={cost:0,pieces:[],row:{singer:0,host:0,hall:0}};
 const options=[{kind:'base',name:'一般',halves:1,row:{singer:perUnit.singer/2,host:perUnit.host/2,hall:perUnit.hall/2}},
  ...plans.map(plan=>({kind:'plan',id:plan.id,name:plan.name,halves:plan.units*2,row:{singer:plan.singer,host:plan.host,hall:plan.hall}}))];
 for(let h=1;h<=total;h++)for(const option of options){
  if(option.halves>h||!best[h-option.halves])continue;
  const prev=best[h-option.halves],row={singer:prev.row.singer+option.row.singer,host:prev.row.host+option.row.host,hall:prev.row.hall+option.row.hall};
  const cost=sum(row),pieces=[...prev.pieces,option],current=best[h];
  // Lowest total; then fewer separate pieces; then plans before single slots.
  const better=!current||cost<current.cost-1e-9||Math.abs(cost-current.cost)<1e-9&&(pieces.length<current.pieces.length||pieces.length===current.pieces.length&&pieces.filter(p=>p.kind==='plan').length>current.pieces.filter(p=>p.kind==='plan').length);
  if(better)best[h]={cost,pieces,row};
 }
 return best[total];
}

function groupPieces(pieces){
 // Plans are listed one by one (grouped when repeated); any remaining single
 // slots at the per-slot price are one "一般 N 首" entry. Pure per-slot pricing
 // has no pieces to show.
 const groups=new Map();let baseHalves=0;
 for(const piece of pieces){
  if(piece.kind==='base'){baseHalves+=piece.halves;continue;}
  const g=groups.get(piece.id)||{kind:'plan',id:piece.id,name:piece.name,units:piece.halves/2,count:0};g.count++;groups.set(piece.id,g);
 }
 if(!groups.size)return [];
 const list=[...groups.values()].sort((a,b)=>b.units-a.units);
 if(baseHalves)list.push({kind:'base',id:null,name:'一般',units:baseHalves/2,count:1});
 return list;
}

const round=n=>Math.round(n*100)/100;

/**
 * Gift values for one live request.
 * crown: an active crown on this song ({playerId, price}); another player pays
 *  the crown price per slot for the singer, host and hall stay at the normal
 *  per-slot values, and no plan or card discount applies (spec 7.4, 13).
 * card: a valid card benefit {name, perUnit:{singer?,host?,hall?}}; a missing
 *  party inherits, an explicit 0 means no fee for that party (spec 8.2).
 * usePlans: whether this room applies save-song plans to live requests (spec 5.5).
 */
export function quoteLive(pricingValue,{units=1,crown=null,playerId=null,card=null,usePlans}={}){
 const pricing=pricingValue?.perUnit&&Object.isFrozen(pricingValue)?pricingValue:normalizePricing(pricingValue);
 halves(units);
 const base={...pricing.perUnit};
 if(crown&&crown.playerId!==playerId){
  const row={singer:round(money(crown.price)*units),host:round(base.host*units),hall:round(base.hall*units)};
  return {units,...row,total:sum(row),source:'crown',pieces:[],card:null};
 }
 let source='base',cardName=null;
 if(card&&card.perUnit){
  for(const party of PARTIES)if(card.perUnit[party]!==undefined&&card.perUnit[party]!==null&&card.perUnit[party]!=='')base[party]=money(card.perUnit[party]);
  const limited=normalizePricing({...pricing,perUnit:base});Object.assign(base,limited.perUnit);source='card';cardName=String(card.name||'');
 }
 const plansAllowed=usePlans??(pricing.policy==='auto'||pricing.policy==='streamer'&&pricing.streamerUsesPlans);
 const plans=plansAllowed?pricing.plans.filter(plan=>plan.live):[];
 const best=bestCombination(base,plans,units);
 const row={singer:round(best.row.singer),host:round(best.row.host),hall:round(best.row.hall)};
 const pieces=groupPieces(best.pieces),usesPlan=pieces.some(p=>p.kind==='plan');
 return {units,...row,total:round(sum(row)),source:usesPlan?(source==='card'?'card+plan':'plan'):source,pieces,card:cardName};
}

/** The parties a Space actually collects for, for compact displays. */
export function shownParties(pricing){
 const p=pricing?.perUnit?pricing:normalizePricing(pricing);
 return PARTIES.filter(party=>party==='singer'||p.mode==='double'||p.mode==='single'&&p.singleFee===party);
}

export function formatGift(value,unit=''){
 const n=Number(value)||0;const shown=Number.isInteger(n)?n.toLocaleString('en-US'):n.toLocaleString('en-US',{maximumFractionDigits:2});
 return unit?shown+' '+unit:shown;
}

/** Plain lines for the player dialog: "給歌手 5,555 探鑽" etc. */
export function quoteLines(pricing,quote){
 return shownParties(pricing).map(party=>({party,label:'給'+pricing.names[party],amount:quote[party],text:'給'+pricing.names[party]+' '+formatGift(quote[party],pricing.unit)}));
}

export function quoteSummary(pricing,quote){
 if(quote.source==='crown')return '冠歌價格';
 const plans=quote.pieces.filter(p=>p.kind==='plan');
 const parts=quote.pieces.map(p=>(p.kind==='plan'?p.name:'一般 '+p.units+' 首')+(p.count>1?' × '+p.count:''));
 const prefix=quote.card?quote.card+'｜':'';
 return plans.length?prefix+'自動套用最優惠方案：'+parts.join(' ＋ '):prefix+(quote.units===1?'一般價格':'一般價格（每首 × '+quote.units+'）');
}
