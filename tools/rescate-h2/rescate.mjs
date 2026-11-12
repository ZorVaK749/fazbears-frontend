// Herramienta externa/offline. Ninguna función escribe a servicios o conecta a una BD.
import { createPublicKey, verify, createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = 'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com';
export const TENANT = 'ee0d2c5b-e60b-4c57-9b30-8a38a520c430';
export const AUDIENCE = '304fa289-2b72-447b-9c48-f00998f7c22f';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
export const JWKS = `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`;
const LIMIT = 20 * 1024 * 1024;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export class RescueError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new RescueError(code); };
const check = (condition, code) => { if (!condition) fail(code); };
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Números preservados como lexemas: nunca pasar IDs Long o NUMERIC por IEEE-754.
export class NumberToken { constructor(raw) { this.raw = raw; } }
export function parseExact(text) {
  let i = 0;
  const space = () => { while (/[ \t\r\n]/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') { i++; continue; }
      if (c === '"') return JSON.parse(text.slice(start, i));
    }
    fail('JSON_INVALIDO');
  }
  function value(depth) {
    check(depth < 64, 'JSON_PROFUNDO'); space(); const c = text[i];
    if (c === '"') return string();
    if (c === '{') {
      i++; space(); const result = Object.create(null);
      if (text[i] === '}') { i++; return result; }
      while (true) {
        space(); check(text[i] === '"', 'JSON_INVALIDO'); const key = string(); space();
        check(!Object.hasOwn(result, key), 'JSON_CLAVE_DUPLICADA');
        check(text[i++] === ':', 'JSON_INVALIDO'); result[key] = value(depth + 1); space();
        if (text[i] === '}') { i++; return result; }
        check(text[i++] === ',', 'JSON_INVALIDO');
      }
    }
    if (c === '[') {
      i++; space(); const result = [];
      if (text[i] === ']') { i++; return result; }
      while (true) {
        result.push(value(depth + 1)); space();
        if (text[i] === ']') { i++; return result; }
        check(text[i++] === ',', 'JSON_INVALIDO');
      }
    }
    for (const [word, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, i)) { i += word.length; return result; }
    }
    const number = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    check(!!number, 'JSON_INVALIDO'); i += number[0].length; return new NumberToken(number[0]);
  }
  try { const result = value(0); space(); check(i === text.length, 'JSON_INVALIDO'); return result; }
  catch (error) { if (error instanceof RescueError) throw error; fail('JSON_INVALIDO'); }
}
export function canonical(value) {
  if (value instanceof NumberToken) return value.raw;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function integer(value, min, max) {
  check(value instanceof NumberToken && /^-?(?:0|[1-9]\d*)$/.test(value.raw), 'ENTERO_INVALIDO');
  const n = BigInt(value.raw); check(n >= min && n <= max, 'ENTERO_FUERA_RANGO'); return n;
}
const id = value => integer(value, 1n, 9223372036854775806n);
function money(value) {
  check(value instanceof NumberToken, 'DECIMAL_INVALIDO');
  const match = value.raw.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  check(!!match, 'DECIMAL_INVALIDO');
  const exponent = Number(match[4] ?? 0); check(Math.abs(exponent) <= 100, 'DECIMAL_FUERA_RANGO');
  const digits = match[2] + (match[3] ?? ''); const point = match[2].length + exponent;
  const whole = (point <= 0 ? '0' : (digits + '0'.repeat(Math.max(0, point - digits.length))).slice(0, point)).replace(/^0+/, '') || '0';
  const fraction = (point < 0 ? '0'.repeat(-point) + digits : digits.slice(Math.max(0, point))).replace(/0+$/, '');
  check(whole.length <= 8 && fraction.length <= 2, 'DECIMAL_NO_REPRESENTABLE');
  return value;
}
function text(value, max, nullable = false) {
  if (value === null && nullable) return value;
  check(typeof value === 'string' && value.isWellFormed() && [...value].length <= max
    && !value.includes('\0'), 'TEXTO_INVALIDO'); return value;
}
function timestamp(value, dialect) {
  if (value === null) return value;
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?$/.test(value), 'FECHA_INVALIDA');
  // PostgreSQL limita precisión a microsegundos: no truncar información silenciosamente.
  const fraction = value.split('.')[1] ?? '';
  check(dialect !== 'postgres' || !/[1-9]/.test(fraction.slice(6)), 'FECHA_NO_REPRESENTABLE');
  return value;
}
function fields(object, keys) {
  check(object && typeof object === 'object' && !Array.isArray(object), 'FORMA_INVALIDA');
  check(Object.keys(object).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(object, key)), 'CAMPOS_INESPERADOS_O_AUSENTES');
}

