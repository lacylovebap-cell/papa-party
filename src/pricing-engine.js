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

// Legacy crown cards are listed cheapest first; a hall stores them by level,
// level 1 (the highest card) first (spec 7.2).
const byLevel=tiers=>[...tiers].sort((a,b)=>money(b.fee)-money(a.fee));

// The legacy (current production) settings carry one live price, one "雙費"
// value that is each of host and hall, save-song plans whose `double` is
// likewise each of host and hall, and crown cards that share one opening
// "雙費" (crownDouble). A Space with its own hall pricing (papa_space_policies
// 'pricing', passed as `hall`) uses that instead; so does a room `pricing` object.
export function pricingFromSettings(settings={},{shengma=true,hall=null}={}){
 if(hall&&typeof hall==='object'&&!Array.isArray(hall))return normalizePricing(hall);
 const own=settings&&typeof settings.pricing==='object'&&settings.pricing?settings.pricing:null;
 const legacy=legacyPricing(settings,{shengma});
 return normalizePricing(own?{...legacy,...own,names:{...legacy.names,...(own.names||{})},perUnit:{...legacy.perUnit,...(own.perUnit||{})}}:legacy);
}
function legacyPricing(settings={},{shengma=true}={}){
 const extra=Number(settings.liveDouble??(shengma?500:0)),opening=Number(settings.crownDouble)||0;
 return {
  mode:'double',
  names:shengma?SHENGMA_NAMES:DEFAULT_NAMES,
  unit:shengma?'探鑽':'',
  perUnit:{singer:Number(settings.livePrice)||0,host:extra,hall:extra},
  plans:(Array.isArray(settings.plans)?settings.plans:[]).map((plan,index)=>({id:'plan-'+(index+1),name:String(plan.name||''),units:Number(plan.amount),
   singer:Number(plan.fee)||0,host:Number(plan.double)||0,hall:Number(plan.double)||0,live:true,enabled:true})),
  tiers:byLevel(Array.isArray(settings.tiers)?settings.tiers:[]).map((tier,index)=>({id:'tier-'+(index+1),name:String(tier.name||''),fee:Number(tier.fee)||0,
   price:Number(tier.price)||0,host:opening,hall:opening,months:Number(tier.months)||0,enabled:true})),
  policy:'auto',
 };
}

export function normalizePricing(value={}){
 const mode=MODES.includes(value.mode)?value.mode:'double';
 const names={};for(const party of PARTIES)names[party]=text(value.names?.[party],DEFAULT_NAMES[party]);
 const singleFee=value.singleFee==='hall'?'hall':'host';
 const limit=row=>{const r=triple(row);if(mode==='none'){r.host=0;r.hall=0;}if(mode==='single'){if(singleFee==='host')r.hall=0;else r.host=0;}return r;};
 const plans=(Array.isArray(value.plans)?value.plans:[]).filter(plan=>plan&&plan.enabled!==false&&Number.isSafeInteger(Number(plan.units))&&Number(plan.units)>=1)
  .map(plan=>({id:String(plan.id||plan.name),name:String(plan.name||''),units:Number(plan.units),...limit(plan),live:plan.live!==false}));
 const tiers=(Array.isArray(value.tiers)?value.tiers:[]).filter(tier=>tier&&tier.enabled!==false&&typeof tier.name==='string'&&tier.name.trim())
  .map(tier=>{const fees=limit({singer:tier.fee,host:tier.host,hall:tier.hall});return Object.freeze({id:String(tier.id||tier.name),name:tier.name.trim(),
   fee:fees.singer,price:money(tier.price),host:fees.host,hall:fees.hall,months:Number.isSafeInteger(Number(tier.months))&&Number(tier.months)>0?Number(tier.months):0});});
 return Object.freeze({mode,singleFee,names:Object.freeze(names),unit:typeof value.unit==='string'?value.unit.trim().slice(0,10):'',
  perUnit:Object.freeze(limit(value.perUnit)),plans:Object.freeze(plans),tiers:Object.freeze(tiers),policy:POLICIES.includes(value.policy)?value.policy:'auto',
  streamerUsesPlans:value.streamerUsesPlans===true});
}

// ---- Hall pricing as stored (papa_space_policies, policy_key 'pricing') ----
// One object per 廳／獨立主播 Space; streamers inherit it. Amounts are whole gift
// values. Crown cards are in level order: the first one is level 1 (highest).
export const HALL_PRICING_VERSION=1;
export const HALL_PRICING_LIMITS=Object.freeze({amount:100000000,plans:20,tiers:10,units:100,months:120,name:10,label:20});
const control=/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const itemId=/^[a-z0-9][a-z0-9-]{0,39}$/;
function words(value,label,max,{required=true}={}){
 if(typeof value!=='string'||control.test(value))throw Error(label+'格式不正確');
 const v=value.trim();
 if(required&&!v)throw Error('請填'+label);
 if(v.length>max)throw Error(label+'最多 '+max+' 個字');
 return v;
}
function amount(value,label){
 const n=typeof value==='string'&&value.trim()!==''?Number(value):value;
 if(!Number.isSafeInteger(n)||n<0||n>HALL_PRICING_LIMITS.amount)throw Error(label+'請填 0 以上的整數');
 return n;
}
const bool=(value,fallback)=>value===undefined?fallback:value===true;
/**
 * Validates and canonicalises a hall pricing form. Throws one plain-language
 * error for the first thing the form must fix; returns the object to store.
 */
