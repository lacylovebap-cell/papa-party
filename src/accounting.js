// Shared server/domain projection over the existing ledger. Never a second book.
export const accountingDay=t=>new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10);
const cost=q=>Number(q.creditCost??1);
export const reservationAllocation=q=>q.kind==='live'&&q.allocation_model==='reservation-v1';
export function accountingStats(s,t){
 const day=accountingDay(t),same=x=>x&&Number.isFinite(Date.parse(x))&&accountingDay(x)===day;
 const players=new Map((s.players||[]).map(p=>[p.playerId,p]));
 const valid=x=>!x.test&&!players.get(x.playerId)?.test;
 const deposits=(s.ledger||[]).filter(x=>valid(x)&&!x.voided_at&&!x.excludeStats&&!x.openingBalance&&x.note!=='初始存歌'&&!x.conversion&&!x.accounting_adjustment&&x.amount>0&&same(x.at));
 // Old prepaid allocations remain split receipts. New reservations already
 // have a full source receipt and must never be added a second time.
 const live=(s.queue||[]).filter(q=>valid(q)&&q.kind==='live'&&!q.openingBalance&&!reservationAllocation(q)&&same(q.acceptedAt));
 const completed=(s.queue||[]).filter(q=>valid(q)&&q.kind!=='self'&&q.status==='completed'&&same(q.completedAt));
 const ledger=(s.ledger||[]).filter(valid),queues=(s.queue||[]).filter(valid);
 const saved=ledger.reduce((n,l)=>n+Number(l.amount),0);
 const reserved=queues.filter(q=>['pending','waiting'].includes(q.status)&&(q.kind==='saved'||reservationAllocation(q))).reduce((n,q)=>n+cost(q),0);
 return {received:deposits.reduce((n,l)=>n+Number(l.receipt_quantity??l.amount),0)+live.reduce((n,q)=>n+Number(q.receivedCreditCost??q.creditCost??1),0),
  sung:completed.reduce((n,q)=>n+(q.items?.reduce((v,i)=>v+Number(i.performances??1),0)||1),0),saved,reserved,available:saved-reserved};
}
