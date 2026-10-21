// Management capability is separate from the authenticated business role.
// Only the Edge-verified Account is used; no caller-selected actor is accepted.
export async function readManagementSession(api,who){
 if(!who||typeof who.accountId!=='string'||!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(who.accountId))throw Error('請先登入');
 if(who.role!=='super_admin')return {version:1,allowed:false,president:false,permissions:{streamers:false,administrators:false,reports:false},sections:[]};
 const result=await api('/rest/v1/rpc/papa_management_session',{subject:who.accountId});
 const value=validateManagementSession(result);if(!value.president)return {version:1,allowed:false,president:false,permissions:{streamers:false,administrators:false,reports:false},sections:[]};return value;
}
export function validateManagementSession(result){
 const permitted=['overview','halls','streamers','accounts','cleanup'],permissions=result?.permissions;
 if(!result||result.version!==1||typeof result.allowed!=='boolean'||typeof result.president!=='boolean'
  ||!permissions||['streamers','administrators','reports'].some(key=>typeof permissions[key]!=='boolean')
  ||!Array.isArray(result.sections)||result.sections.length>5||new Set(result.sections).size!==result.sections.length
  ||result.sections.some(section=>!permitted.includes(section)))throw Error('管理權限尚未確認');
 const expected=[];
 if(permissions.streamers||permissions.administrators||permissions.reports)expected.push('overview');
 if(permissions.streamers||permissions.administrators)expected.push('halls');
 if(permissions.streamers)expected.push('streamers');
 if(permissions.administrators)expected.push('accounts');
 if(permissions.streamers)expected.push('cleanup');
 if(result.allowed!==(expected.length>0)||JSON.stringify(result.sections)!==JSON.stringify(expected)
  ||result.president&&(!permissions.streamers||!permissions.administrators||!permissions.reports))throw Error('管理權限尚未確認');
 // Project known fields: unexpected backend data never becomes a second auth
 // identity or exposes account/session/credential fields to the client.
 return {version:1,allowed:result.allowed,president:result.president,
  permissions:{streamers:permissions.streamers,administrators:permissions.administrators,reports:permissions.reports},sections:[...result.sections]};
}
