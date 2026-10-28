// Presentation only: no API, persistence, award operation or icon replacement.
export function createMedalUnlockTracker(){
 let identity=null,previous=null;
 return (key,rows)=>{
  const current=new Set(rows.filter(r=>!r.revoked&&(r.qualified||r.recorded)).map(r=>r.code));
  const fresh=identity===key&&previous?[...current].filter(code=>!previous.has(code)):[];
  identity=key;previous=current;return fresh;
 };
}
const running=new WeakMap();
export function playMedalAnimation(card){
 if(!card?.matches('.medal-earned')||!card.querySelector('[data-medal-replay]'))return false;
 running.get(card)?.();
 const view=card.ownerDocument.defaultView;
 if(view.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return false;
 const glow=card.ownerDocument.createElement('span');glow.className='medal-fx';glow.setAttribute('aria-hidden','true');
 for(let i=0;i<4;i++){const spark=card.ownerDocument.createElement('i');spark.style.setProperty('--spark',i);glow.append(spark);}
 card.append(glow);void card.offsetWidth;card.classList.add('medal-celebrate');
 const clean=()=>{view.clearTimeout(timer);card.classList.remove('medal-celebrate');glow.remove();card.removeEventListener('animationend',end);running.delete(card);};
 const end=e=>{if(e.target===card&&e.animationName==='medal-reveal')clean();};
 const timer=view.setTimeout(clean,1300);running.set(card,clean);card.addEventListener('animationend',end);return true;
}
export function installMedalReplay(root){
 const listener=e=>{const button=e.target.closest?.('[data-medal-replay]');if(!button||!root.contains(button))return;e.preventDefault();e.stopPropagation();playMedalAnimation(button.closest('.medal-row'));};
 root.addEventListener('click',listener);
 return ()=>root.removeEventListener('click',listener);
}
export function animateUnlockedMedals(root,codes){
 const selected=new Set(codes);
 for(const button of root.querySelectorAll('[data-medal-replay]'))if(selected.has(button.dataset.medalReplay))playMedalAnimation(button.closest('.medal-row'));
}
