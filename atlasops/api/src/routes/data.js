import {z} from 'zod';
import {withTenant,audit} from '../lib/db.js';
import {getActor,can,checkCsrf,employeeIdForActor} from '../lib/auth.js';
import {fail,pageParams} from '../lib/http.js';

const s=(max=200)=>z.string().trim().min(1).max(max);
const opt=(max=200)=>z.string().trim().max(max).nullable().optional();
const id=z.string().uuid();
const uid=id.nullable().optional();
const date=z.string().datetime({offset:true});
const money=z.number().finite().min(0).max(999999999999.99);
const statuses=(...x)=>z.enum(x);
const specs={
 employees:{ table:'employees', read:['owner','admin','manager','analyst','agent'],write:['owner','admin','manager'],schema:z.object({user_id:uid,full_name:s(150),job_title:opt(100),department:opt(100),status:statuses('active','inactive').optional()}),readScope:'employees',order:'created_at'},
 sims:{ table:'sim_cards',read:['owner','admin','manager','analyst'],write:['owner','admin'],schema:z.object({employee_id:uid,phone_e164:s(24),carrier:s(80),status:statuses('active','suspended','retired').optional(),monthly_bundle_mzn:money.optional()}),order:'created_at'},
 customers:{table:'customers',read:['owner','admin','manager','analyst','agent'],write:['owner','admin','manager','agent'],schema:z.object({name:s(200),email:opt(254),phone_e164:opt(24),industry:opt(100),notes:opt(3000)}),agentRead:false,order:'created_at'},
 leads:{table:'leads',read:['owner','admin','manager','analyst','agent'],write:['owner','admin','manager','agent'],schema:z.object({customer_id:uid,employee_id:uid,title:s(200),status:statuses('new','contacted','qualified','unqualified','converted').optional(),source:s(80).optional(),expected_value_mzn:money.nullable().optional(),next_followup_at:date.nullable().optional()}),readScope:'employee_id',order:'created_at'},
 deals:{table:'deals',read:['owner','admin','manager','analyst','agent'],write:['owner','admin','manager','agent'],schema:z.object({lead_id:uid,customer_id:uid,employee_id:uid,title:s(200),stage:statuses('prospecting','proposal','negotiation','won','lost').optional(),amount_mzn:money.optional(),closed_at:date.nullable().optional()}),readScope:'employee_id',order:'created_at'},
 tasks:{table:'tasks',read:['owner','admin','manager','analyst','agent'],write:['owner','admin','manager','agent'],schema:z.object({employee_id:uid,lead_id:uid,title:s(200),description:opt(5000),status:statuses('open','in_progress','done','cancelled').optional(),priority:statuses('low','medium','high','urgent').optional(),due_at:date.nullable().optional(),completed_at:date.nullable().optional()}),readScope:'employee_id',order:'created_at'},
 expenses:{table:'expenses',read:['owner','admin','manager','analyst'],write:['owner','admin','manager'],schema:z.object({employee_id:uid,category:s(100),description:opt(2000),amount_mzn:money,occurred_at:date,source:s(100).optional()}),order:'occurred_at',noDelete:true},
 revenue:{table:'revenue_events',read:['owner','admin','manager','analyst'],write:['owner','admin','manager'],schema:z.object({deal_id:uid,employee_id:uid,customer_id:uid,description:s(300),amount_mzn:money,status:statuses('pending','confirmed','reversed').optional(),occurred_at:date,source:s(100).optional()}),order:'occurred_at',noDelete:true},
};
const callCreate=z.object({employee_id:uid,sim_id:uid,customer_id:uid,lead_id:uid,remote_phone_e164:s(24),direction:statuses('outgoing','incoming','missed','rejected'),started_at:date,duration_seconds:z.number().int().min(0).max(86400),estimated_cost_mzn:money.nullable().optional(),outcome:statuses('unknown','no_answer','not_interested','interested','followup','meeting_booked').optional(),notes:opt(2000)}).strict();

