from pathlib import Path
import subprocess,os,json,datetime
root=Path('/home/ricardo/cvg-connect-desk');b=Path('/tmp/cvg-audit-r3-dvlqz0my');results=[]
for n in ['05','18']:
 run='r3-audit-'+n;folder=b/('integration-'+n);folder.mkdir(exist_ok=True)
 env=os.environ.copy();env.update(CVG_PROGRAM_DIR=str(folder),CVG_RUNTIME_DIR=str(folder/'runtime'),AAA_RUN_ID=run,AAA_RUN_ROOT=str(folder/'run'),AAA_WORKER_INDEX='48',NODE_ENV='test',DESK_ENV='test',DATABASE_URL=f'postgresql://cvg_aaa@127.0.0.1:61232/cvg_aaa_r3_audit_{n}_w48',REDIS_URL='redis://127.0.0.1:57160')
 cmd=['pnpm','--filter','@cvg/desk-api','exec','vitest','run',f'src/__tests__/production/prod-{n}.test.ts'];start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (folder/'output.log').open('w') as log:result=subprocess.run(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
 entry=dict(task='PROD-'+n,command=cmd,start=start,end=datetime.datetime.now(datetime.timezone.utc).isoformat(),exit=result.returncode,log=str(folder/'output.log'));results.append(entry);print(json.dumps(entry),flush=True);(b/'integration-results.json').write_text(json.dumps(results,indent=2))
