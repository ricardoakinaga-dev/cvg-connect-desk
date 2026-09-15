const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = '/home/ricardo/cvg-connect-desk';
const ts = require(root + '/node_modules/typescript');
const hashes = {};
function load(file, mocks) {
 const source = fs.readFileSync(root + '/' + file,'utf8');
 hashes[file] = crypto.createHash('sha256').update(source).digest('hex');
 const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports = {};
 const context={exports,require:(name)=>{if(name in mocks)return mocks[name];throw Error('Unmocked import '+name)},process:{env:{}},Date,Map,console};
 vm.runInNewContext(js,context,{filename:file}); return exports;
}
const drizzle = new Proxy({}, {get:(_,key)=>(...args)=>({key,args})});
(async()=>{
 const replay = load('packages/shared/src/webhook-anti-replay.ts', {'@cvg/database':{},'drizzle-orm':drizzle});
 const s = new replay.InMemoryWebhookReplayStore();
 const first = await s.claim('synthetic-event','signature-t1','same-payload');
 await s.fail('synthetic-event');
 const retryNewTimestamp = await s.claim('synthetic-event','signature-t2','same-payload');
 const retrySameTimestamp = await s.claim('synthetic-event','signature-t1','same-payload');
 const now = new Date();
 const row={id:'synthetic-invocation',invocationKey:'inbound:synthetic',conversationId:'synthetic-conversation',status:'unknown',attemptCount:1,createdAt:now,updatedAt:now};
 const writes=[];
 const tx={execute:async()=>{},insert:()=>({values:()=>({onConflictDoNothing:()=>({returning:async()=>[]})})}),select:()=>({from:()=>({where:()=>({for:async()=>[row]})})}),update:()=>({set:(value)=>{writes.push(value);return {where:()=>({returning:async()=>[{...row,...value}]})}}})};
 const sec = load('modules/secretary-adapter/src/infrastructure/repositories/secretary-invocation.repository.ts', {'@cvg/database':{db:{transaction:fn=>fn(tx)},schema:{secretaryInvocations:{}}},'drizzle-orm':drizzle,'../../application/ai-policy':{AIBudgetExhaustedError:class extends Error{}}});
 const resumed=await sec.beginSecretaryInvocation({invocationKey:row.invocationKey,conversationId:row.conversationId,messageId:'synthetic',eventId:'synthetic-event',consumerId:'worker',maxInvocations:1});
 const result={mode:'CURRENT source transpiled, mocked datastore; no DB/network',hashes,webhook:{first,retryNewTimestamp,retrySameTimestamp},secretary:{originalStatus:row.status,resultStatus:resumed.record.status,alreadyCompleted:resumed.alreadyCompleted,writes}};
 fs.writeFileSync('/tmp/cvg-audit-deliveries-ufq9_ejh/backend/probe-results.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
