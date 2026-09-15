from pathlib import Path
import subprocess,os,json,datetime
base=Path('/tmp/cvg-audit-deliveries-ufq9_ejh');results=[]
for n in ['10','13','16','18']:
 run='delivery-audit-'+n;folder=base/('integration-'+n);folder.mkdir(exist_ok=True)
 env=os.environ.copy()
 for k in list(env):
  if any(x in k for x in ['DATABASE_URL','REDIS_URL','SECRETARY_URL','GATEWAY_URL','S3_SECRET','S3_ACCESS']):env.pop(k,None)
 env.update(CVG_PROGRAM_DIR=str(folder),CVG_RUNTIME_DIR=str(folder/'runtime'),AAA_RUN_ID=run,AAA_RUN_ROOT=str(folder/'run'),AAA_WORKER_INDEX='47',NODE_ENV='test',DESK_ENV='test')
 cmd=['pnpm','--filter','@cvg/desk-api','exec','vitest','run',f'src/__tests__/production/prod-{n}.test.ts']
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (folder/'output.log').open('w') as log:
  result=subprocess.run(cmd,cwd='/home/ricardo/cvg-connect-desk',env=env,stdout=log,stderr=subprocess.STDOUT)
 entry=dict(task='PROD-'+n,command=cmd,start=start,end=datetime.datetime.now(datetime.timezone.utc).isoformat(),exit=result.returncode,log=str(folder/'output.log'));results.append(entry);print(json.dumps(entry),flush=True)
 (base/'integration-results.json').write_text(json.dumps(results,indent=2))
