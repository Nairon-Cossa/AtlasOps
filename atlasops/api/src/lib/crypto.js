import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export function token() { return randomBytes(32).toString('base64url'); }
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function safeEqual(a,b) { if (!a || !b) return false; const x=Buffer.from(a),y=Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); }
export function normalizedPhone(v) { return String(v ?? '').replace(/[\s().-]/g,''); }
export function maskPhone(v) { const p=String(v??''); return p.length>5 ? `${p.slice(0,4)}••••${p.slice(-3)}`: '••••'; }