export function hallPricingInput(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['v','mode','singleFee','names','unit','perUnit','policy','plans','tiers'].includes(k)))throw Error('價目設定格式不正確');
 if(value.v!==undefined&&value.v!==HALL_PRICING_VERSION)throw Error('價目設定版本不正確，請重新開啟');
 if(!MODES.includes(value.mode))throw Error('請選擇計費方式');
 if(value.mode==='single'&&!['host','hall'].includes(value.singleFee))throw Error('單費模式請選擇收給誰');
 const mode=value.mode,singleFee=value.singleFee==='hall'?'hall':'host';
 const names={singer:words(value.names?.singer,'主播稱呼',HALL_PRICING_LIMITS.name),host:words(value.names?.host,'主持稱呼',HALL_PRICING_LIMITS.name),hall:words(value.names?.hall,'廳主號稱呼',HALL_PRICING_LIMITS.name)};
 const unit=words(value.unit??'','禮物單位',HALL_PRICING_LIMITS.name,{required:false});
 const fees=(row,label)=>{const r={singer:amount(row?.singer,label+'的'+names.singer),host:amount(row?.host??0,label+'的'+names.host),hall:amount(row?.hall??0,label+'的'+names.hall)};
  if(mode==='none'&&(r.host||r.hall))throw Error(label+'：無雙費模式不收'+names.host+'或'+names.hall+'費');
  if(mode==='single'&&r[singleFee==='host'?'hall':'host'])throw Error(label+'：單費模式只收'+names[singleFee]+'費');
  return r;};
 const perUnit=fees(value.perUnit,'一般每首');
 if(!POLICIES.includes(value.policy??'auto'))throw Error('請選擇存歌方案的優惠方式');
 const list=(rows,label,max)=>{if(rows===undefined)return [];if(!Array.isArray(rows))throw Error(label+'格式不正確');if(rows.length>max)throw Error(label+'最多 '+max+' 個');return rows;};
 const seen=new Set(),uniqueId=(id,label)=>{if(typeof id!=='string'||!itemId.test(id)||seen.has(id))throw Error(label+'識別碼不正確，請重新開啟');seen.add(id);return id;};
 const plans=list(value.plans,'存歌方案',HALL_PRICING_LIMITS.plans).map((plan,index)=>{
  const label='存歌方案第 '+(index+1)+' 個';
  if(!plan||typeof plan!=='object'||Array.isArray(plan))throw Error(label+'格式不正確');
  const name=words(plan.name,label+'的名稱',HALL_PRICING_LIMITS.label),units=Number(plan.units);
  if(!Number.isSafeInteger(units)||units<1||units>HALL_PRICING_LIMITS.units)throw Error('「'+name+'」的首數請填 1～'+HALL_PRICING_LIMITS.units+' 的整數');
  return {id:uniqueId(plan.id,label),name,units,...fees(plan,'「'+name+'」'),live:bool(plan.live,true),enabled:bool(plan.enabled,true)};
 });
 const tierNames=new Set();
 const tiers=list(value.tiers,'冠歌卡',HALL_PRICING_LIMITS.tiers).map((tier,index)=>{
  const label='冠歌卡第 '+(index+1)+' 張';
  if(!tier||typeof tier!=='object'||Array.isArray(tier))throw Error(label+'格式不正確');
  const name=words(tier.name,label+'的名稱',HALL_PRICING_LIMITS.label);
  if(tierNames.has(name))throw Error('冠歌卡名稱「'+name+'」重複了');tierNames.add(name);
  const opening=fees({singer:tier.fee,host:tier.host,hall:tier.hall},'「'+name+'」辦卡'),months=Number(tier.months??0);
  if(!Number.isSafeInteger(months)||months<0||months>HALL_PRICING_LIMITS.months)throw Error('「'+name+'」的期限請填 0～'+HALL_PRICING_LIMITS.months+' 個月（0＝永久）');
  return {id:uniqueId(tier.id,label),name,fee:opening.singer,price:amount(tier.price,'「'+name+'」冠後每首的'+names.singer),host:opening.host,hall:opening.hall,months,enabled:bool(tier.enabled,true)};
 });
 return {v:HALL_PRICING_VERSION,mode,singleFee,names,unit,perUnit,policy:value.policy??'auto',plans,tiers};
}

/** A new hall starts blank: default names, no unit, no prices, plans or cards (spec 2.2). */
export function blankHallPricing({names={},unit='',mode='double',singleFee='host'}={}){
 return hallPricingInput({mode,singleFee,names:{...DEFAULT_NAMES,...names},unit,perUnit:{singer:0,host:0,hall:0},policy:'auto',plans:[],tiers:[]});
}

/** 聲瑪 today, expressed as hall pricing (used once to fill the new record, and as the editor's starting point). */
export function legacyHallPricing(settings={},{shengma=true}={}){
 const legacy=legacyPricing(settings,{shengma});
 return hallPricingInput({...legacy,names:{...legacy.names},singleFee:'host'});
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
 // Plan names drop 一般 (user 2026-10-29); single slots at the ordinary price stay 一般.
 const parts=quote.pieces.map(p=>(p.kind==='plan'?String(p.name).replace(/一般\s*/g,'').trim()||p.name:'一般 '+p.units+' 首')+(p.count>1?' × '+p.count:''));
 const prefix=quote.card?quote.card+'｜':'';
 return plans.length?prefix+'自動套用最優惠方案：'+parts.join(' ＋ '):prefix+(quote.units===1?'一般價格':'一般價格（每首 × '+quote.units+'）');
}
