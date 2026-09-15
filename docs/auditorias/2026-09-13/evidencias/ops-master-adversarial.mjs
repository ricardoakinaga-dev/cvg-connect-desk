import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync('/home/ricardo/cvg-connect-desk/scripts/triple-aaa-verify.mjs','utf8');
const evidence=source.slice(source.indexOf('const localEvidence ='),source.indexOf('// Evidência externa'));
const stale={'artifacts/dr-e2e-report.json':{result:'PASS',commit:'WRONG-SHA'},'artifacts/staging-otel.json':{result:'PASS',commit:'WRONG-SHA'},'artifacts/query-performance.json':{queries:{},commit:'WRONG-SHA'}};
const context={gates:{},root:'',join:(_,rel)=>rel,existsSync:p=>p in stale,readFileSync:p=>JSON.stringify(stale[p]),console};vm.runInNewContext(evidence,context);console.log('STALE + EMPTY evidence',context.gates);
let verdict=source.slice(source.indexOf('const localPass ='),source.indexOf('const report ='));verdict=verdict.split(String.fromCharCode(10)).filter(l=>!l.startsWith('const commit =')&&!l.startsWith('const lockfileSha256 =')).join(String.fromCharCode(10));
vm.runInNewContext(verdict+";console.log('all local PASS + external FAIL:',final,'exit:',final==='FAILED'?1:0);",{gates:{unit:{status:'PASS'},'external-codeql':{status:'FAIL'}},withExternal:true,console});
