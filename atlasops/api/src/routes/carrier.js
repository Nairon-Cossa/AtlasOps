import {z} from 'zod';
import {getActor,can,checkCsrf} from '../lib/auth.js';
import {withTenant,audit} from '../lib/db.js';
import {fail} from '../lib/http.js';
const id=z.string().uuid();
const row=z.object({
 simId:id,externalReference:z.string().trim().min(1).max(150),remotePhoneE164:z.string().min(1).max(24),
 direction:z.enum(['outgoing','incoming','missed','rejected']),startedAt:z.string().datetime({offset:true}),
 durationSeconds:z.number().int().min(0).max(86400),actualCostMzn:z.number().finite().min(0).max(9999999999)
}).strict();
export async function carrierRoutes(app){
 app.post('/carrier/statement-import',async(req,reply)=>{
  await getActor(req);checkCsrf(req);can(req,'owner','admin');
  const x=z.object({carrier:z.string().min(2).max(80),filename:z.string().max(200).optional(),rows:z.array(row).min(1).max(500)}).strict().parse(req.body);
  return withTenant(req.actor.tenant_id,async db=>{
   let inserted=0,updated=0,skipped=0;
   const seen=new Set();
   for(const line of x.rows){
    const dedupeKey=`${line.simId}:${line.externalReference}`;
    if(seen.has(dedupeKey)){skipped++;continue;}seen.add(dedupeKey);
    const sim=await db.query('SELECT id,employee_id,carrier FROM sim_cards WHERE id=$1',[line.simId]);
    if(!sim.rowCount || sim.rows[0].carrier.toLowerCase()!==x.carrier.toLowerCase())fail(400,'SIM not found or wrong carrier');
    const existing=await db.query('SELECT id FROM call_events WHERE sim_id=$1 AND carrier_reference=$2',[line.simId,line.externalReference]);
    if(existing.rowCount){skipped++;continue;}
    // Reconcile only when there is EXACTLY one candidate. Ambiguous matches are never auto-linked.
    const match=await db.query(`SELECT id FROM call_events WHERE sim_id=$1 AND remote_phone_e164=$2 AND direction=$3
      AND abs(extract(epoch FROM (started_at-$4::timestamptz)))<=90
      AND abs(duration_seconds-$5)<=2 AND carrier_reference IS NULL LIMIT 2`,[line.simId,line.remotePhoneE164,line.direction,line.startedAt,line.durationSeconds]);
    if(match.rowCount===1){
     await db.query(`UPDATE call_events SET evidence='carrier_statement',actual_cost_mzn=$1,carrier_reference=$2 WHERE id=$3`,[line.actualCostMzn,line.externalReference,match.rows[0].id]);updated++;
    } else {
     await db.query(`INSERT INTO call_events(tenant_id,employee_id,sim_id,remote_phone_e164,direction,started_at,duration_seconds,actual_cost_mzn,evidence,carrier_reference)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'carrier_statement',$9)`,[req.actor.tenant_id,sim.rows[0].employee_id,line.simId,line.remotePhoneE164,line.direction,line.startedAt,line.durationSeconds,line.actualCostMzn,line.externalReference]);inserted++;
    }
   }
   const r=await db.query('INSERT INTO carrier_imports(tenant_id,carrier,filename,imported_by,rows_received,rows_inserted,rows_updated) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at',[req.actor.tenant_id,x.carrier,x.filename??null,req.actor.id,x.rows.length,inserted,updated]);
   await audit(db,req.actor.tenant_id,req.actor.id,'carrier.statement_imported','carrier_imports',r.rows[0].id,{received:x.rows.length,inserted,updated,skipped});
   return reply.code(201).send({importId:r.rows[0].id,inserted,updated,skipped,evidence:'carrier_statement',note:'Imported records are NOT independently verified with the carrier.'});
  });
 });
 app.get('/carrier/imports',async req=>{
  await getActor(req);can(req,'owner','admin','manager','analyst');
  const r=await withTenant(req.actor.tenant_id,db=>db.query('SELECT * FROM carrier_imports ORDER BY created_at DESC LIMIT 50'));
  return {items:r.rows};
 });
}
