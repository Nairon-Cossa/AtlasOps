import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {fail} from './http.js';
function key(){
 const raw=process.env.TRANSCRIPT_ENCRYPTION_KEY_BASE64;
 if(!raw)fail(503,'Transcript encryption is not configured');
 const k=Buffer.from(raw,'base64');
 if(k.length!==32)fail(503,'Transcript encryption key must be 32 bytes');
 return k;
}
export function encrypt(plaintext){
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);
 const encrypted=Buffer.concat([c.update(plaintext,'utf8'),c.final()]);
 return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64');
}
export function decrypt(payload){
 const bytes=Buffer.from(payload,'base64');
 if(bytes.length<29)throw new Error('Invalid encrypted transcript');
 const d=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
 d.setAuthTag(bytes.subarray(12,28));
 return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8');
}
