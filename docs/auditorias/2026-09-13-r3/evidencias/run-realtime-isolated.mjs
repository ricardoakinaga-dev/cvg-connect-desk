import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const root='/home/ricardo/cvg-connect-desk', base='/tmp/cvg-audit-r3-dvlqz0my/aaa05';mkdirSync(base,{recursive:true});
Object.assign(process.env,{CVG_PROGRAM_DIR:base,CVG_RUNTIME_DIR:base+'/runtime',AAA_RUN_ID:'r3-aaa05',AAA_RUN_ROOT:base+'/run',AAA_WORKER_INDEX:'49',NODE_ENV:'test',DESK_ENV:'test'});
const {getRunContext}=await import(root+'/e2e/support/aaa/run-context.ts');
const {provisionIsolatedEnv,teardownIsolatedEnv}=await import(root+'/e2e/support/aaa/isolated-env.ts');
const ctx=getRunContext(49);Object.assign(process.env,{DATABASE_URL:ctx.databaseUrl,REDIS_URL:ctx.redisUrl,INTERNAL_EVENTS_SECRET:'r3-audit-synthetic-only'});
let result=1;const steps=[];
try{
 await provisionIsolatedEnv(ctx);
 for(const [label,args]of [['migrate',['--filter','@cvg/database','run','db:migrate']],['aaa05',['--filter','@cvg/realtime-service','exec','vitest','run','src/__tests__/aaa-05-isolation.test.ts']]]){
  const start=new Date().toISOString();const r=spawnSync('pnpm',args,{cwd:root,env:process.env,encoding:'utf8',maxBuffer:32*1024*1024});writeFileSync(base+'/'+label+'.log',(r.stdout??'')+(r.stderr??''));steps.push({label,command:['pnpm',...args],start,end:new Date().toISOString(),exit:r.status});console.log(label,r.status);result=r.status??1;if(result!==0)break;
 }
} finally {const teardown=teardownIsolatedEnv(ctx,{stopServices:true,dropDatabase:true});writeFileSync(base+'/results.json',JSON.stringify({steps,teardown},null,2));}
process.exitCode=result;
