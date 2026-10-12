const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const id=value=>typeof value==='string'&&[...value].length>0&&[...value].length<=200&&!/[\u0000-\u001f\u007f]/.test(value);

// These locators come from the authenticated noticeTarget endpoint. A link's
// entity ID is never promoted to a conversation, player or board authority.
export function communicationTarget(value,context,kind){
 if(!value||value.found!==true||value.kind!==kind||context.demo
  ||value.spaceId!==(context.spaceId||'space-001')
  ||value.streamerId!==(context.streamerId||context.streamer)
  ||!Number.isSafeInteger(value.seq)||value.seq<1||value.seq>=999999999999999)return null;
 if(kind==='chat'){
  if(!uuid(value.messageId)||!id(value.playerId)||!context.manager&&value.playerId!==context.playerId)return null;
  return {playerId:value.playerId,messageId:value.messageId,seq:value.seq};
 }
 if(kind==='board'){
  if(!['global','streamer'].includes(value.scope)||!uuid(value.rootId)||!uuid(value.postId))return null;
  return {scope:value.scope,rootId:value.rootId,postId:value.postId,seq:value.seq,canReply:value.canReply===true};
 }
 return null;
}