export function tables(payload, kind, dialect = 'h2') {
  check(['pedidos', 'carrito'].includes(kind) && ['h2', 'postgres'].includes(dialect), 'OPCION_INVALIDA');
  const parents = [], children = [], parentIds = new Set(), itemIds = new Set(), users = new Set();
  const rows = kind === 'carrito' && !Array.isArray(payload) ? [payload] : payload;
  check(Array.isArray(rows), 'FORMA_INVALIDA');
  for (const row of rows) {
    const parentKeys = kind === 'pedidos'
      ? ['id', 'usuarioId', 'emailUsuario', 'fechaCreacion', 'total', 'estado', 'items']
      : ['id', 'usuarioId', 'creadoEn', 'items', 'total'];
    fields(row, parentKeys);
    const key = id(row.id).toString(); check(!parentIds.has(key), 'ID_PARENT_DUPLICADO'); parentIds.add(key);
    text(row.usuarioId, 100);
    check(kind !== 'carrito' || !users.has(row.usuarioId), 'USUARIO_CARRITO_DUPLICADO'); users.add(row.usuarioId);
    const parent = { id: row.id, usuario_id: row.usuarioId };
    if (kind === 'pedidos') {
      parent.email_usuario = text(row.emailUsuario, 150);
      parent.fecha_creacion = timestamp(row.fechaCreacion, dialect);
      parent.total = money(row.total);
      // Preservar estados históricos conocidos; nunca convertir CANCELADO a PENDIENTE.
      check(['PENDIENTE', 'PREPARANDO', 'COMPLETADO', 'CANCELADO'].includes(row.estado), 'ESTADO_DESCONOCIDO');
      parent.estado = row.estado;
    } else {
      parent.creado_en = timestamp(row.creadoEn, dialect);
      check(row.total instanceof NumberToken, 'DECIMAL_INVALIDO');
    }
    parents.push(parent); check(Array.isArray(row.items), 'FORMA_ITEMS_INVALIDA');
    for (const item of row.items) {
      fields(item, ['id', 'productoId', 'nombreProducto', 'cantidad', 'precioUnitario']);
      const itemKey = id(item.id).toString(); check(!itemIds.has(itemKey), 'ID_ITEM_DUPLICADO'); itemIds.add(itemKey);
      id(item.productoId); integer(item.cantidad, -2147483648n, 2147483647n);
      children.push({ id: item.id, [kind === 'pedidos' ? 'pedido_id' : 'carrito_id']: row.id,
        producto_id: item.productoId, nombre_producto: text(item.nombreProducto, 120, true),
        cantidad: item.cantidad, precio_unitario: money(item.precioUnitario) });
    }
  }
  const sort = (a, b) => id(a.id) < id(b.id) ? -1 : 1;
  parents.sort(sort); children.sort(sort); return { parents, children };
}
const literal = value => value === null ? 'NULL' : value instanceof NumberToken ? value.raw : `'${value.replaceAll("'", "''")}'`;
export function restoration(payload, kind, dialect) {
  const data = tables(payload, kind, dialect);
  const parent = kind === 'pedidos' ? 'pedidos' : 'carritos';
  const child = kind === 'pedidos' ? 'item_pedido' : 'items_carrito';
  const fk = kind === 'pedidos' ? 'pedido_id' : 'carrito_id';
  const temporal = dialect === 'postgres' ? 'TIMESTAMP(6)' : 'TIMESTAMP(9)';
  const sql = [dialect === 'postgres' ? 'BEGIN;\nSET LOCAL standard_conforming_strings = on;' : 'SET AUTOCOMMIT FALSE;',
    `CREATE TABLE ${parent} (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, usuario_id VARCHAR(100) NOT NULL${kind === 'carrito' ? ' UNIQUE' : ''}, `
    + (kind === 'pedidos' ? `email_usuario VARCHAR(150) NOT NULL, fecha_creacion ${temporal}, total NUMERIC(10,2) NOT NULL, estado VARCHAR(30) NOT NULL);` : `creado_en ${temporal});`),
    `CREATE TABLE ${child} (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, ${fk} BIGINT NOT NULL REFERENCES ${parent}(id), producto_id BIGINT NOT NULL, nombre_producto VARCHAR(120), cantidad INTEGER NOT NULL, precio_unitario NUMERIC(10,2) NOT NULL);`];
  const checks = [];
  for (const [table, rows] of [[parent, data.parents], [child, data.children]]) {
    for (const row of rows) {
      const keys = Object.keys(row);
      sql.push(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(k => literal(row[k])).join(',')});`);
      // Compara TODOS los campos presentes, sin imprimirlos en resultados.
      checks.push(`SELECT COUNT(*) FROM ${table} WHERE ${keys.map(k => `${k} IS NOT DISTINCT FROM ${literal(row[k])}`).join(' AND ')};`);
    }
    const next = rows.length ? id(rows.at(-1).id) + 1n : 1n;
    sql.push(`ALTER TABLE ${table} ALTER COLUMN id RESTART WITH ${next};`);
  }
  if (kind === 'carrito') {
    for (const row of (Array.isArray(payload) ? payload : [payload])) {
      checks.push(`SELECT COUNT(*) FROM carritos p WHERE p.id = ${literal(row.id)} AND `
        + `(SELECT COALESCE(SUM(i.cantidad * i.precio_unitario),0) FROM items_carrito i WHERE i.carrito_id = p.id) = ${literal(row.total)};`);
    }
  }
  sql.push('COMMIT;');
  return { sql: sql.join('\n') + '\n', verification: checks.join('\n') + '\n', counts: {
    parents: data.parents.length, children: data.children.length },
    canonicalHash: hash(canonical(data)), expectedChecks: checks.length };
}

async function bounded(response) {
  check(response.status === 200, 'HTTP_NO_200');
  check((response.headers.get('content-type') ?? '').toLowerCase().includes('application/json'), 'HTTP_NO_JSON');
  check(Number(response.headers.get('content-length') ?? 0) <= LIMIT, 'RESPUESTA_GRANDE');
  const reader = response.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; check(size <= LIMIT, 'RESPUESTA_GRANDE'); parts.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = Buffer.concat(parts);
  try { return { bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch { fail('UTF8_INVALIDO'); }
}
export function verifyToken(token, jwks, now = Math.floor(Date.now() / 1000)) {
  try {
    check(typeof token === 'string' && token.length < 65536, 'AUTH_INVALIDA');
    const parts = token.split('.'); check(parts.length === 3, 'AUTH_INVALIDA');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    check(header.alg === 'RS256' && typeof header.kid === 'string' && !header.crit, 'AUTH_INVALIDA');
    const keys = jwks.keys.filter(key => key.kid === header.kid && key.kty === 'RSA'
      && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
    check(keys.length === 1 && verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: keys[0], format: 'jwk' }), Buffer.from(parts[2], 'base64url')), 'AUTH_INVALIDA');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    check(claims.iss === ISSUER && claims.tid === TENANT && GUID.test(claims.oid)
      && (Array.isArray(claims.aud) ? claims.aud.includes(AUDIENCE) : claims.aud === AUDIENCE)
      && Number.isFinite(claims.exp) && claims.exp > now
      && (claims.nbf === undefined || (Number.isFinite(claims.nbf) && claims.nbf <= now))
      && typeof claims.scp === 'string' && claims.scp.split(/\s+/).includes('access_as_user'), 'AUTH_INVALIDA');
    return claims.oid;
  } catch { fail('AUTH_INVALIDA'); }
}
async function privateDirectory(path) {
  const parent = await realpath(dirname(resolve(path)));
  if (process.platform === 'linux') {
    const info = await stat(parent);
    check(info.uid === process.getuid() && !(info.mode & 0o022), 'DIRECTORIO_PADRE_NO_PRIVADO');
  }
  await mkdir(path, { mode: 0o700 }); // sin recursive/exist_ok: nunca sobrescribir un rescate previo
  if (process.platform === 'linux') {
    const info = await lstat(path); check(!info.isSymbolicLink() && !(info.mode & 0o077), 'PERMISOS_INVALIDOS');
  }
}
async function privateFile(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export async function exportOwnOrders({ token, out, fetchImpl = fetch }) {
  // URLs fijas; no --usuario, GET global, rangos de IDs, /me antiguo ni GET Carrito con getOrCreate.
  const keysResponse = await fetchImpl(JWKS, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const keys = JSON.parse((await bounded(keysResponse)).text);
  const owner = verifyToken(token, keys);
  await privateDirectory(out);
  const manifest = { format: 1, kind: 'pedidos', createdAt: new Date().toISOString(),
    sourceBase: BASE, scope: 'ONE_VERIFIED_OWNER_ONLY', sourceCommitBoundToImage: false,
    completeBackup: false, globalCompleteness: 'UNPROVEN', snapshotConsistency: 'UNPROVEN',
    samples: [], twoSamplesAgree: false, restorationPrepared: false, outcome: 'IN_PROGRESS' };
  try {
    for (let sample = 1; sample <= 2; sample++) {
      check(verifyToken(token, keys) === owner, 'AUTH_INVALIDA');
      const response = await fetchImpl(`${BASE}/api/pedidos/usuario/${encodeURIComponent(owner)}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      const { bytes, text } = await bounded(response);
      const name = `pedidos.sample-${sample}.json`;
      await privateFile(join(out, name), bytes); // conservar evidencia exacta antes de validarla
      const entry = { file: name, sha256: hash(bytes), capturedAt: new Date().toISOString() };
      manifest.samples.push(entry);
      const payload = parseExact(text);
      check(Array.isArray(payload) && payload.every(row => row.usuarioId === owner), 'PROPIETARIO_INCORRECTO');
      const data = tables(payload, 'pedidos');
      entry.canonicalHash = hash(canonical(data));
      entry.parents = data.parents.length; entry.children = data.children.length;
    }
    manifest.twoSamplesAgree = manifest.samples[0].canonicalHash === manifest.samples[1].canonicalHash;
    check(manifest.twoSamplesAgree, 'MUESTRAS_DIFERENTES');
    manifest.outcome = 'RECOVERED_PARTIAL';
    return manifest;
  } catch (error) {
    manifest.outcome = 'FAILED_OR_INCOMPLETE';
    manifest.errorCode = error instanceof RescueError ? error.code : 'OPERACION_NO_COMPLETADA';
    throw error;
  } finally {
    await privateFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}