function enforceAgentAssignment(req,employeeId,rowId){
 if(req.actor.role==='agent' && (!employeeId || rowId!==employeeId))fail(403,'Agents may only change their assigned work');
}
export async function dataRoutes(app){
 app.get('/data/:resource',async(req)=>{
  await getActor(req);const spec=specs[req.params.resource];if(!spec)fail(404,'Unknown resource');can(req,...spec.read);
  const {limit,offset}=pageParams(req.query);const {rows}=await withTenant(req.actor.tenant_id,async db=>{
   let sql=`SELECT * FROM ${spec.table}`,params=[];
   if(req.actor.role==='agent') {
    if(spec.readScope){const employee=await employeeIdForActor(db,req.actor);if(!employee)return {rows:[]};
     sql+=' WHERE '+(spec.readScope==='employees'?'id':'employee_id')+'=$1';params.push(employee);
    } else if (req.params.resource==='customers') {
     const employee=await employeeIdForActor(db,req.actor);if(!employee)return {rows:[]};
     sql+=' WHERE id IN (SELECT customer_id FROM leads WHERE employee_id=$1 AND customer_id IS NOT NULL)';params.push(employee);
    }
   }
   const r=await db.query(`${sql} ORDER BY ${spec.order} DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,limit,offset]);return r;
  });return {items:rows,pagination:{limit,offset}};
 });
 app.get('/data/:resource/:id',async(req)=>{
  await getActor(req);const spec=specs[req.params.resource];if(!spec)fail(404,'Unknown resource');can(req,...spec.read);id.parse(req.params.id);
  return withTenant(req.actor.tenant_id,async db=>{
   const r=await db.query(`SELECT * FROM ${spec.table} WHERE id=$1`,[req.params.id]);
   if(!r.rows[0])fail(404,'Not found');
   if(req.actor.role==='agent') {
    const employee=await employeeIdForActor(db,req.actor);const item=r.rows[0];
    if(spec.readScope && (spec.readScope==='employees'?item.id!==employee:item.employee_id!==employee))fail(404,'Not found');
    if(req.params.resource==='customers'){
     const linked=await db.query('SELECT 1 FROM leads WHERE employee_id=$1 AND customer_id=$2 LIMIT 1',[employee,item.id]);
     if(!linked.rowCount)fail(404,'Not found');
    }
   }
   return r.rows[0];
  });
 });
 app.post('/data/:resource',async(req,reply)=>{
  await getActor(req);checkCsrf(req);const spec=specs[req.params.resource];if(!spec)fail(404,'Unknown resource');can(req,...spec.write);
  const x=spec.schema.strict().parse(req.body);
  const item=await withTenant(req.actor.tenant_id,async db=>{
   if(req.actor.role==='agent'){
    if(['leads','deals','tasks'].includes(req.params.resource)) enforceAgentAssignment(req,await employeeIdForActor(db,req.actor),x.employee_id);
   }
   const keys=Object.keys(x),values=keys.map(k=>x[k]);
   const r=await db.query(`INSERT INTO ${spec.table} (tenant_id,${keys.join(',')}) VALUES ($1,${keys.map((_,i)=>'$'+(i+2)).join(',')}) RETURNING *`,[req.actor.tenant_id,...values]);
   await audit(db,req.actor.tenant_id,req.actor.id,'created',spec.table,r.rows[0].id);return r.rows[0];
  });return reply.code(201).send(item);
 });
 app.patch('/data/:resource/:id',async(req)=>{
  await getActor(req);checkCsrf(req);const spec=specs[req.params.resource];if(!spec)fail(404,'Unknown resource');can(req,...spec.write);id.parse(req.params.id);
  const x=spec.schema.partial().strict().refine(x=>Object.keys(x).length>0).parse(req.body);
  return withTenant(req.actor.tenant_id,async db=>{
   const previous=await db.query(`SELECT * FROM ${spec.table} WHERE id=$1 FOR UPDATE`,[req.params.id]);if(!previous.rowCount)fail(404,'Not found');
   if(req.actor.role==='agent'){
    if(spec.readScope)enforceAgentAssignment(req,await employeeIdForActor(db,req.actor),previous.rows[0].employee_id);
    if(x.employee_id && x.employee_id!==previous.rows[0].employee_id)fail(403,'Cannot reassign record');
    if(req.params.resource==='customers')fail(403,'Agents may not edit shared customer data');
    if(req.params.resource==='tasks'){
     if(Object.keys(x).length!==1 || !['open','in_progress','done'].includes(x.status))
      fail(403,'Agents may only update the status of their own tasks');
     if(previous.rows[0].status==='cancelled')
      fail(403,'Only a manager can reactivate a cancelled task');
    }
   }
   const keys=Object.keys(x),values=keys.map(k=>x[k]);
   const changes=keys.map((k,i)=>`${k}=$${i+1}`).join(',');
   const agentTaskStamp=req.actor.role==='agent'&&req.params.resource==='tasks'
    ? ",completed_at=CASE WHEN $1='done' THEN COALESCE(completed_at,now()) ELSE NULL END"
    : '';
   const updated=await db.query(`UPDATE ${spec.table} SET ${changes}${agentTaskStamp}${['employees','customers','leads','deals','tasks'].includes(req.params.resource)?',updated_at=now()':''} WHERE id=$${keys.length+1} RETURNING *`,[...values,req.params.id]);
   await audit(db,req.actor.tenant_id,req.actor.id,'updated',spec.table,req.params.id,{fields:keys});return updated.rows[0];
  });
 });
 app.delete('/data/:resource/:id',async(req)=>{
  await getActor(req);checkCsrf(req);const spec=specs[req.params.resource];if(!spec)fail(404,'Unknown resource');if(spec.noDelete)fail(405,'Financial records require reversal, not deletion');can(req,'owner','admin');id.parse(req.params.id);
  return withTenant(req.actor.tenant_id,async db=>{
   const r=await db.query(`DELETE FROM ${spec.table} WHERE id=$1 RETURNING id`,[req.params.id]);if(!r.rowCount)fail(404,'Not found');
   await audit(db,req.actor.tenant_id,req.actor.id,'deleted',spec.table,req.params.id);return {ok:true};
  });
 });
 app.get('/calls',async(req)=>{
  await getActor(req);const {limit,offset}=pageParams(req.query);
  return withTenant(req.actor.tenant_id,async db=>{
   let filter='',args=[];
   if(req.actor.role==='agent'){
    const e=await employeeIdForActor(db,req.actor);if(!e)return {items:[]};filter='WHERE c.employee_id=$1';args=[e];
   }
   const r=await db.query(`SELECT c.*,e.full_name AS employee_name,s.carrier,s.phone_e164 AS sim_number FROM call_events c LEFT JOIN employees e ON e.id=c.employee_id AND e.tenant_id=c.tenant_id LEFT JOIN sim_cards s ON s.id=c.sim_id AND s.tenant_id=c.tenant_id ${filter} ORDER BY c.started_at DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset]);
   return {items:r.rows,pagination:{limit,offset}};
  });
 });
 app.post('/calls',async(req,reply)=>{
  await getActor(req);checkCsrf(req);can(req,'owner','admin','manager','agent');const x=callCreate.parse(req.body);
  const item=await withTenant(req.actor.tenant_id,async db=>{
   if(req.actor.role==='agent')enforceAgentAssignment(req,await employeeIdForActor(db,req.actor),x.employee_id);
   const keys=Object.keys(x),values=Object.values(x);
   const r=await db.query(`INSERT INTO call_events (tenant_id,${keys.join(',')},evidence) VALUES($1,${keys.map((_,i)=>'$'+(i+2)).join(',')},'employee_reported') RETURNING *`,[req.actor.tenant_id,...values]);
   await audit(db,req.actor.tenant_id,req.actor.id,'call.reported','call_events',r.rows[0].id);return r.rows[0];
  });return reply.code(201).send(item);
 });
 app.patch('/calls/:id/outcome',async(req)=>{
  await getActor(req);checkCsrf(req);can(req,'owner','admin','manager','agent');id.parse(req.params.id);
  const x=z.object({outcome:statuses('unknown','no_answer','not_interested','interested','followup','meeting_booked'),notes:opt(2000),lead_id:uid,customer_id:uid}).strict().parse(req.body);
  return withTenant(req.actor.tenant_id,async db=>{
   const prev=await db.query('SELECT employee_id FROM call_events WHERE id=$1',[req.params.id]);if(!prev.rowCount)fail(404,'Not found');
   if(req.actor.role==='agent')enforceAgentAssignment(req,await employeeIdForActor(db,req.actor),prev.rows[0].employee_id);
   const r=await db.query('UPDATE call_events SET outcome=$1,notes=COALESCE($2,notes),lead_id=COALESCE($3,lead_id),customer_id=COALESCE($4,customer_id) WHERE id=$5 RETURNING *',[x.outcome,x.notes??null,x.lead_id??null,x.customer_id??null,req.params.id]);
   await audit(db,req.actor.tenant_id,req.actor.id,'call.outcome_updated','call_events',req.params.id,{outcome:x.outcome});return r.rows[0];
  });
 });
 app.get('/audit',async(req)=>{
  await getActor(req);can(req,'owner','admin');const {limit,offset}=pageParams(req.query);
  const r=await withTenant(req.actor.tenant_id,db=>db.query('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1 OFFSET $2',[limit,offset]));return {items:r.rows};
 });
}
