// R2: orquestador EXCLUSIVO Docker Desktop Windows local, nunca AWS/SSM/daemon remoto.
import { spawnSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here=dirname(fileURLToPath(import.meta.url)), artifacts=resolve(here,'../artifacts');
const context='desktop-linux';
const helper='eclipse-temurin@sha256:82801f9dcdcbad5a05082aba8c86d1da5b72ccb498e71318b1f91b5a477887b3';
export const IMAGES={
  carrito:{ref:'ghcr.io/zorvak749/fazbear-carrito@sha256:99274a38c2cb1cf0529b51b8fbfdb06653a12338afbf5c5967e5d6b8cea98d6d',config:'sha256:c09d17290bcc75af510f6ca5d036c23b62add0a35cd3c495a2ceb27a868cd277'},
  pedidos:{ref:'ghcr.io/zorvak749/fazbears-pedidos@sha256:c6a51819a39b8766f05bbbe26e14acc8eb442cf6761f57e38f3f9427b46ab6cc',config:'sha256:e8d04e02bf3b1b212884ed454cbf38b2e5a77971f23d9d9b1db76e06f681cd64'},
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function command(exe,args,options={}){
  const result=spawnSync(exe,args,{encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024,...options});
  if(result.status!==0){const e=new Error('R2_COMMAND_FAILED');e.detail={exe,operation:args[0],status:result.status};throw e;}
  return result.stdout.trim();
}
const docker=(args,options)=>command('docker',['--context',context,...args],options);
const inspect=ref=>JSON.parse(docker(['inspect',ref]))[0];
const exec=(name,args)=>docker(['exec',name,...args]);
const javaArgs=['/r2-jdk/bin/java','-Xmx96m','--add-modules','jdk.attach,jdk.httpserver','-cp','/r2-tools/classes:/r2-tools/h2.jar'];
function proof(container){const x=inspect(container);return{startedAt:x.State.StartedAt,pid:x.State.Pid,restarts:x.RestartCount,
  running:x.State.Running,network:x.HostConfig.NetworkMode,ports:x.HostConfig.PortBindings??{},readonly:x.HostConfig.ReadonlyRootfs,
  memory:x.HostConfig.Memory,pidsLimit:x.HostConfig.PidsLimit};}
async function run(){
  assert.equal(process.platform,'win32','R2 solo Docker Desktop local; no ejecutar en CloudShell');
  const ctx=JSON.parse(command('docker',['context','inspect',context]))[0];
  assert.match(ctx.Endpoints.docker.Host,/^npipe:\/\/\/\/\.\/pipe\//);
  const version=JSON.parse(docker(['version','--format','{{json .}}']));assert.equal(version.Server.Os,'linux');
  await mkdir(artifacts,{recursive:true});const root=await mkdtemp(join(artifacts,'r2-run-'));
  const runId=randomUUID(),prefix='r2-'+runId.slice(0,8),input=join(root,'input'),classes=join(input,'classes');
  await mkdir(classes,{recursive:true});
  const report={runId,syntheticOnly:true,awsExecution:false,dockerVersion:version.Server.Version,helper,services:{},passed:false};
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));
  try{
    // Compilar herramientas independientes de Spring/H2 primero.
    command('javac',['--release','21','-d',classes,join(here,'NativeAgent.java'),join(here,'ArtifactInspect.java')]);
    docker(['pull',helper]);
    const volume=prefix+'-jdk';docker(['volume','create','--label','rescue.r2='+runId,volume]);
    docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL',
      '--mount',`type=volume,source=${volume},target=/dst`,'--entrypoint','sh',helper,'-c','cp -a /opt/java/openjdk/. /dst/']);
    report.jdkVolume=volume;
    for(const [kind,spec] of Object.entries(IMAGES)){
      console.log('R2 LOCAL: '+kind);
      docker(['pull',spec.ref]);
      const index=JSON.parse(docker(['buildx','imagetools','inspect','--raw',spec.ref]));
      const descriptor=index.manifests.find(m=>m.platform?.os==='linux'&&m.platform?.architecture==='amd64');assert.ok(descriptor);
      const repo=spec.ref.split('@')[0],manifest=JSON.parse(docker(['buildx','imagetools','inspect','--raw',repo+'@'+descriptor.digest]));
      assert.equal(manifest.config.digest,spec.config);
      const image=inspect(spec.ref);assert.equal(image.Architecture,'amd64');assert.equal(image.Os,'linux');
      const out=join(root,kind);await mkdir(out);await writeFile(join(out,'lab.marker'),runId);
      const source=prefix+'-'+kind;
      const launch='/r2-jdk/bin/java -Xmx48m -cp /r2-tools/classes r2lab.FixtureServer & '+
        'for i in 1 2 3 4 5 6 7 8 9 10; do wget -q -O /dev/null http://127.0.0.1:17891/jwks && break; sleep 1; done; '+
        'exec java -Xmx256m -jar /app/app.jar';
      docker(['create','--name',source,'--label','rescue.r2='+runId,'--network','none','--read-only',
        '--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--memory-swap','768m','--cpus','1','--pids-limit','128',
        '--tmpfs','/tmp:rw,nosuid,nodev,size=64m',
        '--mount',`type=volume,source=${volume},target=/r2-jdk,readonly`,
        '--mount',`type=bind,source=${input},target=/r2-tools,readonly`,
        '--mount',`type=bind,source=${out},target=/r2-out`,
        '-e','R2_SYNTHETIC_LAB_ONLY=SYNTHETIC_ONLY','-e','R2_RUN_ID='+runId,'-e','R2_KIND='+kind,
        '-e','SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI=http://127.0.0.1:17891/issuer',
        '-e','SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_CLIENT_ID=22222222-2222-4222-8222-222222222222',
        '-e','SPRING_JPA_SHOW_SQL=false','--entrypoint','/bin/sh',spec.ref,'-c',launch]);
      const jar=join(out,'application.jar');docker(['cp',source+':/app/app.jar',jar]);
      // Un h2.jar idéntico por imagen: no asumir correspondencia con repositorio local.
      const h2=join(input,'h2.jar');
      // Cada input por corrida comparte driver solo si ambas imágenes tienen el mismo hash.
      const extracted=join(out,'h2.jar');
      const artifact=JSON.parse(command('java',['-cp',classes,'r2lab.ArtifactInspect',jar,extracted]));
      if(kind==='carrito'){
        await writeFile(h2,await readFile(extracted));
        const files=['NativeAgent','ArtifactInspect','AttachClient','FixtureServer','Probe','RestoreNative','GuardProbe'].map(n=>join(here,n+'.java'));
        command('javac',['--release','21','-cp',h2,'-d',classes,...files]);
        command('jar',['--create','--file',join(input,'agent.jar'),'--manifest',join(here,'agent.mf'),'-C',classes,'.']);
      }else assert.equal(hash(await readFile(h2)),artifact.h2JarSha256);
      report.services[kind]={container:source,indexDigest:spec.ref.split('@')[1],platformDigest:descriptor.digest,
        configDigest:manifest.config.digest,localInspectId:image.Id,created:image.Created,architecture:'linux/amd64',artifact};
      docker(['start',source]);
      let ready=false;
      for(let attempt=0;attempt<30;attempt++){
        try{exec(source,[...javaArgs,'r2lab.Probe','ready']);ready=true;break;}catch{await sleep(1000);}
      }
      assert.ok(ready,'R2_REPLICA_NOT_READY');
      exec(source,[...javaArgs,'r2lab.AttachClient','seed']);
      exec(source,[...javaArgs,'r2lab.Probe']);
      const before=proof(source),seed=JSON.parse(await readFile(join(out,'seed.json'),'utf8'));
      report.services[kind].before=before;report.services[kind].seed=seed;
      // Un observador de HTTP autenticado permanece activo durante ambos dumps.
      const watch=spawn('docker',['--context',context,'exec',source,...javaArgs,'r2lab.Probe','watch'],{stdio:['ignore','pipe','pipe']});
      let observations='';watch.stdout.on('data',b=>observations+=b.toString());
      let watchError='';watch.stderr.on('data',b=>watchError+=b.toString());
      const finished=new Promise(resolveWatch=>watch.on('close',code=>resolveWatch(code)));
      for(let i=0;i<100&&!observations.includes('\n');i++)await sleep(100);
      assert.ok(observations.includes(':200:'),'R2_HTTP_WATCH_NOT_READY');
      for(const n of [1,2]){
        exec(source,[...javaArgs,'r2lab.AttachClient','export'+n]);
        const dump=await readFile(join(out,`export${n}.sql`)),meta=JSON.parse(await readFile(join(out,`export${n}.json`),'utf8'));
        assert.equal(hash(dump),meta.scriptSha256);assert.equal(meta.sourceUnchanged,true);
        assert.deepEqual(meta.before,seed.before);
        assert.match(dump.toString('utf8'),/CREATE.*TABLE/);assert.match(dump.toString('utf8'),/INSERT INTO/);
        exec(source,[...javaArgs,'r2lab.RestoreNative',String(n)]);
        const restored=JSON.parse(await readFile(join(out,`restored-${n}.json`),'utf8'));
        assert.deepEqual(restored,meta.before);
        exec(source,[...javaArgs,'r2lab.RestoreNative','verify'+n]);
        assert.deepEqual(JSON.parse(await readFile(join(out,`reopened-${n}.json`),'utf8')),meta.before);
      }
      assert.equal(await finished,0,watchError);
      const samples=observations.trim().split(/\r?\n/).map(s=>{const [time,status,latencyMs]=s.split(':');return{time:Number(time),status:Number(status),latencyMs:Number(latencyMs)};});
      assert.equal(samples.length,80);assert.ok(samples.every(s=>s.status===200));
      exec(source,[...javaArgs,'r2lab.AttachClient','check']);exec(source,[...javaArgs,'r2lab.Probe']);
      const after=proof(source),check=JSON.parse(await readFile(join(out,'check.json'),'utf8'));
      assert.equal(after.running,true);assert.equal(after.restarts,0);assert.equal(before.pid,after.pid);
      assert.equal(before.startedAt,after.startedAt);assert.equal(seed.jvmStartTime,check.jvmStartTime);assert.equal(check.pid,1);
      assert.deepEqual(check.before,seed.before);assert.equal(before.network,'none');assert.deepEqual(before.ports,{});
      report.services[kind].after=after;report.services[kind].check=check;
      report.services[kind].http={samples:samples.length,all200:true,maxLatencyMs:Math.max(...samples.map(s=>s.latencyMs)),maxIntervalMs:Math.max(...samples.slice(1).map((s,i)=>s.time-samples[i].time))};
      report.services[kind].exports=[];
      for(const n of [1,2]) report.services[kind].exports.push(JSON.parse(await readFile(join(out,`export${n}.json`),'utf8')));
      assert.ok(samples[0].time<=report.services[kind].exports[0].wallStartMs);
      assert.ok(samples.at(-1).time>=report.services[kind].exports[1].wallEndMs);
      report.services[kind].passed=true;
      await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));
    }
    report.passed=true;console.log('R2_LOCAL_BOTH_SERVICES_PASSED');
  }finally{
    await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));
    // Nunca detener/reiniciar contenedores: quedan vivos para inspección. Sin cleanup automático.
    console.log('Evidencia sintética local: '+root);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{console.error(e.code??e.message,e.detail??'');process.exitCode=1;});
