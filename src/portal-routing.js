// Preserve existing bookmarked rooms, notification targets and space handoffs.
export function legacyPortalDestination(input){
 const u=new URL(input);
 const marketing=new Set(['','#features','#experience','#audience','#plans']);
 const keys=['streamer','streamerId','space','spaceId','demo','commonRequest','commonKind','portalLogin','entityType','entityId','notificationId','player','adminTab','tab'];
 if(!keys.some(k=>u.searchParams.has(k))&&marketing.has(u.hash))return null;
 u.pathname=u.pathname.replace(/(?:index\.html)?$/,'v2.html');
 return u.href;
}
