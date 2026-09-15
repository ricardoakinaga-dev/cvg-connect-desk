const fs = require('fs');
const ts = require('/home/ricardo/cvg-connect-desk/node_modules/typescript');
const vm = require('vm');
const source = fs.readFileSync('/home/ricardo/cvg-connect-desk/modules/chat/src/application/use-cases/inbound-media-pipeline.ts','utf8');
const extracted = source.slice(source.indexOf('async function withMessageLock'), source.indexOf('\nfunction terminalState'));
const javascript = ts.transpile(extracted, {target: ts.ScriptTarget.ES2022});
async function probe(concurrency) {
  const max=10; let active=0, completed=0; const waiting=[];
  const makeClient=()=>({query:async()=>({rows:[]}),release:()=>{active--; if(waiting.length)waiting.shift()();}});
  const pool={connect:()=>new Promise(resolve=>{const acquire=()=>{active++;resolve(makeClient());};if(active<max)acquire();else waiting.push(acquire);})};
  const context=vm.createContext({getPool:()=>pool});
  vm.runInContext(javascript,context);
  for(let i=0;i<concurrency;i++)void context.withMessageLock('message-'+i,async()=>{const queryClient=await pool.connect();queryClient.release();completed++;});
  await new Promise(resolve=>setTimeout(resolve,50));
  return {concurrency,max,completed,active,waiting:waiting.length};
}
(async()=>{const result={evidence:'actual function extracted/transpiled; pool simulated, no DB/network; timeout behavior not modeled',cases:[await probe(1),await probe(10),await probe(50)]};console.log(JSON.stringify(result,null,2));})();
