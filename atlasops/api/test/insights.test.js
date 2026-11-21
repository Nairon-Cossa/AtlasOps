import test from 'node:test';import assert from 'node:assert/strict';
import {buildInsights} from '../src/lib/insights.js';
import {digest,safeEqual,maskPhone} from '../src/lib/crypto.js';
test('zero calls is not invented activity',()=>{ const r=buildInsights({calls:0});assert.match(r.findings[0].title,/No call activity/); });
test('low connection and expense flags',()=>{ const r=buildInsights({calls:30,answered:4,qualified_leads:0,revenue:100,expenses:300});assert.equal(r.connection_rate_percent,13);assert.equal(r.findings.filter(x=>x.severity==='warning').length,3); });
test('does not call gross contribution net profit',()=>{const r=buildInsights({calls:20,answered:12,revenue:1000,expenses:200});assert.ok(r.findings.some(x=>x.basis?.contribution_mzn===800));});
test('cryptographic comparisons and masking',()=>{assert.equal(digest('abc').length,64);assert.equal(safeEqual('a','a'),true);assert.equal(safeEqual('a','b'),false);assert.ok(!maskPhone('+258841234567').includes('1234'));});
