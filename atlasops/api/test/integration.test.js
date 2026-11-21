// Runs only when RUN_INTEGRATION_TESTS=1 and PostgreSQL migrations have been applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const live=process.env.RUN_INTEGRATION_TESTS==='1';
const slug=()=>`test-${randomUUID().slice(0,10)}`;
async function request(app,url,method='GET',body,auth){
 const headers={'content-type':'application/json',...(auth?{cookie:auth.cookie,'x-csrf-token':auth.csrf,origin:process.env.PUBLIC_ORIGIN||'http://localhost:8080'}:{})};
 const r=await app.inject({method,url,headers,payload:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.statusCode,body:JSON.parse(r.body),headers:r.headers};
}
function cookies(reply){
 const pairs=(Array.isArray(reply.headers['set-cookie'])?reply.headers['set-cookie']:[reply.headers['set-cookie']])
  .filter(Boolean).map(x=>String(x).split(';')[0]);
 const csrf=pairs.find(x=>x.startsWith('ao_csrf='))?.split('=').slice(1).join('');
 return {cookie:pairs.join('; '),csrf:decodeURIComponent(csrf||'')};
}
async function register(app){
 const company=slug();
 const r=await request(app,'/api/auth/register','POST',{orgName:'Integration Test Company',slug:company,fullName:'Test Owner',email:`owner@${company}.test`,password:'IntegrationPassword123456!',signupCode:process.env.SIGNUP_INVITE_CODE});
 assert.equal(r.status,201,JSON.stringify(r.body));
 return {tenant:r.body.organization.id,auth:cookies(r)};
}
test('isolates tenants at both API and database layer', {skip:!live},async()=>{
 const {makeApp}=await import('../src/server.js');
 const {pool}=await import('../src/lib/db.js');
 const app=await makeApp();
 try{
  const a=await register(app),b=await register(app);
  const created=await request(app,'/api/data/customers','POST',{name:'Private Client A'},a.auth);
  assert.equal(created.status,201);
  const visible=await request(app,'/api/data/customers','GET',undefined,a.auth);
  assert.equal(visible.body.items.length,1);
  const other=await request(app,'/api/data/customers','GET',undefined,b.auth);
  assert.equal(other.body.items.length,0);
  const cross=await request(app,`/api/data/customers/${created.body.id}`,'GET',undefined,b.auth);
  assert.equal(cross.status,404);
  const unscoped=await pool.query('SELECT count(*)::int AS n FROM customers');
  assert.equal(unscoped.rows[0].n,0,'RLS must deny unscoped select');
  const badCsrf=await app.inject({method:'POST',url:'/api/data/customers',headers:{cookie:a.auth.cookie,'content-type':'application/json'},payload:JSON.stringify({name:'CSRF bypass'})});
  assert.equal(badCsrf.statusCode,403);
 }finally{await app.close();await pool.end();}
});
