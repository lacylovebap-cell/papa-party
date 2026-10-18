import {scopedOperationalAction} from './state-patch.js?v=10.18-WEB.1';

export const supportsOperationReceipt=body=>body?.op==='mutate'&&scopedOperationalAction(body.action)
 ||['requestsBatch','ownQueueBatch'].includes(body?.op);

// One business send only. Recovery queries receipts and current state; it never
// resends the operation, including an absent receipt or a timed-out lookup.
export async function sendReceiptedOperation(body,{send,isCurrent,uuid=()=>crypto.randomUUID()}){
 const payload={...body,operationId:body.operationId||uuid()};
 const current=()=>{if(!isCurrent())throw Object.assign(Error('登入身分或頁面範圍已變更，請重新操作'),{staleResponse:true});};
 const uncertain=()=>Object.assign(Error('送出結果尚未確認，請先查看最新待播或紀錄，避免重複送出'),{outcomeUnknown:true});
 const receipt=async(streamer,intent)=>{
  current();
  try{
   const r=await send({op:'operationReceipt',streamer,token:payload.token,operationId:payload.operationId,intent});current();
   return r.response.ok&&!r.data?.error&&r.data?.committed===true&&Number.isSafeInteger(r.data.revision)?r.data:null;
  }catch(error){current();return null;}
 };
 let result;
 try{result=await send(payload);}catch(error){}
 current();
 const batch=Array.isArray(payload.jobs);
 const failed=!result||!result.response.ok||result.data?.error;
 if(failed&&result&&(result.data?.notCommitted===true||result.response.status===401||result.response.status===403))return result;
 if(!failed&&(!batch||!result.data?.results?.some(row=>row.unknown)))return result;
 if(failed&&result&&result.data?.outcome!=='unknown'&&result.response.status<500)return result;
 if(batch){
  const results=[];let confirmed=0;
  for(const job of payload.jobs){
   const known=result?.data?.results?.find(row=>row.streamer===job.streamer);
   if(known&&!known.unknown){results.push(known);continue;}
   const found=await receipt(job.streamer,{op:payload.op,rows:job.rows});
   if(found){confirmed++;results.push({streamer:job.streamer,ok:true,count:job.rows.length,revision:found.revision});}
   else results.push(known||{streamer:job.streamer,ok:false,unknown:true,error:'結果待確認，請先查看待播，勿重複送出'});
  }
  if(!failed||confirmed)return {response:result?.response?.ok?result.response:{ok:true,status:200},data:{results,operationRecovered:confirmed>0}};
  throw uncertain();
 }
 const found=await receipt(payload.streamer,{op:'mutate',action:payload.action});
 if(!found)throw uncertain();
 current();
 try{
  const fresh=await send({op:'read',streamer:payload.streamer,token:payload.token,revision:-1,signatures:{},
   ...(payload.profilePlayerId?{profilePlayerId:payload.profilePlayerId}:{})});current();
  if(fresh.response.ok&&!fresh.data?.error&&Number.isSafeInteger(fresh.data?.state?.revision)&&fresh.data.state.revision>=found.revision)
   return {...fresh,data:{...fresh.data,operationRecovered:true}};
 }catch(error){current();}
 throw Object.assign(Error('操作已送出，但最新畫面尚未取得；請先重新整理，勿重複送出'),{outcomeUnknown:true,receiptConfirmed:true});
}