export async function prepare({ input, kind, dialect, out, acceptPartial }) {
  check(acceptPartial === true, 'REQUIERE_ACEPTAR_PARCIAL');
  const bytes = await readFile(input); check(bytes.length <= LIMIT, 'RESPUESTA_GRANDE');
  const result = restoration(parseExact(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), kind, dialect);
  await privateDirectory(out);
  await privateFile(join(out, 'restore.sql'), result.sql);
  await privateFile(join(out, 'verify.sql'), result.verification);
  await privateFile(join(out, 'manifest.json'), JSON.stringify({ format: 1, kind, dialect,
    completeBackup: false, inputSha256: hash(bytes), sqlSha256: hash(result.sql),
    verificationSha256: hash(result.verification), canonicalHash: result.canonicalHash,
    counts: result.counts, expectedChecks: result.expectedChecks,
    originalSequenceHighWaterKnown: false, target: 'NEW_EMPTY_ISOLATED_DATABASE_ONLY',
  }, null, 2) + '\n');
  return result.counts;
}
async function secret() {
  check(process.stdin.isTTY && process.stdout.isTTY, 'REQUIERE_TERMINAL_PRIVADO');
  process.stdout.write('JWT delegado propio (entrada oculta; nunca pegar en chat): ');
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolveToken, reject) => {
    let value = '';
    const end = error => {
      process.stdin.off('data', read); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(new RescueError(error)); else resolveToken(value);
      value = '';
    };
    const read = data => {
      for (const byte of data) {
        if (byte === 3) { end('CANCELADO'); return; }
        if (byte === 13 || byte === 10) { end(); return; }
        if (byte === 127 || byte === 8) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
        if (value.length >= 65536) { end('AUTH_INVALIDA'); return; }
      }
    };
    process.stdin.on('data', read);
  });
}
async function cli() {
  const [mode, ...args] = process.argv.slice(2); const options = new Map();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--accept-partial') options.set('partial', true);
    else { check(['--out', '--input', '--kind', '--dialect'].includes(args[i]) && args[i + 1], 'ARGUMENTOS_INVALIDOS');
      options.set(args[i].slice(2), args[++i]); }
  }
  check(options.has('out'), 'REQUIERE_OUT_NUEVO');
  if (mode === 'export-pedidos-propios') {
    check([...options.keys()].every(key => key === 'out'), 'ARGUMENTOS_INVALIDOS');
    check(process.platform === 'linux', 'EXPORT_REAL_REQUIERE_LINUX_PERMISOS_PRIVADOS');
    const token = await secret(); await exportOwnOrders({ token, out: options.get('out') });
    console.log('Recuperación parcial guardada. NO demuestra respaldo completo ni snapshot global.');
  } else if (mode === 'prepare') {
    check(options.has('input') && options.has('kind') && options.has('dialect'), 'ARGUMENTOS_INVALIDOS');
    await prepare({ input: options.get('input'), kind: options.get('kind'), dialect: options.get('dialect'),
      out: options.get('out'), acceptPartial: options.get('partial') === true });
    console.log('SQL offline preparado, NO ejecutado. Solo para una BD nueva y aislada.');
  } else fail('MODO_INVALIDO');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  cli().catch(error => {
    // No stack, URL con usuario, cuerpo HTTP, Authorization o mensajes de dependencias.
    console.error(`ERROR: ${error instanceof RescueError ? error.code : 'OPERACION_NO_COMPLETADA'}`);
    process.exitCode = 1;
  });
}
