import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BASE, JWKS, TENANT, AUDIENCE, parseExact, canonical, tables, restoration,
  verifyToken, exportOwnOrders, prepare, hash } from './rescate.mjs';

import { ORDER, CART } from './fixtures.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', use: 'sig', alg: 'RS256' };
const keys = { keys: [jwk] };
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function token(overrides = {}, key = privateKey, algorithm = 'RS256') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ kid: 'fixture', alg: algorithm })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    aud: AUDIENCE, tid: TENANT, oid: owner, scp: 'access_as_user', exp: now + 300, ...overrides })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
}
const jsonResponse = text => new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
async function temp() {
  const artifacts = join(dirname(fileURLToPath(import.meta.url)), 'artifacts');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(artifacts, 'synthetic-unit-'));
  return root;
}
function mockFetch(samples, calls = []) {
  let n = 0;
  return async (url, options) => {
    calls.push({ url, method: options.method ?? 'GET', redirect: options.redirect });
    if (url === JWKS) { assert.equal(options.headers, undefined); return jsonResponse(JSON.stringify(keys)); }
    assert.equal(url, `${BASE}/api/pedidos/usuario/${owner}`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.match(options.headers.Authorization, /^Bearer /);
    return jsonResponse(samples[n++]);
  };
}

test('parseo preserva Long > 2^53 y decimales sin IEEE-754', () => {
  const parsed = parseExact(ORDER);
  assert.equal(parsed[0].id.raw, '9007199254740993');
  assert.equal(parsed[0].items[0].precioUnitario.raw, '12.34');
  assert.equal(parseExact(canonical(parsed))[0].id.raw, '9007199254740993');
});
test('rechaza JSON ambiguo por claves duplicadas, basura o exceso de profundidad', () => {
  for (const raw of ['{"id":1,"id":2}', '[01]', '{}x', '['.repeat(65) + '0' + ']'.repeat(65)]) {
    assert.throws(() => parseExact(raw));
  }
});
test('preserva relaciones, estados, fechas, nulos y SQL escapa comillas', () => {
  const result = restoration(parseExact(ORDER), 'pedidos', 'h2');
  assert.deepEqual(result.counts, { parents: 1, children: 1 });
  assert.match(result.sql, /O''Reilly;/);
  assert.match(result.sql, /CANCELADO/);
  assert.match(result.sql, /RESTART WITH 9007199254740994/);
  assert.match(result.sql, /RESTART WITH 9007199254740998/);
  assert.match(result.sql, /REFERENCES pedidos\(id\)/);
  assert.doesNotMatch(result.sql, /DROP|IF NOT EXISTS|MERGE|UPDATE /);
});
test('Carrito vacío y alias histórico se conservan; no se fabrica oid ni total persistido', () => {
  const data = tables(parseExact(CART), 'carrito');
  assert.equal(data.parents.length, 2); assert.equal(data.children.length, 1);
  assert.equal(data.parents[0].usuario_id, 'historical-alias-not-reassigned');
  assert.equal(data.parents[1].creado_en, null);
  assert.ok(!Object.hasOwn(data.parents[0], 'total'));
  assert.match(restoration(parseExact(CART), 'carrito', 'h2').verification, /SUM/);
});
test('PostgreSQL genera identidad/constraints sin truncar fecha mayor a microsegundos', () => {
  assert.match(restoration(parseExact(ORDER), 'pedidos', 'postgres').sql, /TIMESTAMP\(6\)/);
  assert.throws(() => restoration(parseExact(ORDER.replace('.123456', '.123456789')), 'pedidos', 'postgres'), /FECHA_NO_REPRESENTABLE/);
  assert.doesNotThrow(() => restoration(parseExact(ORDER.replace('.123456', '.123456789')), 'pedidos', 'h2'));
});
test('no redondea dinero, no ignora campos nuevos ni mezcla padres/ítems duplicados', () => {
  assert.throws(() => tables(parseExact(ORDER.replace('12.34', '12.345')), 'pedidos'));
  assert.throws(() => tables(parseExact(ORDER.replace('"estado":', '"extra":true,"estado":')), 'pedidos'));
  const parsed = parseExact(ORDER);
  assert.throws(() => tables([...parsed, ...parsed], 'pedidos'));
  parsed[0].items.push(parsed[0].items[0]); assert.throws(() => tables(parsed, 'pedidos'));
});
test('firma y claims de owner se validan, no se confía en JWT solo decodificado', () => {
  assert.equal(verifyToken(token(), keys), owner);
  const badKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.throws(() => verifyToken(token({}, badKey), keys), /AUTH_INVALIDA/);
  assert.throws(() => verifyToken(token({}, privateKey, 'none'), keys), /AUTH_INVALIDA/);
});
for (const [name, override] of Object.entries({ tenant: { tid: 'other' }, audience: { aud: 'other' },
  issuer: { iss: 'https://other' }, expired: { exp: 0 }, future: { nbf: 9999999999 },
  oid: { oid: 'alias' }, scope: { scp: 'not_access_as_user' }, appOnly: { scp: null, roles: ['Admin'] } })) {
  test(`rechaza identidad JWT: ${name}`, () => assert.throws(() => verifyToken(token(override), keys), /AUTH_INVALIDA/));
}
test('export solo dos GET propios, nunca global/Carrito, conserva bytes y no graba token/owner en manifiesto', async () => {
  const root = await temp(), out = join(root, 'run'), calls = [], credential = token();
  const manifest = await exportOwnOrders({ token: credential, out, fetchImpl: mockFetch([ORDER, ORDER], calls) });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => !call.url.includes('/carrito') && call.method === 'GET'));
  assert.equal(manifest.completeBackup, false); assert.equal(manifest.twoSamplesAgree, true);
  assert.equal(await readFile(join(out, 'pedidos.sample-1.json'), 'utf8'), ORDER);
  const saved = await readFile(join(out, 'manifest.json'), 'utf8');
  assert.ok(!saved.includes(credential)); assert.ok(!saved.includes(owner));
  assert.equal(manifest.samples[0].sha256, hash(ORDER));
  if (process.platform === 'linux') assert.equal((await stat(out)).mode & 0o077, 0);
});
test('muestras distintas preservan ambas pero fallan sin afirmar snapshot o completitud', async () => {
  const root = await temp(), out = join(root, 'run');
  await assert.rejects(exportOwnOrders({ token: token(), out,
    fetchImpl: mockFetch([ORDER, ORDER.replace('CANCELADO', 'PENDIENTE')]) }), /MUESTRAS_DIFERENTES/);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.completeBackup, false); assert.equal(manifest.samples.length, 2);
  assert.equal(manifest.outcome, 'FAILED_OR_INCOMPLETE');
});
test('respuestas ajenas no se consideran export válido', async () => {
  const root = await temp();
  await assert.rejects(exportOwnOrders({ token: token(), out: join(root, 'run'),
    fetchImpl: mockFetch([ORDER.replace(owner, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')]) }), /PROPIETARIO_INCORRECTO/);
});
test('errores HTTP no registran el cuerpo privado ni exponen credenciales', async () => {
  const root = await temp();
  await assert.rejects(exportOwnOrders({ token: token(), out: join(root, 'run'), fetchImpl: async url =>
    url === JWKS ? jsonResponse(JSON.stringify(keys)) : new Response('private error', { status: 401 }) }), /HTTP_NO_200/);
  const manifest = await readFile(join(root, 'run', 'manifest.json'), 'utf8');
  assert.ok(!manifest.includes('private error')); assert.ok(!manifest.includes(owner));
});
test('prepare requiere aprobación parcial, no toca BD y nunca sobrescribe salida', async () => {
  const root = await temp(), input = join(root, 'fixture.json'), out = join(root, 'restore');
  await writeFile(input, ORDER);
  await assert.rejects(prepare({ input, kind: 'pedidos', dialect: 'h2', out }), /REQUIERE_ACEPTAR_PARCIAL/);
  await prepare({ input, kind: 'pedidos', dialect: 'h2', out, acceptPartial: true });
  await assert.rejects(prepare({ input, kind: 'pedidos', dialect: 'h2', out, acceptPartial: true }));
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.completeBackup, false); assert.equal(manifest.originalSequenceHighWaterKnown, false);
  assert.equal(manifest.inputSha256, hash(ORDER));
});
test('preserva cantidades históricas negativas sin convertirlas en reglas de negocio nuevas', () => {
  const result = restoration(parseExact(ORDER.replace('"cantidad":2', '"cantidad":-2')), 'pedidos', 'h2');
  assert.match(result.sql, /,-2,12\.34/);
});
test('Unicode inválido no se sustituye silenciosamente al preparar SQL', () => {
  const parsed = parseExact(ORDER); parsed[0].items[0].nombreProducto = '\ud800';
  assert.throws(() => restoration(parsed, 'pedidos', 'h2'), /TEXTO_INVALIDO/);
});
test('CLI no permite exportar Carrito ni elegir usuario/URL mediante argumentos', () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'rescate.mjs');
  for (const args of [ ['export-carrito', '--out', 'unused'],
    ['export-pedidos-propios', '--out', 'unused', '--usuario', 'other'],
    ['export-pedidos-propios', '--out', 'unused', '--base', 'https://other'] ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ERROR: (MODO_INVALIDO|ARGUMENTOS_INVALIDOS)/);
    assert.ok(!result.stderr.includes('other'));
  }
});
