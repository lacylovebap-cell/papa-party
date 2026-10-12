// Shared server/domain projection over the existing ledger. Never a second book.
// Preserve the existing Taipei 19:00 show boundary (UTC 11:00).
export const accountingDay=(t,rolloverHour=19)=>new Date(Date.parse(t)+(8-rolloverHour)*3600000).toISOString().slice(0,10);
export const accountingRollover=s=>s.summary?.rolloverHour??s.accountingRolloverHour??(s.currentStreamer?.spaceId&&s.currentStreamer.spaceId!=='space-001'?0:19);
const cost=q=>Number(q.creditCost??1);
export const reservationAllocation=q=>q.kind==='live'&&q.allocation_model==='reservation-v1';
export function accountingStats(s,t){
 const rollover=accountingRollover(s),day=accountingDay(t,rollover),same=x=>x&&Number.isFinite(Date.parse(x))&&accountingDay(x,rollover)===day;
 const players=new Map((s.players||[]).map(p=>[p.playerId,p]));
 const valid=x=>!x.test&&!players.get(x.playerId)?.test;
 const deposits=(s.ledger||[]).filter(x=>valid(x)&&!x.voided_at&&!x.excludeStats&&!x.openingBalance&&x.note!=='初始存歌'&&!x.conversion&&!x.accounting_adjustment&&x.amount>0&&same(x.at));
 // Old prepaid allocations remain split receipts. New reservations already
 // have a full source receipt and must never be added a second time.
 const source=q=>(s.ledger||[]).find(l=>valid(l)&&l.playerId===q.playerId&&(l.id===q.source_transaction_id||q.allocation_id&&l.allocation_id===q.allocation_id)&&!l.queueId&&!l.conversion);
 const live=(s.queue||[]).filter(q=>valid(q)&&!q.receipt_voided_at&&q.kind==='live'&&!q.openingBalance&&!reservationAllocation(q)&&same(q.acceptedAt)&&(!q.allocation_id||!source(q)?.voided_at));
 const completed=(s.queue||[]).filter(q=>valid(q)&&q.kind!=='self'&&q.status==='completed'&&!q.performance_duplicate_of&&same(q.completedAt));
 const ledger=(s.ledger||[]).filter(valid),queues=(s.queue||[]).filter(valid);
 const saved=ledger.reduce((n,l)=>n+Number(l.amount),0);
 const reserved=queues.filter(q=>['pending','waiting'].includes(q.status)&&(q.kind==='saved'||reservationAllocation(q))).reduce((n,q)=>n+cost(q),0);
 const buckets=new Map(),key=(p,pool)=>p+'|'+(pool??'shengma'),add=(p,pool,n)=>{const k=key(p,pool);buckets.set(k,(buckets.get(k)||0)+n);};
 for(const l of deposits)add(l.playerId,l.storage_pool,Number(l.amount));
 for(const l of ledger.filter(l=>!l.voided_at&&l.conversion&&l.amount>0&&l.queueId)){
  const q=queues.find(q=>q.id===l.queueId);
  if(q&&same(q.acceptedAt)&&!q.receipt_voided_at&&(q.allocation_id?!source(q)?.voided_at:q.kind==='live'))add(l.playerId,l.storage_pool,Number(l.amount));
 }
 const receiptIds=new Set(deposits.map(l=>l.id)),start=Date.parse(day+'T00:00:00+08:00')+rollover*3600000;
 for(const q of queues){
  if(q.receipt_voided_at)continue;
  if(reservationAllocation(q)&&receiptIds.has(q.source_transaction_id)&&['pending','waiting','completed'].includes(q.status))add(q.playerId,q.allocation_storage_pool,-cost(q));
  else if(q.kind==='saved'&&['pending','waiting'].includes(q.status)&&Date.parse(q.at)>=start)add(q.playerId,q.consumed_storage_pool,-cost(q));
 }
 for(const l of ledger.filter(l=>l.amount<0&&!l.voided_at&&!l.reversal_of&&!l.conversion&&!receiptIds.has(l.source_transaction_id)&&Date.parse(l.at)>=start))add(l.playerId,l.storage_pool,Number(l.amount));
 const stored=[...buckets.values()].reduce((n,v)=>n+Math.max(0,v),0);
 return {received:deposits.reduce((n,l)=>n+Number(l.receipt_quantity??l.amount),0)+live.reduce((n,q)=>n+Number(q.receivedCreditCost??q.creditCost??1),0),stored,
  sung:completed.reduce((n,q)=>n+(q.items?.length||1),0),saved,reserved,available:saved-reserved};
}
