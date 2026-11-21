import pg from 'pg';
const { Pool } = pg;
export const pool = new Pool({ connectionString:process.env.DATABASE_URL, max:12, idleTimeoutMillis:30000, connectionTimeoutMillis:5000, ssl: process.env.DB_SSL==='true' ? {rejectUnauthorized:true}:undefined });
export async function query(sql,params=[]) { return pool.query(sql,params); }
export async function withTenant(tenantId,fn) {
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
  const result=await fn(client);
  await client.query('COMMIT');
  return result;
 } catch(e) { await client.query('ROLLBACK'); throw e; }
 finally { client.release(); }
}
export async function audit(db,tenantId,actorId,action,entity,entityId=null,detail={}) {
 await db.query('INSERT INTO audit_events (tenant_id,actor_id,action,entity,entity_id,detail) VALUES($1,$2,$3,$4,$5,$6)',[tenantId,actorId,action,entity,entityId,JSON.stringify(detail)]);
}
