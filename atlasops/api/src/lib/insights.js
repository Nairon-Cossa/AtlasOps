// Explainable, deterministic decision support. No false claims of a trained AI model.
export function buildInsights(metrics){
 const calls=Number(metrics.calls||0),answered=Number(metrics.answered||0), leads=Number(metrics.qualified_leads||0),revenue=Number(metrics.revenue||0),cost=Number(metrics.expenses||0);
 const rate=calls?Math.round(answered/calls*100):0;
 const findings=[];
 if(!calls)findings.push({severity:'info',title:'No call activity in the selected period',recommendation:'Connect corporate SIM records or enter authorized call activity before evaluating performance.',basis:{calls}});
 if(calls>=15&&rate<35)findings.push({severity:'warning',title:'Low connection rate',recommendation:'Review call times, list quality and unreachable numbers.',basis:{calls,answered,connection_rate_percent:rate}});
 if(calls>=15&&leads===0)findings.push({severity:'warning',title:'No qualified leads recorded',recommendation:'Review lead qualification practices and check that outcomes are being entered.',basis:{calls,qualified_leads:leads}});
 if(cost>revenue&&cost>0)findings.push({severity:'warning',title:'Recorded expenses exceed confirmed revenue',recommendation:'Review high-cost categories, data completeness and revenue collection.',basis:{expenses_mzn:cost,revenue_mzn:revenue}});
 if(revenue>0&&cost>=0)findings.push({severity:'info',title:'Recorded contribution after tracked expenses',recommendation:'Compare with payroll, taxes and other expenses before treating this as profit.',basis:{revenue_mzn:revenue,tracked_expenses_mzn:cost,contribution_mzn:revenue-cost}});
 if(!findings.length)findings.push({severity:'info',title:'No rule-based alerts triggered',recommendation:'Continue tracking business outcomes and review results by employee and customer.',basis:{calls,answered,qualified_leads:leads}});
 return {engine:'explainable-rules-v1',connection_rate_percent:rate,findings};
}
