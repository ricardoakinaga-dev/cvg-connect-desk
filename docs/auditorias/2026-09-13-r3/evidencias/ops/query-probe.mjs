import {mkdirSync,writeFileSync} from 'node:fs';
import {DEFAULT_CHECKS,evaluateCheck} from '/home/ricardo/cvg-connect-desk/scripts/production/evidence-gate.mjs';
const base='/tmp/cvg-audit-r3-dvlqz0my/ops';
const check=DEFAULT_CHECKS.find(c=>c.id==='query-performance');
const candidate={commit:'a'.repeat(40),lockfileSha256:'b'.repeat(64),sourceSha256:'c'.repeat(64),sealedAt:new Date(Date.now()-10000).toISOString()};
for(const scenario of ['empty','valid-cost-fixture','null-measurements','over-budget','future-measurements','missing-run-metadata']){
 const evidenceDir=`${base}/probe-${scenario}`;mkdirSync(`${evidenceDir}/artifacts`,{recursive:true});
 const payload={...candidate,runId:'audit-r3',attempt:'1',generatedAt:new Date().toISOString(),result:'PASS',profile:{name:'synthetic',dataset:'synthetic'},budget:{maxTotalCost:100,maxPlanRows:1000},queries:check.evidence.expectedEntries.map(name=>({name,totalCost:10,planRows:10,measuredAt:new Date().toISOString(),acceptable:true,withinBudget:true}))};
 if(scenario==='empty')payload.queries=[{}];
 if(scenario==='null-measurements')for(const q of payload.queries){q.totalCost=null;q.planRows=null;}
 if(scenario==='over-budget')for(const q of payload.queries){q.totalCost=999999;q.planRows=999999;}
 if(scenario==='future-measurements')for(const q of payload.queries)q.measuredAt='2099-01-01T00:00:00Z';
 if(scenario==='missing-run-metadata'){delete payload.runId;delete payload.attempt;}
 writeFileSync(`${evidenceDir}/artifacts/query-performance.json`,JSON.stringify(payload,null,2));
 const result=evaluateCheck(check,{evidenceDir,candidate,withExternal:true});
 console.log(JSON.stringify({scenario,status:result.status,reasons:result.reasons}));
}
