# Rescate H2 — herramienta externa y ensayo local

Estado: **prototipo local, NO ejecutado contra AWS**. No commits/push en este bloque.
Leer primero `docs/PLAN_RESCATE_H2_EV3.md` en la raíz del workspace.
**No es un respaldo integral de H2 ni habilita el despliegue.**

Actualización R2: `r2/README.md` documenta instrumentación **solo en réplicas locales
sintéticas** por digest exacto. El exportador API de este README mantiene sus
límites originales; los scripts R2 no tienen modo producción/CloudShell.

## Seguridad y alcance

- Node.js **22+**, sin paquetes externos; Java 21 y JAR H2 local solo para el ensayo.
- Exportador real limitado a Linux con directorio padre privado y usuario dueño.
  No se certifican ACL Windows: en Windows solo se probaron fixtures sintéticos.
- Solo dos GET `/api/pedidos/usuario/{oid}` por ejecución, con oid derivado de JWT
  delegado **verificado criptográficamente** contra JWKS Microsoft/issuer/audience/
  tenant/scope/tiempo configurados. Sin ID usuario o URL editables por CLI.
- No GET global, enumeración de IDs/usuarios, rutas Carrito, /h2-console, mutaciones,
  Orden, brokers, conexión a BD remota, attach ni instrumentación.
- Entrada de JWT oculta en terminal privado. Sin argumentos/variables de entorno/
  archivos de token; sin escribir tokens, claims o datos personales en consola/logs.
  JavaScript no garantiza borrado criptográfico de strings en RAM; proceso corto
  y terminal/host privados son requisitos. No usar grabación de terminal o shell -x.
- JSON/SQL de recuperación sí contienen datos privados: carpetas nuevas 0700 y
  archivos exclusivos 0600, nunca sobrescritos. Cifrar/copiar fuera del laboratorio
  mediante procedimiento aprobado. No subirlos a Git o al chat.
- Se conservan bytes exactos, hashes, dos muestras y manifiesto siempre parcial.
  Dos muestras iguales no prueban ausencia de registros desconocidos ni snapshot.

## Comandos para revisar; exportación real pendiente de aprobación

En CloudShell privado con Node compatible y cliente autorizado, sin tocar servicios:

```bash
umask 077
install -d -m 700 "$HOME/rescate-h2-privado"
node tools/rescate-h2/rescate.mjs export-pedidos-propios --out "$HOME/rescate-h2-privado/pedidos-run-01"
```

El JWT se introduce solo en el prompt oculto desde una fuente privada aprobada.
Nunca escribirlo en el comando, copiarlo al chat ni usar tokens de otros usuarios.
El destino debe ser nuevo; límite 20 MiB por respuesta y timeout 15 segundos,
sin reintentos automáticos. 401/403/404 o cualquier fallo: detener, no buscar rutas
alternativas inseguras. API sin paginación puede superar el límite: no asumir completo.

Una extracción por propietario no cubre pedidos bajo alias históricos, usuarios
desconocidos ni hijos huérfanos. No se agrega un modo admin/global para ocultarlo.
**No existe modo de exportación Carrito**, porque su GET antiguo puede escribir.

## Preparación offline, jamás ejecución automática del SQL

Después de verificar manualmente hash/manifiesto/dos muestras y aprobar usar una
extracción parcial en staging, con archivos privados ya obtenidos lícitamente:

```bash
node tools/rescate-h2/rescate.mjs prepare --kind pedidos --dialect h2 --input /ruta/privada/pedidos.sample-1.json --out /ruta/privada/staging-plan-01 --accept-partial
```

Alternativa `--dialect postgres`. `--kind carrito` **solo procesa un archivo offline
ya autorizado**, no accede a la API. No transforma un archivo de origen desconocido
en evidencia fiable. Se generan restore.sql, verify.sql y manifest.json, no se conecta
a ninguna BD. Esquema de staging explícito, no copia del catálogo original completo.
No combinar corridas/usuarios ni deduplicar/editar datos manualmente sin un plan
auditable de consolidación posterior; este prototipo prepara una muestra por vez.

Números JSON se parsean sin IEEE-754 (Long > 2^53 y NUMERIC exactos); se rechazan
duplicados, campos no reconocidos, truncamientos de precisión y Unicode no representable.
Nulos, estados, alias, timestamps y cantidades históricas negativas no se corrigen
silenciosamente. SQL conserva IDs y reconstruye FK desde nesting; no usa endpoints
POST/JPA que regeneren IDs o fechas. Secuencia max visible+1 es **solo de staging**:
no recupera high-water original ni demuestra que no reutilice IDs eliminados.

## Ensayo exclusivamente sintético

Desde la raíz del workspace:

```text
node --test tools/rescate-h2/rescate.test.mjs
node tools/rescate-h2/synthetic-roundtrip.mjs RUTA_AL_JAR_LOCAL_H2_2.4.240
```

El segundo comando lanza una JVM **nueva local**, nunca se adjunta a otra. Crea dos
BD H2 archivo nuevas dentro de `artifacts/synthetic-roundtrip-*`, importa fixtures,
verifica todos los campos/relaciones/counts/IDs/secuencias y rechaza un FK huérfano;
cierra y reabre archivos para comprobar persistencia. No recibe URL JDBC remota.

Resultados: **23/23 tests Node aprobados** y **dos BD H2 archivo sintéticas restauradas
y reabiertas correctamente**. IDs > 2^53, decimales, CANCELADO, nulls, fecha, Unicode,
carrito vacío y alias incluidos. SQL PostgreSQL generado/verificado estructuralmente,
**NO ejecutado en PostgreSQL**. No certifica una migración productiva JPA/DDL.

Los artefactos sintéticos quedan locales/ignorados; no se borran datos automáticamente.
PAUSADO — esperando aprobación del método de conservación.
