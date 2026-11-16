// Presentation only: celebratory pop-up when an "achievement" notification arrives.
const STYLE_ID='medal-celebrate-style';
const CSS=`
.medal-pop{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,#000 55%,transparent);animation:medal-pop-fade .25s ease-out;cursor:pointer}
.medal-pop-card{position:relative;box-sizing:border-box;width:300px;max-width:100%;justify-self:center;padding:30px 22px 22px;border-radius:20px;text-align:center;color:inherit;background:var(--home-panel,#1b1722);border:1px solid var(--blue,#a886cc);box-shadow:0 0 0 1px color-mix(in srgb,var(--blue,#a886cc) 30%,transparent),0 18px 60px #000a,0 0 60px color-mix(in srgb,var(--blue,#a886cc) 45%,transparent);animation:medal-pop-in .6s cubic-bezier(.2,1.3,.4,1) both;overflow:hidden}
.medal-pop-ico{display:block;font-size:64px;line-height:1;margin:0 0 10px;animation:medal-pop-spin 1s ease-out both}
.medal-pop-card small{display:block;color:var(--muted,#aaa2b6);letter-spacing:2px;font-size:12px}
.medal-pop-card b{display:block;margin:6px 0 4px;font-size:20px;overflow-wrap:anywhere}
.medal-pop-card p{margin:6px 0 0;font-size:12px;color:var(--muted,#aaa2b6)}
.medal-pop-card i{position:absolute;width:8px;height:8px;background:var(--blue,#a886cc);clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);opacity:0;animation:medal-pop-spark 1.6s ease-out infinite}
@keyframes medal-pop-fade{from{opacity:0}to{opacity:1}}
@keyframes medal-pop-in{0%{transform:scale(.4) translateY(30px);opacity:0}100%{transform:none;opacity:1}}
@keyframes medal-pop-spin{0%{transform:scale(.2) rotate(-200deg);opacity:0}70%{transform:scale(1.2) rotate(10deg);opacity:1}100%{transform:none}}
@keyframes medal-pop-spark{0%{opacity:0;transform:scale(.3)}30%{opacity:1}100%{opacity:0;transform:scale(1.4) translateY(-14px)}}
@media(prefers-reduced-motion:reduce){.medal-pop,.medal-pop-card,.medal-pop-ico,.medal-pop-card i{animation:none!important}.medal-pop-card i{display:none}}
`;
export function medalNameFromBody(body){const m=String(body||'').match(/「([^」]+)」/);return m?m[1]:String(body||'').replace(/^.*?｜/,'');}
const queue=[];let showing=false;
export function showMedalCelebration(body,doc=document){
 queue.push(body);if(!showing)next(doc);
}
function next(doc){
 const body=queue.shift();if(body===undefined){showing=false;return;}
 showing=true;
 if(!doc.getElementById(STYLE_ID)){const st=doc.createElement('style');st.id=STYLE_ID;st.textContent=CSS;doc.head.append(st);}
 const wrap=doc.createElement('div');wrap.className='medal-pop';wrap.setAttribute('role','alertdialog');wrap.setAttribute('aria-label','取得勳章');
 const name=medalNameFromBody(body);
 const card=doc.createElement('div');card.className='medal-pop-card';
 const ico=doc.createElement('span');ico.className='medal-pop-ico';ico.setAttribute('aria-hidden','true');ico.textContent='🏅';
 const s=doc.createElement('small');s.textContent='🎉 恭喜取得勳章';
 const b=doc.createElement('b');b.textContent=name;
 const p=doc.createElement('p');p.textContent='點一下關閉';
 for(let i=0;i<6;i++){const sp=doc.createElement('i');sp.style.left=(8+i*15)+'%';sp.style.top=(10+(i%3)*22)+'%';sp.style.animationDelay=(i*0.25)+'s';card.append(sp);}
 card.append(ico,s,b,p);wrap.append(card);doc.body.append(wrap);
 const view=doc.defaultView;let done=false;
 const close=()=>{if(done)return;done=true;view.clearTimeout(t);wrap.remove();next(doc);};
 const t=view.setTimeout(close,5000);wrap.addEventListener('click',close);
}
