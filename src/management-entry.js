// This metadata entry never changes the login identity or business role.
// api must use the identity() Account's existing authenticated session, including
// the existing device/legacy refresh flow. Call load on explicit entry/login;
// do not call it from a polling loop or on every render.
export function createManagementEntry({api,identity,changed=()=>{}}){
 let state={loading:false,ready:false,capabilities:null,error:''},owner=null,generation=0,pending=null;
 const clear=()=>{generation++;owner=null;pending=null;state={loading:false,ready:false,capabilities:null,error:''};};
 async function load({force=false}={}){
  const account=identity();if(!account){clear();changed();return null;}
  if(owner!==account)clear();
  if(pending)return pending;
  if(state.ready&&!force)return state.capabilities;
  if(state.error&&!force)return null;
  owner=account;const ticket=++generation;state={loading:true,ready:false,capabilities:null,error:''};
  // Reserve the pending request before changed() can synchronously render and
  // request the capability again.
  let complete;const work=new Promise(resolve=>{complete=resolve;});pending=work;changed();
  void(async()=>{try{
   const result=await api({op:'platformManagementSession'});
   if(owner!==account||identity()!==account||ticket!==generation)return null;
   if(result?.version!==1||typeof result.allowed!=='boolean'||typeof result.president!=='boolean'||!Array.isArray(result.sections)||result.sections.length>5
    ||result.sections.some(value=>!['overview','halls','streamers','accounts','cleanup'].includes(value))||!result.permissions
    ||['streamers','administrators','reports'].some(key=>typeof result.permissions[key]!=='boolean'))throw Error('管理權限尚未確認');
   state={loading:false,ready:true,capabilities:result,error:''};return result;
  }catch(error){if(owner===account&&identity()===account&&ticket===generation)state={loading:false,ready:false,capabilities:null,error:error.message};return null;
  }finally{if(owner===account&&ticket===generation){pending=null;changed();}}})().then(complete);
  return work;
 }
 return {load,clear,state:()=>state,identity:()=>owner===identity()&&state.ready&&state.capabilities?.allowed?owner:null,
  sync:()=>{if(owner&&owner!==identity())clear();}};
}
