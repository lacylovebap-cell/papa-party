// Presentation only. Each original grant remains independently editable.
export function groupManagementRoles(memberships) {
 const groups=new Map();
 for(const member of memberships||[]) {
  // Never merge by name, manager key, or a missing Account ID.
  const key=member.accountId||Symbol('unverified-account');
  if(!groups.has(key))groups.set(key,{accountId:member.accountId,name:member.name,managerKey:member.managerKey,displayNumber:member.displayNumber,memberships:[]});
  groups.get(key).memberships.push(member);
 }
 return [...groups.values()].map(group=>{
  const active=group.memberships.filter(m=>m.status==='active').length;
  return {...group,status:active===group.memberships.length?'active':active?'mixed':'suspended'};
 });
}
export function managementRoleLabel(member,{ownerAccountId,spaceName}={}) {
 if(member.role==='space_admin')return `${(spaceName||'本廳').replace(/廳$/,'')}${member.accountId===ownerAccountId?'廳主':'廳管理員'}`;
 return member.streamerName?`主播：${member.streamerName}`:'主播';
}
