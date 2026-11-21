import {z} from 'zod';
import {token,digest} from '../lib/crypto.js';
import {query,withTenant,audit} from '../lib/db.js';
import {getActor,can,checkCsrf} from '../lib/auth.js';
import {fail,pageParams} from '../lib/http.js';
const id=z.string().uuid(),str=z.string().trim().min(1);
const event=z.object({externalId:str.max(128),remotePhoneE164:str.max(24),direction:z.enum(['outgoing','incoming','missed','rejected']),startedAt:z.string().datetime({offset:true}),durationSeconds:z.number().int().min(0).max(86400)}).strict();
export async function deviceRoutes(app){
 app.get('/devices',async req=>{
  await getActor(req);can(req,'owner','admin','manager','analyst');
  const r=await withTenant(req.actor.tenant_id,db=>db.query("SELECT d.id,d.employee_id,d.sim_id,d.device_label,d.os_name,d.status,d.last_synced_at,e.full_name AS employee_name FROM devices d LEFT JOIN employees e ON e.id=d.employee_id ORDER BY d.created_at DESC LIMIT 100"));
  return {items:r.rows};
 });
 app.post('/devices/enrollment',async(req,reply)=>{
  await getActor(req);checkCsrf(req);can(req,'owner','admin');
  const x=z.object({employeeId:id,simId:id,deviceLabel:str.max(120)}).strict().parse(req.body);
  const enrollToken=token(),hash=digest(enrollToken);
  const result=await withTenant(req.actor.tenant_id,async db=>{
   const validSim=await db.query("SELECT id FROM sim_cards WHERE id=$1 AND employee_id=$2 AND status='active'",[x.simId,x.employeeId]);
   if(!validSim.rowCount)fail(400,'An active corporate SIM assigned to this employee is required');
   const r=await db.query('INSERT INTO device_enrollments(tenant_id,employee_id,sim_id,device_label,enrollment_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'30 minutes\') RETURNING id,expires_at',[req.actor.tenant_id,x.employeeId,x.simId,x.deviceLabel,hash]);
   await db.query('INSERT INTO enrollment_directory(enrollment_hash,tenant_id,enrollment_id) VALUES($1,$2,$3)',[hash,req.actor.tenant_id,r.rows[0].id]);
   await audit(db,req.actor.tenant_id,req.actor.id,'device.enrollment_issued','device_enrollments',r.rows[0].id);
   return r.rows[0];
  });
  return reply.code(201).send({enrollmentToken:enrollToken,expiresAt:result.expires_at,warning:'Shown once. Treat as a secret.'});
 });
 app.post('/device-api/enroll',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{
  const x=z.object({enrollmentToken:z.string().min(30).max(128),osName:z.string().max(40).default('android')}).strict().parse(req.body);
  const hash=digest(x.enrollmentToken);
  const d=await query('SELECT tenant_id,enrollment_id FROM enrollment_directory WHERE enrollment_hash=$1',[hash]);
  if(!d.rowCount)fail(401,'Invalid enrollment token');
  const {tenant_id:tenantId,enrollment_id:enrollmentId}=d.rows[0];
  const deviceToken=token();const result=await withTenant(tenantId,async db=>{
   const e=await db.query('SELECT * FROM device_enrollments WHERE id=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[enrollmentId]);
   if(!e.rowCount)fail(401,'Expired or used enrollment token');
   const item=e.rows[0];
   const r=await db.query('INSERT INTO devices(tenant_id,employee_id,sim_id,device_label,device_token_hash,os_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,employee_id,sim_id',[tenantId,item.employee_id,item.sim_id,item.device_label,digest(deviceToken),x.osName]);
   await db.query('UPDATE device_enrollments SET used_at=now() WHERE id=$1',[enrollmentId]);
   await db.query('DELETE FROM enrollment_directory WHERE enrollment_hash=$1',[hash]);
   await db.query('INSERT INTO device_directory(device_token_hash,tenant_id,device_id) VALUES($1,$2,$3)',[digest(deviceToken),tenantId,r.rows[0].id]);
   return r.rows[0];
  });
  return reply.code(201).send({deviceId:result.id,deviceToken,simId:result.sim_id,employeeId:result.employee_id,notice:'Device-reported data is not independent carrier verification.'});
 });
 app.post('/device-api/calls',{config:{rateLimit:{max:100,timeWindow:'1 minute'}}},async(req)=>{
  const raw=req.headers.authorization;
  if(typeof raw!=='string'||!raw.startsWith('Device '))fail(401,'Device authentication required');
  const key=raw.slice(7).trim();
  if(key.length<30 || key.length>128)fail(401,'Invalid device token');
  const d=await query('SELECT tenant_id,device_id FROM device_directory WHERE device_token_hash=$1',[digest(key)]);
  if(!d.rowCount)fail(401,'Invalid device token');
  const {tenant_id:tenantId,device_id:deviceId}=d.rows[0];
  const x=z.object({events:z.array(event).max(200)}).strict().parse(req.body);
  return withTenant(tenantId,async db=>{
   const device=await db.query("SELECT employee_id,sim_id FROM devices WHERE id=$1 AND status='active' FOR UPDATE",[deviceId]);
   if(!device.rowCount)fail(403,'Device revoked');
   let inserted=0;
   for(const e of x.events){
    const r=await db.query(`INSERT INTO call_events(tenant_id,device_id,employee_id,sim_id,external_id,remote_phone_e164,direction,started_at,duration_seconds,evidence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'device_reported')
    ON CONFLICT(tenant_id,device_id,external_id) WHERE device_id IS NOT NULL AND external_id IS NOT NULL DO NOTHING RETURNING id`,[tenantId,deviceId,device.rows[0].employee_id,device.rows[0].sim_id,e.externalId,e.remotePhoneE164,e.direction,e.startedAt,e.durationSeconds]);
    inserted+=r.rowCount;
   }
   await db.query('UPDATE devices SET last_synced_at=now() WHERE id=$1',[deviceId]);
   return {received:x.events.length,inserted,duplicates:x.events.length-inserted,evidence:'device_reported'};
  });
 });
 app.post('/devices/:id/revoke',async(req)=>{
  await getActor(req);checkCsrf(req);can(req,'owner','admin');id.parse(req.params.id);
  return withTenant(req.actor.tenant_id,async db=>{
   const r=await db.query("UPDATE devices SET status='revoked',device_token_hash=NULL WHERE id=$1 RETURNING id",[req.params.id]);
   if(!r.rowCount)fail(404,'Device not found');
   await db.query('DELETE FROM device_directory WHERE tenant_id=$1 AND device_id=$2',[req.actor.tenant_id,req.params.id]);
   await audit(db,req.actor.tenant_id,req.actor.id,'device.revoked','devices',req.params.id);
   return {ok:true};
  });
 });
}
