// Hall pricing: one record per 廳／獨立主播 Space (papa_space_policies 'pricing').
// Streamers inherit it; the server prices every request from it. Only the
// platform president edits it for now (hall admins and the approval centre come
// in a later batch). The subject is always the Edge-verified Account.
import {hallPricingInput,blankHallPricing,legacyHallPricing} from '../../../src/pricing-engine.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const spaceId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);

export function createSpacePricing({api,log=()=>{}}){
 const requirePresident=who=>{if(who?.role!=='super_admin'||!UUID.test(who?.accountId||''))throw Error('僅限平台總裁');return who.accountId;};
 return {
  // The effective hall pricing for request pricing and displays, or null when
  // the Space has none yet (the streamer's legacy price fields then apply).
  async forSpace(space){
   if(!spaceId(space))return null;
   const rows=await api('/rest/v1/papa_space_policies?space_id=eq.'+encodeURIComponent(space)+'&policy_key=eq.pricing&select=value,revision&limit=1');
   const row=Array.isArray(rows)?rows[0]:null;
   if(!row?.value||typeof row.value!=='object'||!Object.keys(row.value).length)return null;
   // Saves are validated; a record that no longer validates is never half-used.
   try{return hallPricingInput(row.value);}
   catch(error){log('hall pricing ignored for '+space+': '+error.message);return null;}
  },
  async read(b,who){
   const subject=requirePresident(who);
   if(!spaceId(b.spaceId))throw Error('管理查詢格式不正確');
   const result=await api('/rest/v1/rpc/papa_management_space_pricing',{subject,requested_space:b.spaceId});
   if(!result||result.spaceId!==b.spaceId||!Number.isSafeInteger(result.revision)||!Number.isInteger(result.rolloverHour))throw Error('價目設定尚未確認');
   if(result.pricing)return {...result,pricing:hallPricingInput(result.pricing),stored:true};
   // No record yet: 聲瑪 starts from what its streamers use today, any other
   // Space from a blank form (nothing is copied from 聲瑪).
   let suggestion=blankHallPricing();
   if(b.spaceId==='space-001'){
    const rows=await api('/rest/v1/papa_v2_entities?kind=eq.meta&id=eq.1&select='+encodeURIComponent('s:data->streamerSettings->papa')+'&limit=1');
    if(rows?.[0]?.s)suggestion=legacyHallPricing(rows[0].s,{shengma:true});
   }
   return {...result,pricing:suggestion,stored:false};
  },
  async save(b,who){
   const subject=requirePresident(who);
   if(typeof b.operationId!=='string'||!UUID.test(b.operationId))throw Error('管理操作格式不正確');
   if(!spaceId(b.spaceId)||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)throw Error('管理操作格式不正確');
   if(!Number.isInteger(b.rolloverHour)||b.rolloverHour<0||b.rolloverHour>23)throw Error('每日換場時間請選 0～23 點');
   const pricing=hallPricingInput(b.pricing);
   return api('/rest/v1/rpc/papa_management_space_pricing_save',{subject,operation:b.operationId,
    payload:{spaceId:b.spaceId,expectedRevision:b.expectedRevision,rolloverHour:b.rolloverHour,pricing}});
  },
 };
}
