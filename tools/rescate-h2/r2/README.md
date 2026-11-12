# R2 — extracción nativa en réplicas sintéticas, NO rescate AWS

**Estos artefactos son SOLO laboratorio. Está prohibido usarlos sobre JVM reales
sin nueva autorización. No existe modo producción ni instrucciones para engañar
los guards.** Ver PLAN_RESCATE_H2_EV3.md sección 12 y propuesta R3.

## Método ensayado

Imágenes exactas por digest → JAR/dependencias extraídos offline → contenedores
Docker Desktop locales `--network none`, sin puertos publicados, rootfs readonly,
capabilities eliminadas, no-new-privileges. No `--privileged`, PID host ni daemon
remoto. El orquestador requiere Windows y endpoint npipe de desktop-linux.

El proceso principal usa el Java 21 JRE original y app.jar intacto. Un JDK Alpine
21.0.13 se monta readonly desde un volumen de herramientas creado por la corrida;
no sustituye el JRE principal. Digest del helper fijado en lab.mjs.

Para arrancar offline sin desactivar Spring Security, un proveedor JWT de fixture
escucha solo en loopback del contenedor: issuer/audience configurados a ese fixture,
firma RSA validada por el decoder original de la aplicación. Claves solo en memoria;
401 sin JWT y 200 con JWT sintético. No Azure ni tokens reales.

AttachClient se ejecuta dentro de la réplica, con mismo UID/namespace que PID 1.
Usa JDK Attach API y carga agent.jar. NativeAgent utiliza Instrumentation solo para
encontrar SpringApplication ya cargado; lee su shutdownHook.contexts (internals de
Boot 4.1.1), obtiene el bean dataSource **ya existente** y una conexión de ese pool.
No abre otra jdbc:h2:mem con otro driver/classloader. Se confirma HikariDataSource,
LaunchedClassLoader y URL mem esperada. Ninguna redefinición/transformer de clases.

El modo seed se limita a fixtures de laboratorio y rechaza base no vacía. Export
no inserta/actualiza datos: ejecuta **SCRIPT NOPASSWORDS** sobre la conexión viva,
escribe SQL exclusivo, calcula SHA-256 y compara inventario antes/después. El dump
incluye tablas/datos/constraints/vistas/índices y contadores de este fixture, pero
**excluye contraseñas H2**. No llamarlo copia integral de autenticación/heap.

JDK jcmd 1 VM.version también se probó dentro de ambas réplicas sin reiniciarlas;
jcmd solo no proporciona la exportación relacional. No heap dump, debugger o GC
forzado. No se ejecutó instrumentación en AWS.

## Límites y retirada

- Cliente y agente requieren R2_SYNTHETIC_LAB_ONLY, UUID de corrida y lab.marker;
  el agente rechaza antes de usar Instrumentation si faltan. La JVM real no tiene
  esos marcadores. No reiniciar para agregarlos ni copiar este seed a producción.
- Archivos SQL/DB/JAR/reportes completos quedan en ../artifacts/, ignorados por Git.
  Solo fixtures; no se certificaron ACL Windows para datos reales.
- 768 MiB/1 CPU/128 pids por réplica, heap principal 256 MiB, helper fixture 48 MiB,
  procesos de herramienta 96 MiB y tmpfs /tmp de 64 MiB. Exportación limitada a
  32 MiB de salida, 100000 filas por tabla y 1 MiB por LOB en el inventario.
- Esos límites NO acotan toda la asignación interna de H2 SCRIPT ni garantizan
  cancelación dura con setQueryTimeout. No extrapolar a tamaños reales desconocidos.
- Detach cierra la conexión de attach, no descarga clases de agente. Quedan clases
  definidas y Attach Listener de HotSpot; no transformers/tareas propias pendientes.
  JDBC/streams se cierran al retornar. R2 no pretende revertir esos efectos runtime.
- Los contenedores de ensayo quedan vivos. No cleanup automático, reinicios ni
  borrados amplios. Después de revisión se puede autorizar retirada selectiva de
  recursos con label rescue.r2; no actuar sobre nombres de servicios reales.

## Reproducir solo en Docker Desktop local

