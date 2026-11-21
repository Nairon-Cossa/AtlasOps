export type RecordItem=Record<string,unknown>&{id?:string};
export type Actor={id:string;tenant_id:string;email:string;full_name:string;role:'owner'|'admin'|'manager'|'analyst'|'agent';status:string};
export type Session={user:Actor;organization:{name:string;slug:string;currency:string}};
type ApiProblem={error?:string;details?:Array<{path:string;message:string}>};
export function csrf(){
  const v=document.cookie.split('; ').find(x=>x.startsWith('ao_csrf='));
  return v?decodeURIComponent(v.split('=').slice(1).join('=')):'';
}
export async function api<T=Record<string,unknown>>(url:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch('/api'+url,{
    method,credentials:'same-origin',
    headers:{'Content-Type':'application/json',...(method!=='GET'?{'x-csrf-token':csrf()}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const result:ApiProblem=await response.json().catch(()=>({error:'Resposta inesperada do servidor.'}));
  if(!response.ok){
    const details=result.details?.map(i=>`${i.path||'Campo'}: ${i.message}`).join(' · ');
    throw new Error(details||result.error||`Pedido recusado (${response.status})`);
  }
  return result as T;
}
export const money=(n:unknown)=>new Intl.NumberFormat('pt-MZ',{maximumFractionDigits:2,minimumFractionDigits:0}).format(Number(n||0))+' MT';
export const shortDate=(x:unknown)=>x?new Date(String(x)).toLocaleDateString('pt-MZ',{day:'2-digit',month:'short',year:'numeric'}):'—';
export const localStamp=()=>new Date().toISOString();
export function value(v:unknown){return v===null||v===undefined||v===''?'—':typeof v==='object'?JSON.stringify(v):String(v);}
export const userCanWrite=(role:string,kind:string)=>{
  if(role==='owner'||role==='admin')return true;
  if(role==='manager')return !['sims','users','devices','audit'].includes(kind);
  if(role==='agent')return ['customers','leads','deals','tasks','calls'].includes(kind);
  return false;
};
