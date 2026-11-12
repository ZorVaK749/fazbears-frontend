// Ensayo NEGATIVO en réplicas nuevas: nunca altera los contenedores del ensayo positivo.
import { spawnSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { IMAGES } from './lab.mjs';
const here=dirname(fileURLToPath(import.meta.url));
function cmd(exe,args,options={}){const p=spawnSync(exe,args,{encoding:'utf8',timeout:120000,...options});if(p.status!==0)throw new Error('R2_NEGATIVE_COMMAND_FAILED');return p.stdout.trim();}
const d=args=>cmd('docker',['--context','desktop-linux',...args]);
const j=['/r2-jdk/bin/java','-Xmx96m','--add-modules','jdk.attach,jdk.httpserver','-cp','/r2-tools/classes:/r2-tools/h2.jar'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  assert.equal(process.platform,'win32');
  const ctx=JSON.parse(cmd('docker',['context','inspect','desktop-linux']))[0];assert.match(ctx.Endpoints.docker.Host,/^npipe:\/\/\/\/\.\/pipe\//);
  const previous=resolve(process.argv[2]),positive=JSON.parse(await readFile(previous,'utf8'));
  assert.equal(positive.passed,true);assert.equal(positive.awsExecution,false);assert.equal(positive.syntheticOnly,true);
  const volume=positive.jdkVolume;assert.match(volume,/^r2-[a-f0-9]{8}-jdk$/);
  const volumeInfo=JSON.parse(d(['volume','inspect',volume]))[0];assert.equal(volumeInfo.Labels['rescue.r2'],positive.runId);
  const root=await mkdtemp(join(resolve(here,'../artifacts'),'r2-negative-')),runId=randomUUID(),prefix='r2n-'+runId.slice(0,8);
  const input=join(root,'input'),classes=join(input,'classes');await mkdir(classes,{recursive:true});
  await writeFile(join(input,'h2.jar'),await readFile(join(dirname(previous),'input','h2.jar')));
  const files=['NativeAgent','ArtifactInspect','AttachClient','FixtureServer','Probe','RestoreNative','GuardProbe'].map(n=>join(here,n+'.java'));
  cmd('javac',['--release','21','-cp',join(input,'h2.jar'),'-d',classes,...files]);
  cmd('jar',['--create','--file',join(input,'agent.jar'),'--manifest',join(here,'agent.mf'),'-C',classes,'.']);
  const report={runId,syntheticOnly:true,awsExecution:false,positiveRunId:positive.runId,services:{},passed:false};
  try{
    // Guard del cliente: sin marker/env NO se intenta attach ni se leen procesos.
    const guarded=spawnSync('docker',['--context','desktop-linux','run','--rm','--network','none','--read-only',
      '--mount',`type=bind,source=${input},target=/r2-tools,readonly`,'--entrypoint','java',positive.helper,
      '--add-modules','jdk.attach','-cp','/r2-tools/classes','r2lab.AttachClient','check'],{encoding:'utf8',timeout:30000});
    assert.equal(guarded.status,1);assert.match(guarded.stderr,/R2_ATTACH_FAILED:SecurityException/);
    report.missingMarkerGuardRejected=true;
    const direct=d(['run','--rm','--network','none','--read-only',
      '--mount',`type=bind,source=${input},target=/r2-tools,readonly`,'--entrypoint','java',positive.helper,
      '-cp','/r2-tools/classes','r2lab.GuardProbe']);
    assert.match(direct,/R2_AGENT_GUARD_BEFORE_INSTRUMENTATION/);report.agentGuardBeforeInstrumentation=true;
    for(const [kind,spec] of Object.entries(IMAGES)){
      console.log('R2 NEGATIVE LOCAL: '+kind);
      const out=join(root,kind),name=prefix+'-'+kind;await mkdir(out);await writeFile(join(out,'lab.marker'),runId);
      const launch='/r2-jdk/bin/java -Xmx48m -cp /r2-tools/classes r2lab.FixtureServer & '+
        'for i in 1 2 3 4 5 6 7 8 9 10; do wget -q -O /dev/null http://127.0.0.1:17891/jwks && break; sleep 1; done; exec java -Xmx256m -jar /app/app.jar';
      d(['create','--name',name,'--label','rescue.r2='+runId,'--network','none','--read-only','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--memory','768m','--memory-swap','768m','--cpus','1','--pids-limit','128',
        '--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--mount',`type=volume,source=${volume},target=/r2-jdk,readonly`,
        '--mount',`type=bind,source=${input},target=/r2-tools,readonly`,'--mount',`type=bind,source=${out},target=/r2-out`,
        '-e','R2_SYNTHETIC_LAB_ONLY=SYNTHETIC_ONLY','-e','R2_RUN_ID='+runId,'-e','R2_KIND='+kind,
        '-e','SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI=http://127.0.0.1:17891/issuer',
        '-e','SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_CLIENT_ID=22222222-2222-4222-8222-222222222222',
        '-e','SPRING_JPA_SHOW_SQL=false','--entrypoint','/bin/sh',spec.ref,'-c',launch]);
      d(['start',name]);let ready=false;
      for(let i=0;i<30;i++){try{d(['exec',name,...j,'r2lab.Probe','ready']);ready=true;break;}catch{await sleep(1000);}}
      assert.ok(ready);d(['exec',name,...j,'r2lab.AttachClient','seed']);
      const before=JSON.parse(d(['inspect',name]))[0],seed=JSON.parse(await readFile(join(out,'seed.json'),'utf8'));
      const attach=spawn('docker',['--context','desktop-linux','exec',name,...j,'r2lab.AttachClient','race'],{stdio:['ignore','pipe','pipe']});
      attach.stdout.resume();attach.stderr.resume();const done=new Promise(r=>attach.on('close',r));
      let barrier=false;
      for(let i=0;i<100;i++){try{await stat(join(out,'race-ready'));barrier=true;break;}catch{await sleep(100);}}
      assert.ok(barrier);d(['exec',name,...j,'r2lab.Probe','write']);
      assert.equal(await done,1,'Debe rechazarse exportación tras cambio de datos');
      const race=JSON.parse(await readFile(join(out,'race.json'),'utf8'));
      assert.equal(race.sourceUnchanged,false);assert.notDeepEqual(race.before,race.after);
      assert.deepEqual(race.before,seed.before);
      d(['exec',name,...j,'r2lab.AttachClient','check']);d(['exec',name,...j,'r2lab.Probe']);
      const after=JSON.parse(d(['inspect',name]))[0],check=JSON.parse(await readFile(join(out,'check.json'),'utf8'));
      assert.equal(after.State.Running,true);assert.equal(after.RestartCount,0);assert.equal(after.State.Pid,before.State.Pid);
      assert.equal(after.State.StartedAt,before.State.StartedAt);assert.equal(check.jvmStartTime,seed.jvmStartTime);
      report.services[kind]={container:name,expectedRejection:true,sourceStillRunning:true,jvmStartTime:seed.jvmStartTime,
        startedAt:after.State.StartedAt,restarts:after.RestartCount,nativeFileQuarantined:true,
        before:race.before,after:race.after,controlledBarrierMs:4000};
    }
    report.passed=true;console.log('R2_EXPECTED_REJECTIONS_BOTH_PASSED');
  }finally{await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log('Evidencia negativa sintética: '+root);}
}
main().catch(()=>{console.error('R2_NEGATIVE_TEST_FAILED');process.exitCode=1;});
