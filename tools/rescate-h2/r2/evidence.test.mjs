// Verifica artefactos de una corrida SINTÉTICA completada. No Docker, HTTP o AWS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { IMAGES } from './lab.mjs';
assert.ok(process.env.R2_REPORT,'Indicar R2_REPORT con reporte sintético local');
assert.ok(process.env.R2_NEGATIVE,'Indicar R2_NEGATIVE con reporte negativo local');
const root=dirname(process.env.R2_REPORT);
const report=JSON.parse(await readFile(process.env.R2_REPORT,'utf8'));
const negative=JSON.parse(await readFile(process.env.R2_NEGATIVE,'utf8'));
assert.equal(report.syntheticOnly,true);assert.equal(report.awsExecution,false);
assert.equal(negative.syntheticOnly,true);assert.equal(negative.awsExecution,false);

test('dos imágenes por digest y config Image ID exactos, linux/amd64',()=>{
  assert.equal(report.passed,true);
  for(const [kind,spec] of Object.entries(IMAGES)){
    const s=report.services[kind];assert.equal(s.configDigest,spec.config);
    assert.equal(s.indexDigest,spec.ref.split('@')[1]);assert.equal(s.architecture,'linux/amd64');
    assert.equal(s.artifact.memoryDatabaseConfirmed,true);assert.equal(s.artifact.ddlCreateDrop,true);
    assert.ok(s.artifact.libraries.includes('h2-2.4.240.jar'));
  }
});
test('inventario completo del fixture: tres tablas, filas desconocidas/LOB y objetos adicionales',()=>{
  for(const [kind,s] of Object.entries(report.services)){
    const before=s.seed.before;
    assert.equal(before[kind==='carrito'?'PUBLIC.CARRITOS':'PUBLIC.PEDIDOS'].count,3);
    assert.equal(before[kind==='carrito'?'PUBLIC.ITEMS_CARRITO':'PUBLIC.ITEM_PEDIDO'].count,2);
    assert.equal(before['R2_EXTRA.UNMAPPED'].count,2);
    assert.equal(Object.values(before).filter(v=>v&&Number.isInteger(v.count)).length,3);
    assert.equal(before.views.length,1);assert.equal(before.sequences.length,1);
    assert.ok(before.indexes.some(x=>x.includes('IX_HISTORICAL_STATE')));
    assert.ok(before.constraints.length>=4);
  }
});
test('identidades preservan high-water superior al max visible y secuencia independiente',()=>{
  for(const s of Object.values(report.services)){
    assert.equal(s.seed.before.identities.length,2);
    assert.ok(s.seed.before.identities.some(x=>x.includes('1001')));
    assert.ok(s.seed.before.identities.some(x=>x.includes('2001')));
    assert.ok(s.seed.before.sequences[0].includes('27'));
  }
});
test('cuatro dumps: SHA-256 de bytes coincide, hay DDL/filas y source no cambia',async()=>{
  for(const [kind,s] of Object.entries(report.services))for(const n of [1,2]){
    const bytes=await readFile(join(root,kind,`export${n}.sql`)),meta=s.exports[n-1];
    assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.scriptSha256);
    assert.equal(bytes.length,meta.scriptBytes);assert.match(bytes.toString('utf8'),/CREATE.*TABLE/);
    assert.match(bytes.toString('utf8'),/INSERT INTO/);assert.equal(meta.passwordsIncluded,false);
    assert.equal(meta.sourceUnchanged,true);assert.deepEqual(meta.before,s.seed.before);assert.deepEqual(meta.after,s.seed.before);
  }
});
test('cada restauración y reapertura en JVM nueva coincide en filas, esquema lógico y contadores',async()=>{
  for(const [kind,s] of Object.entries(report.services))for(const n of [1,2]){
    for(const name of [`restored-${n}.json`,`reopened-${n}.json`]){
      assert.deepEqual(JSON.parse(await readFile(join(root,kind,name),'utf8')),s.seed.before);
    }
  }
});
test('continúan procesos originales de prueba, sin restart y sin puertos/red externos',()=>{
  for(const s of Object.values(report.services)){
    assert.equal(s.before.startedAt,s.after.startedAt);assert.equal(s.before.pid,s.after.pid);
    assert.equal(s.after.running,true);assert.equal(s.after.restarts,0);
    assert.equal(s.seed.jvmStartTime,s.check.jvmStartTime);assert.equal(s.check.pid,1);
    assert.equal(s.after.network,'none');assert.deepEqual(s.after.ports,{});assert.equal(s.after.readonly,true);
    assert.deepEqual(s.check.before,s.seed.before);
  }
});
test('observación de funcionalidad: 80 HTTP autenticados correctos por servicio',()=>{
  for(const s of Object.values(report.services)){
    assert.equal(s.http.samples,80);assert.equal(s.http.all200,true);assert.ok(s.http.maxLatencyMs>=0);
  }
});
test('guards sin marker y dos escrituras concurrentes se rechazan como casos negativos esperados',()=>{
  assert.equal(negative.passed,true);assert.equal(negative.missingMarkerGuardRejected,true);
  assert.equal(negative.agentGuardBeforeInstrumentation,true);
  for(const s of Object.values(negative.services)){
    assert.equal(s.expectedRejection,true);assert.equal(s.nativeFileQuarantined,true);
    assert.equal(s.sourceStillRunning,true);assert.equal(s.restarts,0);assert.notDeepEqual(s.before,s.after);
  }
});
