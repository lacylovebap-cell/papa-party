// Preserve existing Space 001 preferences while separating identical player
// IDs in other Spaces. The president's platform inbox stays platform scoped.
export function communicationIdentity(context, legacyKey){
 if(context.recipient==='__super__'&&context.streamer==='__global__')return legacyKey;
 const space=context.spaceId||'space-001';
 return space==='space-001'?legacyKey:JSON.stringify([space,legacyKey]);
}

// A route can choose a local cache partition, never grant access to a Space.
// Login metadata remains in its existing player/manager installation slots.
export function roomStorageKey(name,{spaceId,streamerSlug}={}){
 return ['draft','adminTab'].includes(name)?communicationIdentity({spaceId},name+'-'+(streamerSlug||'papa')):name;
}
