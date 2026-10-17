// These pages do not exist yet. Keep plain text until real URLs are supplied.
export const SITE_FOOTER_LINKS=Object.freeze({privacy:null,terms:null,contact:null});
const labels=[['privacy','隱私權政策'],['terms','服務條款'],['contact','聯絡我們']];
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function footerHref(value,baseUrl){
 if(typeof value!=='string'||!value.trim()||value.trim()==='#')return null;
 try{const url=new URL(value,baseUrl);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function siteFooterHtml({links=SITE_FOOTER_LINKS,baseUrl=import.meta.url}={}){
 const items=labels.map(([key,label])=>{const href=footerHref(links[key],baseUrl);return href?'<a href="'+escape(href)+'">'+label+'</a>':'<span>'+label+'</span>';});
 return '<nav class="site-footer-links" aria-label="法律與聯絡資訊">'+items.join('<span aria-hidden="true">｜</span>')+'</nav>'
  +'<p>© 2026 PA Party. All Rights Reserved.</p>'
  +'<p><span data-footer-version>版本讀取中</span> · Made with ♡ by PaPa</p>';
}
const mounted=new WeakMap();
export function mountSiteFooter(root,{fetchVersion=globalThis.fetch,releaseUrl=new URL('../release.json',import.meta.url),links=SITE_FOOTER_LINKS}={}){
 if(!root)return Promise.resolve();
 if(mounted.has(root))return mounted.get(root);
 root.innerHTML=siteFooterHtml({links,baseUrl:releaseUrl});
 const version=root.querySelector('[data-footer-version]');
 const ready=(async()=>{
  try{
   const response=await fetchVersion(releaseUrl,{cache:'no-cache',signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error('Release unavailable');
   const release=await response.json();
   if(typeof release?.version!=='string'||!/^\d[\w.-]{0,63}$/.test(release.version))throw Error('Release invalid');
   version.textContent='v'+release.version;
  }catch{version.textContent='版本暫不可用';}
 })();
 mounted.set(root,ready);return ready;
}
if(typeof document!=='undefined')mountSiteFooter(document.querySelector('#site-footer'));
