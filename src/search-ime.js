export function installImeSubmitGuard(root){
 const composing=new WeakSet();
 let imeForm;
 root.addEventListener('compositionstart',event=>composing.add(event.target));
 root.addEventListener('compositionend',event=>composing.delete(event.target));
 root.addEventListener('keydown',event=>{
  if(event.key!=='Enter'&&event.keyCode!==229)return;
  imeForm=(event.isComposing||event.keyCode===229||composing.has(event.target))?event.target.form:null;
  if(imeForm){
   const form=imeForm;
   setTimeout(()=>{if(imeForm===form)imeForm=null;},0);
  }
 },true);
 return form=>imeForm===form||composing.has(form.ownerDocument?.activeElement);
}
