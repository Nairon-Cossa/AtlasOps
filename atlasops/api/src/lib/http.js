import { ZodError } from 'zod';
export class HttpError extends Error { constructor(status,message) {super(message);this.status=status;} }
export const fail=(status,message)=>{throw new HttpError(status,message);};
export const pageParams=(query={})=>({ limit:Math.min(100,Math.max(1,Number.parseInt(query.limit||'30',10)||30)), offset:Math.min(100000,Math.max(0,Number.parseInt(query.offset||'0',10)||0)) });
export function errorHandler(error,request,reply) {
 if (error instanceof ZodError) return reply.code(400).send({error:'Invalid input',details:error.issues.map(x=>({path:x.path.join('.'),message:x.message}))});
 if (error.statusCode===429) return reply.code(429).send({error:'Too many requests'});
 if (error.code==='23505') return reply.code(409).send({error:'A conflicting record already exists'});
 if (error.code==='23503' || error.code==='23514' || error.code==='22P02') return reply.code(400).send({error:'Invalid reference or value'});
 if (error.status>=400 && error.status<500) return reply.code(error.status).send({error:error.message});
 request.log.error({err:error},'Request failed');
 return reply.code(500).send({error:'Internal server error'});
}
