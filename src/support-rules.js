// 平台營運支持的純計算規則。沒有 DOM、沒有網路，前後端與測試共用同一份。
// 原則：只有後端確認成功的交易才計入總額；沒有資料就是 0，絕不補假數字。

export const SUPPORT_PRESETS=Object.freeze([100,300,500]);
// 預設上下限只是保守值；金流商核准後由 support_settings 覆寫。
export const SUPPORT_LIMITS=Object.freeze({min:30,max:20000});
// 只有這三個狀態算「已確認」，待付款／失敗／取消／逾時／退款都不算。
export const SUPPORT_COUNTED=Object.freeze(['paid']);
export const SUPPORT_STATUSES=Object.freeze(['pending','paid','failed','cancelled','expired','refunded']);

const money=value=>{
 const n=Number(value);
 return Number.isFinite(n)?Math.round(n):0;
};
const nonNegative=value=>Math.max(0,money(value));

export function supportLimits(raw){
 const min=money(raw?.min),max=money(raw?.max);
 if(min<1||max<min)return SUPPORT_LIMITS;
 return Object.freeze({min,max});
}

// 使用者輸入的自訂金額：必須是正整數且落在金流商限制內。
export function validAmount(value,limits=SUPPORT_LIMITS){
 const {min,max}=supportLimits(limits);
 if(typeof value==='string'&&!/^\s*\d{1,9}\s*$/.test(value))return null;
 const n=Number(value);
 if(!Number.isInteger(n)||n<min||n>max)return null;
 return n;
}

export function supportNickname(value,anonymous){
 if(anonymous)return '';
 const text=String(value??'').replace(/\s+/g,' ').trim().slice(0,24);
 return text;
}

// 建立訂單前的前端草稿檢查。回傳 {ok,reason} 或 {ok,amount,anonymous,nickname}。
export function orderDraft({amount,anonymous=false,nickname=''}={},limits=SUPPORT_LIMITS){
 const value=validAmount(amount,limits);
 if(value===null){
  const {min,max}=supportLimits(limits);
  return {ok:false,reason:'金額需為 NT$'+min+' 至 NT$'+max+' 之間的整數'};
 }
 return {ok:true,amount:value,anonymous:!!anonymous,nickname:supportNickname(nickname,anonymous)};
}

// 把後端摘要整理成頁面要顯示的數字。任何缺漏都當 0，不猜、不推估。
export function supportSummary(raw){
 const goal=nonNegative(raw?.goal),received=nonNegative(raw?.received);
 const fees=nonNegative(raw?.fees),refunded=nonNegative(raw?.refunded);
 const expenses=nonNegative(raw?.expenses);
 const usable=Math.max(0,received-fees-refunded);
 return {
  month:typeof raw?.month==='string'&&/^\d{4}-\d{2}$/.test(raw.month)?raw.month:'',
  goal,received,fees,refunded,expenses,usable,
  remaining:usable-expenses,
  percent:goal>0?Math.min(100,Math.round(received/goal*1000)/10):0,
  count:nonNegative(raw?.count),
  gatewayLive:raw?.gatewayLive===true,
  limits:supportLimits(raw?.limits)
 };
}

export const formatNT=value=>'NT$'+money(value).toLocaleString('en-US');
