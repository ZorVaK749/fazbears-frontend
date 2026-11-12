// Genera y ejecuta SOLO fixtures sintéticos. Sin HTTP ni credenciales privadas.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ORDER, CART } from './fixtures.mjs';
import { parseExact, restoration } from './rescate.mjs';

process.umask(0o077);
const here = dirname(fileURLToPath(import.meta.url));
const h2jar = process.argv[2];
if (!h2jar || !h2jar.endsWith('.jar')) throw new Error('Indicar JAR H2 local para prueba sintética');
await mkdir(join(here, 'artifacts'), { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(here, 'artifacts', 'synthetic-roundtrip-'));
await writeFile(join(root, '.synthetic-only'), 'SYNTHETIC_ONLY\n', { mode: 0o600, flag: 'wx' });
for (const [kind, fixture] of [['pedidos', ORDER], ['carrito', CART]]) {
  const result = restoration(parseExact(fixture), kind, 'h2');
  await writeFile(join(root, `${kind}.restore.sql`), result.sql, { mode: 0o600, flag: 'wx' });
  await writeFile(join(root, `${kind}.verify.sql`), result.verification, { mode: 0o600, flag: 'wx' });
}
const run = spawnSync('java', ['--class-path', h2jar, join(here, 'RestoreSynthetic.java'), root], {
  encoding: 'utf8', timeout: 60000,
});
// El harness nunca recibe rutas/SQL reales. Salida saneada: no imprimir excepciones SQL.
if (run.status !== 0) { console.error('FALLO en restauración sintética; no se tocó ninguna BD remota.'); process.exitCode = 1; }
else console.log(run.stdout.trim());
