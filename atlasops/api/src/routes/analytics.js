import {z} from 'zod';
import {withTenant} from '../lib/db.js';
import {getActor,employeeIdForActor} from '../lib/auth.js';
import {buildInsights} from '../lib/insights.js';

export async function analyticsRoutes(app){
 app.get('/analytics/overview',async(req)=>{
  await getActor(req);
  const days=z.coerce.number().int().min(1).max(365).default(30).parse(req.query.days??30);
  return withTenant(req.actor.tenant_id,async db=>{
   const since=new Date(Date.now()-days*86400000).toISOString();
   let employeeId=null;
   if(req.actor.role==='agent')employeeId=await employeeIdForActor(db,req.actor)||'00000000-0000-0000-0000-000000000001';
   const [c,l,d,t,e,r,staff,byDay]=await Promise.all([
    db.query(`SELECT count(*)::int AS calls, count(*) FILTER (WHERE duration_seconds>0 AND direction IN ('outgoing','incoming'))::int AS answered,coalesce(sum(duration_seconds),0)::bigint AS seconds,coalesce(sum(actual_cost_mzn),0) AS known_call_cost_mzn,coalesce(sum(estimated_cost_mzn) FILTER(WHERE actual_cost_mzn IS NULL),0) AS estimated_call_cost_mzn, count(*) FILTER(WHERE evidence='carrier_api')::int AS carrier_verified_count,count(*) FILTER(WHERE evidence='carrier_statement')::int AS statement_count FROM call_events WHERE started_at>=$1 AND ($2::uuid IS NULL OR employee_id=$2)`,[since,employeeId]),
    db.query('SELECT count(*)::int AS qualified_leads FROM leads WHERE status IN (\'qualified\',\'converted\') AND created_at>=$1 AND ($2::uuid IS NULL OR employee_id=$2)',[since,employeeId]),
    db.query('SELECT count(*)::int AS won_deals,coalesce(sum(amount_mzn),0) AS won_deal_value_mzn FROM deals WHERE stage=\'won\' AND created_at>=$1 AND ($2::uuid IS NULL OR employee_id=$2)',[since,employeeId]),
    db.query('SELECT count(*)::int AS open_tasks FROM tasks WHERE status IN (\'open\',\'in_progress\') AND ($1::uuid IS NULL OR employee_id=$1)',[employeeId]),
    req.actor.role==='agent'?Promise.resolve({rows:[{expenses:0}]}):db.query('SELECT coalesce(sum(amount_mzn),0) AS expenses FROM expenses WHERE occurred_at>=$1',[since]),
    req.actor.role==='agent'?Promise.resolve({rows:[{revenue:0}]}):db.query("SELECT coalesce(sum(amount_mzn),0) AS revenue FROM revenue_events WHERE status='confirmed' AND occurred_at>=$1",[since]),
    db.query('SELECT count(*)::int AS active_employees FROM employees WHERE status=\'active\''+(employeeId?' AND id=$1':''),employeeId?[employeeId]:[]),
    db.query("SELECT to_char(date_trunc('day',started_at AT TIME ZONE 'Africa/Maputo'),'YYYY-MM-DD') AS day,count(*)::int AS calls FROM call_events WHERE started_at>=$1 AND ($2::uuid IS NULL OR employee_id=$2) GROUP BY 1 ORDER BY 1",[since,employeeId])
   ]);
   const metrics={...c.rows[0],...l.rows[0],...d.rows[0],...t.rows[0],...e.rows[0],...r.rows[0],...staff.rows[0]};
   return {period_days:days,metrics,daily_calls:byDay.rows,insights:buildInsights(metrics)};
  });
 });
 app.get('/analytics/employee-performance',async(req)=>{
  await getActor(req);
  const r=await withTenant(req.actor.tenant_id,async db=>{
   const employeeId=req.actor.role==='agent'?(await employeeIdForActor(db,req.actor)||'00000000-0000-0000-0000-000000000001'):null;
   return db.query(`SELECT e.id,e.full_name,e.department,
    COALESCE(c.calls,0)::int AS calls,
    COALESCE(c.call_seconds,0)::bigint AS call_seconds,
    COALESCE(l.qualified_leads,0)::int AS qualified_leads,
    COALESCE(d.won_deals,0)::int AS won_deals
    FROM employees e
    LEFT JOIN LATERAL (
      SELECT count(*) AS calls,coalesce(sum(duration_seconds),0) AS call_seconds
      FROM call_events c WHERE c.tenant_id=e.tenant_id AND c.employee_id=e.id AND c.started_at>=now()-interval '30 days'
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS qualified_leads FROM leads l
      WHERE l.tenant_id=e.tenant_id AND l.employee_id=e.id AND l.status IN ('qualified','converted') AND l.created_at>=now()-interval '30 days'
    ) l ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS won_deals FROM deals d
      WHERE d.tenant_id=e.tenant_id AND d.employee_id=e.id AND d.stage='won' AND d.created_at>=now()-interval '30 days'
    ) d ON TRUE
    WHERE ($1::uuid IS NULL OR e.id=$1)
    ORDER BY calls DESC LIMIT 100`,[employeeId]);
  });
  return {items:r.rows,period_days:30};
 });
}
