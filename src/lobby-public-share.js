/** The current discovery API is specifically the existing 聲瑪 Space. */
export function lobbyPublicScope({context,href,mountUrl}){
 let url,legacy;try{url=new URL(href);legacy=new URL('lobby.html',mountUrl);}catch{return {supported:false};}
 if(context)return context.kind==='hall'&&context.spaceId==='space-001'?{supported:true,spaceId:'space-001',name:'聲瑪',legacy:false}:{supported:false};
 if(url.searchParams.has('spaceId')&&url.searchParams.get('spaceId')!=='space-001'||url.searchParams.has('space')&&url.searchParams.get('space')!=='papa-party')return {supported:false};
 return url.origin===legacy.origin&&url.pathname===legacy.pathname?{supported:true,spaceId:'space-001',name:'聲瑪',legacy:true}:{supported:false};
}

export function lobbyLoginIntent(href){
 const params=new URL(href).searchParams;
 return params.getAll('portalLogin').length===1&&['player','admin'].includes(params.get('portalLogin'))?params.get('portalLogin'):null;
}
export function lobbyLoginLocation(href,kind){
 if(!['player','admin'].includes(kind))throw Error('登入方式尚未確認');
 const url=new URL(href);url.hash='';url.searchParams.set('portalLogin',kind);
 // No account, token or management navigation is ever propagated through a hall entry.
 for(const key of [...url.searchParams.keys()])if(!['portalLogin','q','language','performerType','versionKind','roomQ','sort','page','roomPage'].includes(key))url.searchParams.delete(key);
 return url.href;
}
export function lobbyLoginPrompt(href,name='聲瑪'){
 const kind=lobbyLoginIntent(href);
 return kind?'請先選擇一位'+name+'主播，再進行'+(kind==='admin'?'管理登入':'玩家登入')+'。':'';
}

export async function openLobbyPublicShare({scope,links,share}){
 if(scope?.supported!==true||scope.spaceId!=='space-001')throw Error('此廳目前尚未開放');
 const info=await links.info({kind:'hall',spaceId:scope.spaceId});
 // shareUrl only accepts configured, server-validated stable scope metadata.
 const url=links.shareUrl(info);
 return share.open({name:scope.name,url,kind:'hall'});
}