Requisitos: Docker Desktop Linux iniciado conscientemente (otras cargas con
auto-restart revisadas), Node 22+, JDK 21 host con javac/jar y acceso de pull GHCR.
No publicar imágenes. En la raíz del workspace:

```text
node tools/rescate-h2/r2/lab.mjs
node tools/rescate-h2/r2/negative.mjs tools/rescate-h2/artifacts/RUN_POSITIVO/report.json
```

El primer comando informa su directorio nuevo. El segundo usa ese reporte y crea
réplicas NEGATIVAS nuevas, no modifica las positivas. Credenciales de registry las
administra Docker; no introducir tokens en argumentos ni copiar secrets al chat.

Verificación offline de evidencias (PowerShell; variables son rutas, no secretos):

```powershell
$env:R2_REPORT = 'tools/rescate-h2/artifacts/RUN_POSITIVO/report.json'
$env:R2_NEGATIVE = 'tools/rescate-h2/artifacts/RUN_NEGATIVO/report.json'
node --test tools/rescate-h2/r2/evidence.test.mjs
node --test tools/rescate-h2/rescate.test.mjs
```

## Qué se compara

Cada servicio parte de 3 padres + 2 hijos, incluyendo propietarios desconocidos,
alias y padre vacío. Se añade schema R2_EXTRA con tabla UNMAPPED (2 filas, CLOB,
BLOB/null, id >2^53 y estado histórico CANCELADO), vista, índice explícito y
secuencia independiente. No afirmar CANCELADO soportado por el enum antiguo de
Pedidos: ese valor se prueba en la tabla auxiliar, no se cambia el enum desplegado.

Se inventarían **todas las tablas de usuario** de la BD, no solo las entidades
conocidas. Hashes de todas las celdas/filas (nulos y LOB incluidos), cantidades,
tipos/tamaño/escala/default/nullability, PK/FK, constraints/checks/vistas/índices,
identity bases 1001/2001 y secuencia con base 27 (max visible es mucho menor).
SCRIPT se restaura con el H2 **extraído de la imagen**, en archivos separados.
Además de comparar tras la importación, otra JVM nueva reabre cada archivo y repite
el inventario, evitando confundir reconexión con reinicio real de H2.

H2 regenera algunos nombres físicos de índices auxiliares. Hubo una corrida
ampliada fallida al compararlos literalmente. Se documentó y corrigió la prueba:
para índices generados se comparan tabla/tipo/columnas/orden/uniqueness y constraints;
para índices explícitos se conserva también el nombre. No se ignoran índices.

Resultados finales: **8/8 verificaciones R2 y 23/23 tests previos**; cuatro dumps
positivos/restauraciones/reaperturas. 80 observaciones HTTP 200 por servicio, sin
errores observados. PID host, StartedAt, JVM startTime y RestartCount confirman
que los dos procesos fuente de prueba no se reiniciaron. No prueba ausencia de
safepoints: tiempos HTTP son observaciones, no medición exhaustiva de pausas JVM.

Negativos: guard del cliente y guard del agente rechazados sin marker; en dos
réplicas nuevas se introduce una escritura HTTP sintética durante una barrera de
4s después del inventario inicial. Ambas exportaciones se rechazan y quedan
cuarentenadas. Es una prueba determinista de detección, NO una demostración de que
el guard detecte toda carrera/ABA o de que SCRIPT sea snapshot global bajo tráfico.

## Archivos

- lab.mjs: verificación OCI, aislamiento y ensayo positivo.
- negative.mjs: guards y carreras controladas en réplicas distintas.
- NativeAgent.java, AttachClient.java, agent.mf: acceso runtime y exportación LAB.
- FixtureServer.java, Probe.java: JWT sintéticos/probes y carga sintética controlada.
- ArtifactInspect.java: dependencias/huellas del JAR real, sin imprimir propiedades privadas.
- RestoreNative.java: restore y reapertura en JVM independiente.
- GuardProbe.java y evidence.test.mjs: verificaciones de alcance/evidencia.

**La réplica no demuestra que los datos reales estén respaldados. R3 debe diseñar
un artefacto export-only sin seed y aprobar permisos, quiescencia, custodia y
presupuesto antes de cualquier extracción real. PAUSADO — esperando revisión.**
