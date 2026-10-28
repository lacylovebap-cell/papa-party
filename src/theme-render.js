// Applies a theme to a document root (real pages) or to the preview iframe.
// Pure CSS: colours, image opacity and masks change custom properties only, so
// slider moves never re-request an image or touch the network.
import {themeNormalize,themeCssVariables,themePageLayer,themeImageValue} from './theme-engine.js?v=10.28-THEME.5';

const themeVarNames=new Set();
export function themeApply(root,theme,{resolve=u=>u,hall=false}={}){
 if(!root)return;
 if(!theme){themeClear(root);return;}
 const t=themeNormalize(theme,{hall}),vars={...themeCssVariables(t,{resolve}),'--theme-page-layer':themePageLayer(t,{resolve})||'none'};
 root.dataset.themeV2=t.mode;root.dataset.homeTheme='custom';
 for(const [k,v] of Object.entries(vars)){themeVarNames.add(k);if(root.style.getPropertyValue(k)!==v)root.style.setProperty(k,v);}
 const doc=root.ownerDocument,body=doc.body;
 if(!body)return;
 let layer=body.querySelector(':scope>.theme-page-layer');
 // A background image is a separate fixed layer, so it never fades content.
 if(vars['--theme-page-layer']!=='none'){if(!layer){layer=doc.createElement('div');layer.className='theme-page-layer';layer.setAttribute('aria-hidden','true');body.prepend(layer);}}
 else layer?.remove();
}
export function themeClear(root){
 if(!root)return;
 delete root.dataset.themeV2;
 for(const k of themeVarNames)root.style.removeProperty(k);
 root.ownerDocument?.body?.querySelector(':scope>.theme-page-layer')?.remove();
}
// Inline style for a banner <img>: focus and opacity of the shared banner file.
export function themeBannerImageStyle(theme,{hallCard=false}={}){
 if(!theme)return '';
 const b=themeImageValue(themeNormalize(theme).images.banner,'banner');
 return hallCard?`object-position:${b.hallX}% ${b.hallY}%;opacity:${b.hallOpacity/100}`:`object-position:${b.x}% ${b.y}%;opacity:${b.opacity/100}`;
}
export function themeBannerUrl(theme){return theme?themeNormalize(theme).images.banner?.url||'':'';}
// Decorations sit above the content but never take a click or a tap.
export function themeDecorHtml(theme,{resolve=u=>u,editable=false,escape=v=>String(v)}={}){
 if(!theme)return '';
 const items=themeNormalize(theme).decor;
 if(!items.length)return '';
 return '<div class="theme-decor-layer'+(editable?' editable':'')+'" aria-hidden="true">'+items.map((d,i)=>'<img class="theme-decor" data-decor-index="'+i+'" alt="" decoding="async" draggable="false" src="'+escape(resolve(d.url))+'" style="left:'+d.x+'%;top:'+d.y+'%;width:clamp(36px,'+d.size+'%,'+Math.round(d.size*9)+'px);opacity:'+d.opacity/100+'">').join('')+'</div>';
}
