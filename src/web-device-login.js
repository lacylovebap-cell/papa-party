import {createDeviceSessions} from './device-session.js?v=10.10-WEB.1';
import {createWebCredentialStore} from './web-credential-store.js?v=10.10-WEB.1';

// Keeps the existing login UI and demo mode. Unsupported browsers retain the
// legacy login instead of enabling an unsafe long-lived credential fallback.
export function createWebDeviceLogin({environment=globalThis,transport,appVersion}){
 try{
  const adapter=createWebCredentialStore({indexedDB:environment.indexedDB,crypto:environment.crypto,locks:environment.navigator?.locks});
  const storageKey='pa-party-installation-v1';
  let installationId=environment.localStorage.getItem(storageKey);
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(installationId||'')){
   installationId=environment.crypto.randomUUID();environment.localStorage.setItem(storageKey,installationId);
  }
  const client=createDeviceSessions({...adapter,transport,installationId,platform:'web',appVersion});
  return {
   client,
   async remember(identity,scope={}){
    const role=identity.role||'player';let token;
    try{token=await client.remember(role,identity.token,scope);}catch(error){
     // If the initial refresh went offline after registration, preserve the
     // matching metadata so reload/logout can recover that device. An existing
     // different identity or revoked/storage-failed session is never adopted.
     if(!error.deviceRegistered||error.authExpired||!await client.identity(role))throw error;
    }
    const verified=await client.identity(role);
    return {...identity,...verified,device:true,token,refreshToken:undefined};
   },
   async switchSpace(identity,scope={}){
    if(!identity?.device)throw Error('請先登入裝置');
    const role=identity.role||'player';let token,verified;
    try{token=await client.switchSpace(role,scope,identity);}catch(error){
     if(!error.deviceRegistered||error.authExpired||!error.deviceIdentity?.sessionId)throw error;
     verified=await client.identity(role,{sessionId:error.deviceIdentity.sessionId});if(!verified)throw error;
    }
    verified ||= await client.identity(role,{token});if(!verified)throw Error('此登入不適用目前頁面');
    const {token:oldToken,refreshToken,sessionId,spaceId,streamerId,playerId,loginId,selectedSpace,homeSpace,lastSpace,spaceSlug,selectedStreamerId,...metadata}=identity;
    return {...metadata,...verified,device:true,token};
   },
   async access(identity){return identity?.device?client.token(identity.role||'player',{sessionId:identity.sessionId,spaceId:identity.spaceId,streamerId:identity.streamerId,playerId:identity.playerId}):identity?.token||null;},
   async logout(identity){if(identity?.device)await client.logout(identity.role||'player');},
   persisted(identity){if(!identity?.device)return identity;const {token,refreshToken,accessUntil,until,...metadata}=identity;return metadata;}
  };
 }catch{return null;}
}
