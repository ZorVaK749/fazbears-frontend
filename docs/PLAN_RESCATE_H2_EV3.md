# Plan de rescate H2 — EV3

Fecha: 12/11/2026. **PROPUESTA + PROTOTIPO LOCAL; NO EJECUTADO CONTRA AWS.**
**Actualización R2:** extracción nativa ensayada en réplicas locales por digest
exacto, exclusivamente con fixtures. Ver sección 12. No se autoriza rescate real.
El usuario exige conservar los datos. **DESPLIEGUE BLOQUEADO** hasta aprobar un
método verificable. Ningún contenedor/JVM fuente se detiene, reinicia o modifica.

## 1. Dictamen

**Las APIs antiguas no permiten demostrar un respaldo completo y no invasivo.**
Se implementó un exportador parcial de pedidos propios y un ensayo de restauración
offline. No se ha recuperado ningún dato real. Un JSON, dos lecturas iguales o una
restauración exitosa de ese JSON **no equivalen a copia integral de H2**.

Bloqueos decisivos:

1. Carrito no lista todos los carritos y su GET llama a getOrCreate: consultar un
   usuario sin carrito puede **insertar** uno. No se enumerarán usuarios ni IDs.
2. Pedidos expone GET global sin autorización administrativa suficiente. Su
   existencia técnica no autoriza utilizarlo: **no se usará como bypass de respaldo**.
3. Lecturas propias no descubren usuarios/aliases desconocidos, filas huérfanas,
   objetos de esquema o high-water de identidades/secuencias.
4. Sin snapshot/quiescencia demostrados, dos servicios y lecturas separadas pueden
   representar instantes distintos. Aun dos lecturas idénticas no prueban completitud.
5. Falta vincular digest de imágenes activas con fuente exacta y versión H2 real.

## 2. Evidencia y límites de inspección

Situación **comunicada por usuario**, no inspeccionada directamente en AWS: ms-carrito
8083 y ms-pedidos 8082 activos; aparentemente H2 mem sin volúmenes/datasource externo;
Java 21 JRE Alpine, sin jcmd/jstack/jar, con unzip/wget/Docker. Configuración conocida:
jdbc:h2:mem:carritodb y jdbc:h2:mem:pedidosdb, Hibernate create-drop.

Fuentes candidatas inspeccionadas con git show, preservando todos los checkouts:

| Servicio | Referencia antigua | SHA |
|---|---|---|
| Carrito | ev3/ci-carrito de auditoría | 49fddca7d0819ea0ec8e4d5014293057d3a93eb1 |
| Pedidos | ev3/ci-pedidos de auditoría | e4438d1b6ba2c7e7eb6b622728e7d9abec1a7a88 |

Revisados controller, servicio y entidades; DTO de API serializa getters con IDs
de padre/hijo y omite relaciones inversas mediante JsonIgnore. Referencias de
auditoría no prueban el contenido del tag mutable ev3-test que esté ejecutándose.
Se necesita evidencia digest→artefacto→fuente, o inspección offline del JAR copiado
sin tocar el proceso. Etiqueta source sin revisión no basta para atribuir commit.

401 de /h2-console/ puede proceder del filtro Spring incluso para una ruta
inexistente. No demuestra consola registrada ni acceso SQL. No se la habilitará,
reiniciará o usará para eludir autorización. DB_CLOSE_DELAY=-1 tampoco da persistencia
entre procesos. JAR/rootfs/imagen no contienen automáticamente la heap de la JVM.

## 3. Endpoints y política de uso

| Ruta antigua | Lectura técnica | Decisión en este bloque |
|---|---|---|
| GET /api/carrito/{usuarioId} | Devuelve o **crea** carrito | No llamar; sin modo de exportación real de Carrito |
| GET /api/pedidos/usuario/{usuarioId} | findByUsuarioId, sin escritura observada en fuente | Solo oid propio derivado de JWT verificado, con autorización del dueño |
| GET /api/pedidos/{id} | Consulta por PK, sin ownership suficiente | No enumerar IDs ni usarlo para datos ajenos |
| GET /api/pedidos | Listado global sin control admin adecuado | No utilizar ni agregarlo al exportador |
| POST/PUT/DELETE de ambos | Mutaciones | Prohibidos; no sirven para exportar/restaurar la fuente |
| GET /api/carrito/me | No existe en fuente antigua | No asumir F1.3 desplegada ni usar fallback inseguro |

Incluso un ID de carrito aparentemente conocido necesita prueba de existencia y
ausencia de carreras para afirmar que ese GET no insertará. Sin una lectura SQL
independiente no existe esa prueba aquí; no se habilita opción de riesgo silenciosa.
No probar rangos, correos o IDs extraídos de otra API para descubrir carritos.

## 4. Matriz de recuperabilidad

“Recuperable” significa **si aparece en una respuesta completa autorizada** y si
se confirma que la versión desplegada corresponde. No significa ya recuperado.

| Datos | API propia Pedidos | Carrito | Limitación |
|---|---|---|---|
| PK padre/hijo | Sí: id en getters | Representados en DTO, pero GET no seguro | No regenerarlos ni pasarlos por Number IEEE-754 |
| usuario_id original | Sí para oid propio | Representado | No reasignar sub/alias/email a oid automáticamente |
| email de pedido | Sí, dato privado | No pertenece a Carrito | Guardar en respaldo cifrado, nunca logs/chat; no prueba identidad |
| total de pedido | Persistido, expuesto | total calculado | Conservar total persistido aunque difiera de suma; no certificar precio/pago |
| creado_en/fecha_creacion | Expuesto si existe | Representado | LocalDateTime sin zona; no inventar UTC ni sobrescribir con hora de importación |
| estado | Expuesto | No aplica | Fuente EV3 candidata tiene PENDIENTE/PREPARANDO/COMPLETADO; otra imagen puede incluir CANCELADO |
| ítems: producto/nombre/cantidad/precio | Sí, snapshot histórico | Representados | No sustituir por catálogo actual ni corregir negativos silenciosamente |
| FK padre-hijo | Se reconstruye desde nesting | Igual para archivo offline lícito | FK real se omite del JSON; no detecta hijos no serializados/huérfanos |
| pedidos sin usuario conocido/alias distinto | No descubribles | No descubribles | No hay universo completo de propietarios acreditado |
| carrito vacío de usuario desconocido | No | No descubrible | Enumerar por GET podría crearlo y fabricar evidencia |
| filas huérfanas/otras tablas/esquemas/LOB | No demostrable | No demostrable | Se necesita inventario SQL directo de origen |
| DDL, índices, constraints, usuarios/grants/settings | No | No | El esquema generado por herramienta es staging, no DDL extraído |
| contador real de identidad/secuencias | No | No | max(id)+1 ignora IDs eliminados y referencias históricas externas |
| registros eliminados antes del rescate | No | No | No confundir estado actual con historial completo/forense |
| transacciones abiertas/global snapshot | No | No | APIs ordinarias no exportan estado transaccional ni snapshot interservicios |

Si un enum de la imagen no puede deserializar un estado realmente almacenado, la
API puede fallar para toda una consulta. No convertir estados ni omitir ese usuario
para presentar un éxito parcial como completo. Guardar evidencia privada y detener.

## 5. Herramienta externa preparada

Archivos en tools/rescate-h2/: rescate.mjs, rescate.test.mjs, fixtures.mjs,
synthetic-roundtrip.mjs, RestoreSynthetic.java, README.md y .gitignore.
Sin cambios en microservicios, paquetes externos, publicación Git o imágenes.

### Exportación parcial recomendada, solo después de aprobar su ejecución

- Linux privado (CloudShell cliente) y Node.js 22+. Terminal sin grabación/xtrace;
  credenciales desde fuente privada legítima, **jamás en chat, argumentos o historial**.
- JWT introducido en prompt oculto, solo en RAM; no token en archivos/env/logs.
  JavaScript no garantiza borrado seguro de strings: host/sesión privados y proceso
  corto son requisitos, no protección contra un administrador del cliente.
- Verifica firma RS256/JWKS Microsoft, issuer, audience, tid, oid, scope delegado y
  tiempo. No se limita a decodificar JWT; no toma usuarioId del operador o del body.
- URL y destino de credenciales fijados al Gateway actual; rechaza redirects.
  JWKS se solicita sin Bearer. Solo GET propio de Pedidos, dos muestras sin retry.
- Directorio nuevo 0700/archivos exclusivos 0600; bytes UTF-8 exactos y SHA-256,
  hash canónico de tablas, conteos, instante de cada muestra y manifiesto parcial.
- 20 MiB/respuesta y timeout 15s. Fallo/tamaño/DTO inesperado/owner incorrecto/
  diferencia de muestras detiene sin fallback ni exposición de cuerpos/identidad.
  Preserva respuestas 200 ya guardadas y manifiesto fallido; no borra evidencia.
- Siempre completeBackup=false, globalCompleteness=UNPROVEN,
  snapshotConsistency=UNPROVEN y sourceCommitBoundToImage=false. No hay opción
  que convierta esas afirmaciones en respaldo completo.

Pasos de cliente **aún no ejecutados**, sin cambiar recursos AWS:

```bash
node --version
umask 077
install -d -m 700 "$HOME/rescate-h2-privado"
node tools/rescate-h2/rescate.mjs export-pedidos-propios --out "$HOME/rescate-h2-privado/pedidos-run-01"
```

El prompt recibe el JWT privado de ese mismo propietario. No usar curl con Bearer
literal, export JWT=..., tokens de terceros o archivos compartidos. No instalar
nada dentro de contenedores activos si faltan herramientas del cliente: detenerse.
Una cuenta no rescata por sí sola los datos de las demás. Múltiples extracciones
necesitan inventario autorizado y consolidación auditable posterior, todavía sin
prueba global. La herramienta prepara una muestra a la vez, no fusiona corridas.

### Custodia fuera del laboratorio

Los JSON/SQL contienen datos personales aunque los logs no. No Git, chat, buckets
públicos ni discos compartidos. Cifrar el conjunto mediante herramienta aprobada
con passphrase ingresada de forma privada (no argumento/env); conservar al menos
dos copias verificadas en dominios de fallo distintos y una fuera de AWS Academy.
No publicar ni crear infraestructura para esto sin autorización específica.
CloudShell HOME, volumen EBS y snapshot en la misma cuenta no son por sí solos
garantía contra cierre/reset del laboratorio. Verificar descifrado/hash desde otra
copia antes de depender de ella. No borrar originales/temporales sin aprobación.

## 6. Restauración offline propuesta y ensayo realizado

1. Mantener originales privados e inmutables; comparar hashes antes de preparar.
   Registrar qué muestra/corrida se usa y revisar manifiesto/diferencias de lecturas.
2. Preparar SQL en destino nuevo con modo parcial explícito:

```bash
node tools/rescate-h2/rescate.mjs prepare --kind pedidos --dialect h2 --input /ruta/privada/pedidos.sample-1.json --out /ruta/privada/staging-plan-01 --accept-partial
```

Alternativa dialect postgres. kind carrito solo acepta **archivo offline obtenido
lícitamente**, no hace GET Carrito ni convierte un origen desconocido en fiable.
El prototipo no autentica la procedencia de un archivo arbitrario: aprobación y
cadena de custodia siguen siendo necesarias. Genera restore.sql, verify.sql y
manifest.json sin ejecutarlos ni conectarse a una BD.

3. SQL crea tablas nuevas, sin DROP/IF NOT EXISTS/MERGE/UPDATE: si ya existen,
   falla en vez de mezclar/sobrescribir datos. BD nueva por servicio, sin red ni
   aplicación conectada, nunca datasource de producción. H2 DDL puede confirmar
   implícitamente: ante fallo, dejar staging identificado como incompleto, no
   presentarlo como transacción integral ni reintentar sobre una BD usada.
4. Importar directo por JDBC/SQL, no REST/JPA: conservar PKs, timestamps, estado,
   nulos y snapshots; reconstruir FK desde nesting sin fabricar información.
   Parser exacto para Long/NUMERIC, claves duplicadas o campos nuevos no se ignoran.
   Rechaza dinero/Unicode/fecha no representable sin truncamiento silencioso.
5. Verificar todos los campos de cada fila, counts de padres/hijos, PKs únicas,
   FK/no huérfanos, decimales, fechas, estados y total derivado del carrito. Guardar
   solo resultados/conteos/hashes saneados en informe, no contenido privado.
6. Las secuencias se ajustan a max visible+1 **solo para staging**. No equivale a
   high-water original y puede reutilizar IDs eliminados/emisiones históricas.
   Bloquear promoción hasta recuperar/verificar contadores o aprobar otra política
   de IDs con compatibilidad demostrada. No cambiar IDs originales para ocultarlo.
7. Cerrar/reabrir el destino persistente y repetir verificaciones; ensayar luego
   arranque de una copia aislada del microservicio con ddl-auto=validate (nunca
   create/create-drop), driver/dialecto correctos y sin side effects externos.
   Ese arranque JPA de migración y PostgreSQL real **no se probaron en este bloque**.

**Pruebas locales efectivas:** 23/23 tests Node con HTTP/JWKS simulados y claves
efímeras; dos BD H2 archivo nuevas con datos solo sintéticos, importadas y reabiertas
con Java 21/H2 2.4.240. Se verificaron todos los campos, PK/FK, siguientes IDs de
padres/hijos, rechazo de huérfano y persistencia. Incluyen IDs >2^53, decimales,
comillas/backslash/Unicode, CANCELADO, nulls, alias y carrito vacío. Nada de attach:
el harness inicia su propia JVM local y rechaza targets fuera de su protocolo sintético.

Comandos ya ejecutados localmente:

```text
node --test tools/rescate-h2/rescate.test.mjs
node tools/rescate-h2/synthetic-roundtrip.mjs RUTA_LOCAL_H2_2.4.240.jar
```

SQL PostgreSQL se generó y se probaron reglas de representación, pero no se ejecutó
contra PostgreSQL. Windows solo se usó con fixtures; ACL/confidencialidad de datos
reales en Windows no certificadas. Ni el JAR ni las versiones locales prueban las
versiones del contenedor activo. Artefactos sintéticos quedan locales/ignorados.

## 7. Destinos provisionales

| Criterio | PostgreSQL | H2 archivo persistente |
|---|---|---|
| Preferencia | Objetivo recomendado para operación y respaldos | Puente provisional si restricciones Academy lo exigen |
| Almacenamiento | RDS si permisos/costo permiten, o instancia/volumen dedicado con respaldo | Archivo fuera del contenedor en volumen persistente, un dueño por BD |
| Concurrencia/operación | Mejor para varias conexiones, herramientas de administración/backup | Embebido/locks, no compartir alegremente archivo entre procesos |
| Restauración | NUMERIC exacto; TIMESTAMP hasta microsegundos; validar DDL/secuencias | Misma versión H2 al importar primero; TIMESTAMP(9) en staging conserva nanos |
| Backup posterior | pg_dump con esquema/datos/secuencias y restore ensayado; opciones físicas/WAL según infraestructura | SCRIPT lógico mediante conexión autorizada o backup soportado para BD archivo; copia consistente, no cp de archivo caliente |
| Riesgo Academy | Permisos, red privada, storage y costos por verificar | Menos componentes, pero pérdida de host/volumen/lab sigue destruyendo sin copias independientes |
| App futura | Sobrescribir URL/driver/dialecto H2 histórico; ddl-auto=validate | URL jdbc:h2:file: en volumen, driver H2, ddl-auto=validate |

Ningún destino resuelve datos que no se exportaron. Un volumen no es backup y
ninguna migración debe mantener create-drop. Contraseñas por mecanismo privado,
nunca flags visibles/código/chat/logs. No se creó RDS, contenedor, volumen o BD AWS.

## 8. Criterios para afirmar conservación completa

Para **cada** JVM/BD fuente hacen falta, bajo snapshot/protocolo consistente:

- Identificación cierta de BD activa/DataSource, versión H2, esquema y fuente
  desplegada; inventario completo de tablas/esquemas/columnas/tipos/constraints/
  índices/relaciones/secuencias y metadatos que se decida conservar o excluir.
- Recuento y conjunto de PK de **todas** las tablas, no solo usuarios conocidos;
  sumas de control canónicas por fila/tabla y tratamiento de nulls/decimales/LOB.
- Datos huérfanos/desconocidos/aliases, estados e históricos conservados o anomalías
  explicitadas sin filtrado silencioso. Si se excluyen metadatos/cuentas/settings,
  no llamarlo copia integral de H2; especificar “datos de negocio” y exclusiones.
- Contadores de identidad reales y reglas de no reutilización verificadas, no
  solo max(id); custodia cifrada, hashes origen/copia, dos copias y restauración
  independiente con comparación total de campos/counts/PK/FK/secuencias.
- Ventana temporal y escritores identificados (HTTP, incluido GET getOrCreate,
  llamadas internas, jobs,
  consumers si existen). Quiescencia o snapshot nativo validado para versión exacta;
  dos JSON iguales/counts iguales sin universo independiente no bastan.
- Verificación coordinada interservicios: referencia temporal y relaciones con
  órdenes/eventos/reportes. Dos snapshots individuales no son una transacción
  distribuida ni certifican que no haya una compra parcialmente procesada.

**Hoy no se dispone de esas evidencias.** No se puede demostrar que no faltan
registros con APIs autorizadas disponibles. El exportador siempre lo declara.

## 9. Extracción desde la JVM activa — SOLO análisis, no ejecutable autorizado

La H2 mem vive dentro de la JVM y puede estar asociada a su classloader. Lanzar
otra JVM con el mismo jdbc:h2:mem:carritodb/pedidosdb abre otra BD vacía, no la
existente. Incluso un agente con otra copia del driver podría usar otro engine:
hay que llegar al **DataSource ya existente** y demostrar identidad de la BD.

| Alternativa | Evaluación y límite |
|---|---|
| Interfaz SQL de administración ya existente y legítimamente autorizada | Solo candidata si se acredita que existe y conecta a esta BD, no otra; hoy no demostrado |
| Agente/attach que use DataSource Spring ya existente | Podría ejecutar exportación lógica nativa y metadatos; exige código revisado, permisos, ensayo con misma imagen/JDK/H2 y nueva autorización invasiva |
| Heap dump/debugger/gdb | Pausas/GC/OOM y exposición de JWT/contraseñas/PII; reconstrucción no garantiza integridad relacional ni snapshot; no recomendado como backup rutinario |
| Docker checkpoint/CRIU | Disponibilidad/privilegios/compatibilidad inciertos y puede suspender proceso; no autorizado ni sustituto de backup lógico probado |
| Docker commit/export/copy JAR o tools.Script en otra JVM | No capturan BD mem activa; no son solución de datos |

No se instaló/copió herramienta dentro de contenedores, hizo attach, cargó agente,
abrió puerto TCP H2, depuró, envió señales ni modificó flags del proceso.
No se usarán rutas de ejecución arbitraria o consola insegura para conseguir SQL.

H2 documenta SCRIPT como exportación lógica de BD: puede devolver filas al cliente
sin archivo dentro del contenedor; **requiere derechos admin y bloquea objetos**.
No lleva implícita una prueba de snapshot global entre servicios. TABLE/SCHEMA/
NODATA/NOSETTINGS/NOPASSWORDS cambian lo incluido; cuentas/hashes/settings de un
dump nativo son secretos o metadatos que deben custodiarse/contabilizarse, no logs.
Fuente consultada: https://h2database.com/html/commands.html#script.

BACKUP TO respalda archivos y log de una BD persistente; no asumirlo aplicable a
una mem sin archivos ni ejecutarlo desde otra JVM. Revisar versión exacta:
https://h2database.com/html/commands.html#backup.

Si se propone agente en otro bloque: reproducir exactamente imagen/JDK/H2 local,
ensayar carga/locks/memoria/concurrencia, revisar comportamiento de SCRIPT y
consistencia de su versión, restringir operaciones y salida cifrada, no loguear
DataSource/credenciales y aprobar riesgos de pausa/OOM/privacidad. El hecho de no
tener jcmd/jar en JRE no autoriza improvisar attach desde host ni reiniciar con JDK.
Se detiene la ejecución de esa vía hasta autorización explícita y método aprobado.

## 10. Pasos recomendados para CloudShell — sin ejecutarlos

1. Mantener vivos ambos procesos y no iniciar despliegue. No docker restart/stop/
   compose up, prune, reemplazo de imágenes, señales o cambios datasource/DDL.
2. Con aprobación, recopilar **solo evidencia saneada** de identidad de imagen:
   image ID/RepoDigest/labels de revisión y mounts. No imprimir docker inspect
   completo, environment, command line o logs con posibles secretos/PII en el chat.
3. Si hace falta contrastar código, copiar JAR existente hacia carpeta privada del
   cliente y examinarlo **offline**, sin modificarlo ni ejecutarlo. unzip ayuda a
   identificar BOOT-INF/lib/h2-* y clases; no exporta datos. Guardar hashes/revisión.
4. Revisar inventario de propietarios legítimos y fuentes privadas de credenciales.
   Aprobar exportación propia parcial si aporta valor; no declararla total ni usarla
   como autorización para acceder a otros usuarios/global/Carrito mutante.
5. Ejecutar exclusivamente cliente revisado con prompt oculto, salida privada,
   transferencia cifrada y validación fuera del lab; no instalar herramientas en
   fuente ni publicar archivos. No hacer compras para generar/verificar registros.
6. Decidir si se requiere extracción nativa y someter plan invasivo a autorización
   separada. Ninguna extracción nativa/protocolo de quiescencia/AWS ejecutados aquí.
7. Ensayar restauración en entorno nuevo aislado y cumplir criterios de sección 8.
   Solo entonces considerar aprobación de conservación y despliegue coordinado.

## 11. Estado y siguiente decisión

| Nivel | Resultado |
|---|---|
| IMPLEMENTADO LOCALMENTE | Exportador limitado/SQL offline/ensayo sintético |
| PROBADO LOCALMENTE | 23 tests y dos H2 archivo sintéticas, sin APIs reales |
| DATOS REALES EXPORTADOS | Ninguno en este bloque |
| BACKUP COMPLETO DEMOSTRADO | No |
| POSTGRESQL RESTAURADO | No; SQL propuesto y reglas probadas, no motor |
| PUBLICADO / CAMBIOS AWS / JVM ACTIVA | No / No / Ninguno |
| DESPLIEGUE AUTORIZADO POR ESTE PLAN | No; bloqueado por conservación pendiente |

Próximo bloque propuesto: revisar este dictamen y evidencia digest/artefacto; elegir
un acceso nativo legítimo o aprobar el diseño/ensayo invasivo **sin ejecutarlo aún**.
La recuperación parcial puede ser defensa adicional, no sustituto del criterio de
conservación acordado. No continuar el despliegue con una promesa de completitud.

**PAUSADO — esperando autorización.**

## 12. R2 — ensayo aislado de extracción desde JVM activa (12/11/2026)

### Alcance y correspondencia de artefactos

Nueva autorización: Docker/JDK/instrumentación **solo local con datos sintéticos**.
No AWS/SSM/JVM reales, publicaciones de imágenes, compras, brokers o datos reales.
El bloqueo original de APIs permanece vigente. La autorización de R2 no habilita
ejecutar el agente en producción; el artefacto entregado se niega fuera del lab.

Se descargaron y verificaron índices OCI y su manifest linux/amd64:

| Servicio | Índice OCI ghcr.io/zorvak749/...@sha256 | Manifest plataforma | Config/Image ID comunicado por usuario, verificado |
|---|---|---|---|
| fazbear-carrito | 99274a38c2cb1cf0529b51b8fbfdb06653a12338afbf5c5967e5d6b8cea98d6d | 3e969f37aad7e5feb62698fb78fd11f86f6c75bbf9e54b99d459e03e0a679f7e | c09d17290bcc75af510f6ca5d036c23b62add0a35cd3c495a2ceb27a868cd277 |
| fazbears-pedidos | c6a51819a39b8766f05bbbe26e14acc8eb442cf6761f57e38f3f9427b46ab6cc | 531ee6bc3eac2bfad10c4ae50269d5678b80d7f4333df10d925108677a740536 | e8d04e02bf3b1b212884ed454cbf38b2e5a77971f23d9d9b1db76e06f681cd64 |

Docker Desktop 29.7.2/containerd muestra el digest del índice en inspect .Id. No se
confundió con el config digest: se recorrió índice→manifest amd64→config y coincide
exactamente con los IDs aportados. Arquitectura linux/amd64; fechas imagen Carrito
2026-11-10T16:17:18Z y Pedidos 2026-11-10T16:32:36Z. Sin label revision; **no se
atribuye un commit Git antiguo por conjetura**. Se probó el JAR de la imagen, no uno
recompilado desde repositorio. La evidencia AWS original sigue siendo del usuario;
esta fase solo accedió a GHCR y Docker Desktop local.

JAR inspeccionado offline: Boot 4.1.1, Spring Context 7.0.9, HikariCP 7.0.2 y H2
2.4.240; configuración mem/create-drop confirmada en esos artefactos. Huellas:

- app.jar Carrito: 660b413e39f2ed2c6888572cf7ba4afc33ae691a9988b8dc4e35b4f8c2976658.
- app.jar Pedidos: fea0ed9263ff3dea5241b39f4c1efe4a76a57614ee98676d620098911d6d87c5.
- h2.jar de ambas: 29b70e427cc1c40cdc376283adbb0cc62853073797bb5fe5761f81fe73d57ce0.

### Laboratorio y mecanismo ensayado

Docker inicialmente estaba apagado; el usuario lo inició tras revisar otras cargas.
Se verificó endpoint npipe local desktop-linux. Ningún contexto SSH/TCP remoto o
AWS se utilizó. Cada réplica nueva: network none, sin puertos publicados, rootfs
readonly, cap-drop ALL, no-new-privileges, 1 CPU, 768 MiB sin swap adicional,
128 pids y tmpfs /tmp 64 MiB. No privileged ni PID host.

Main PID 1 ejecuta **JRE original** /opt/java/openjdk/bin/java, 21.0.13+9-LTS,
con app.jar intacto. JDK musl 21.0.13 auxiliar, readonly en /r2-jdk, obtenido de
eclipse-temurin@sha256:82801f9dcdcbad5a05082aba8c86d1da5b72ccb498e71318b1f91b5a477887b3.
No se reemplazó el JRE ni se reconstruyeron/publicaron imágenes. Compilador host
Java 21.0.12.1, clases release 21. El montaje permite ejecutar jcmd/Attach API
dentro del mismo UID/namespace sin añadir capabilities de ptrace.

La réplica usa un proveedor JWT **sintético** en 127.0.0.1 de su namespace para
discovery/JWKS; issuer/audience configurados a él, claves RSA solo RAM. El decoder
original valida firma: comprobación 401 sin JWT, 200 con JWT fixture. No se
desactivó seguridad ni se contactó Azure. El provider de fixture no existe en AWS.

AttachClient carga NativeAgent en PID 1 y hace detach al terminar. Instrumentation
solo enumera clases cargadas; sin transformer/redefinición. Acceso reflexivo a
SpringApplication.shutdownHook.contexts de Boot 4.1.1 → contexto único → bean
dataSource ya existente. Confirmados HikariDataSource, LaunchedClassLoader y URL
mem esperada. **No crea otra H2/driver ni confunde otra JVM con la BD activa**.

El agente exige marker+UUID+entorno SYNTHETIC_ONLY, incluso antes de enumerar clases.
seed se permite solo para base vacía del lab. Export usa esa conexión y ejecuta
SCRIPT NOPASSWORDS, streaming de filas SQL a archivo exclusivo y checksum. No
INSERT/UPDATE/DDL de origen en modos export/check. Se probó además jcmd 1 VM.version;
jcmd por sí solo no exporta tablas. Nada de heap dump, debugger o GC forzado.

### Datos, comparación y resultados

Por servicio: 3 padres, 2 hijos; IDs con huecos, usuario propio/alias desconocido/
padre vacío; tipos/estados/fechas/nulos/snapshots históricos. Schema auxiliar
R2_EXTRA con tabla UNMAPPED de 2 filas, CLOB/BLOB/null, ID mayor a 2^53 y campo
histórico CANCELADO; vista, índice explícito y secuencia propia. CANCELADO auxiliar
no significa que el enum antiguo Pedidos se haya cambiado o lo soporte.

Inventario enumera todas las tablas de usuario de esta BD, incluyendo las no
mapeadas por JPA; hashes de todas las celdas/filas, tipos/tamaño/escala/default/
nullable, PK/FK, constraints/checks/vistas/índices. Se preservan bases identity
1001/2001 aunque los max visibles son 41/31; secuencia independiente base 27,
incremento 5. No se usa max(id)+1 como sustituto del contador real.

Cuatro dumps positivos (dos por servicio), cada uno restaurado con el driver H2
extraído de la imagen en un archivo nuevo; otra JVM nueva reabre y repite inventario.
Esto evita confundir una reconexión con cierre real de H2 al usar DB_CLOSE_DELAY.
Sin arranque JPA create-drop sobre el destino ni conexión a bases productivas.

| Evidencia final | Carrito | Pedidos |
|---|---|---|
| Tablas/filas de usuario | 3 / 7 | 3 / 7 |
| Dumps restaurados/reabiertos | 2 / 2 | 2 / 2 |
| Tamaño SQL | 2340 bytes | 2510 bytes |
| SHA-256, ambos dumps de cada servicio iguales | bd108a13664475fd449e33f0940af843ea081259fe1a3a6d2e40d990fdab5060 | 53b890b4bf3ebaf3f704194a1dbd738ab94a9b9ece0eb649849029143b0d5b54 |
| Tiempo export+inventarios, ms | 81 / 27 | 163 / 92 |
| HTTP autenticados correctos durante ventana | 80 de 80 | 80 de 80 |
| Máxima latencia HTTP observada, ms | 212 | 218 |
| RestartCount | 0 | 0 |
| Host PID antes/después | 3617 / 3617 | 4312 / 4312 |
| RuntimeMXBean startTime antes/después | 1794505208220 / 1794505208220 | 1794505265771 / 1794505265771 |
| Container StartedAt invariante UTC | 2026-11-12T17:40:05.906622447Z | 2026-11-12T17:41:03.517879009Z |

Contenedores positivos finales: r2-5cf8cbee-carrito y r2-5cf8cbee-pedidos. Se
mantienen vivos, con datos fuente iguales después de exportar/restaurar/verificar.
HTTP observado no prueba ausencia de safepoints ni da cota universal de pausas:
no hubo medición exhaustiva de GC/safepoints y el fixture es pequeño.

**Pruebas finales:** 8/8 verificaciones offline R2 y 23/23 tests previos; ensayo
previo de dos H2 archivo también reejecutado. Reporte positivo local
tools/rescate-h2/artifacts/r2-run-L4oUs5/report.json. No contiene datos reales.

Pruebas fallidas/rechazadas, no ocultadas:

- Una corrida ampliada rechazó el restore por nombres físicos distintos de índices
  auxiliares generados por H2. Las filas/IDs/constraints coincidían. Se corrigió la
  comparación **sin ignorar índices**: tabla/tipo/columnas/orden/uniqueness para
  índices generados, además nombre para índices explícitos. Los nombres auxiliares
  generados no se prometen idénticos; esquema lógico sí se compara.
- Guards cliente/agente sin marker rechazados antes de acceder a Instrumentation.
- Dos réplicas negativas nuevas recibieron una escritura HTTP de fixture durante
  barrera controlada de 4s entre inventario inicial y export. Ambas exportaciones
  se rechazaron (sourceUnchanged=false); SQL quedó cuarentenado, no respaldo válido.
  Procesos de esas réplicas también siguieron vivos y sin restart. Reporte local
  r2-negative-f9SuSq/report.json. La carga solo alteró fixtures de réplicas negativas,
  no los contenedores positivos ni AWS.

La comparación antes/después **no detecta necesariamente ABA ni toda carrera**.
No se afirma snapshot global consistente bajo escritores arbitrarios. SCRIPT
bloquea objetos; el ensayo positivo tuvo lecturas HTTP y ningún escritor después
de seed. No transformar este resultado en permiso para rescatar tráfico real vivo.

### Reproducibilidad y alcance de retirada

Código bajo tools/rescate-h2/r2/, instrucciones en su README. lab.mjs y negative.mjs
solo aceptan Docker Desktop Windows local; no existe modo CloudShell/producción.
Sus artefactos SQL/DB/JAR/reportes no se publican. Publicación de fuente/documentación
en rama específica del frontend, sin cambiar aplicación/workflows ni fusionar.

vm.detach no descarga clases de agente ni elimina Attach Listener. No hay
transformers/threads propios de agente que retirar; JDBC y streams se cierran.
El proceso auxiliar de JWT es exclusivo del lab. No cleanup automático; quedan
réplicas y artefactos para revisión, incluso evidencia fallida. Retirada selectiva
de recursos locales identificados por label requiere decisión del usuario; nada
de prune, señales, stop/restart o eliminación de datos reales.

### Propuesta R3 para CloudShell/SSM — NO ejecutada ni autorizada por R2

**No copiar/cargar este agente de seed en AWS, ni reiniciar para añadir markers.**
Hace falta diseñar/revisar un artefacto export-only sin seed ni SQL arbitrario,
con aprobación/nonce, whitelist de proceso/imagen/JAR/DataSource y mecanismo de
custodia, ensayado antes de autorizar extracción real. Los siguientes son criterios
de propuesta, no comandos listos para ejecutar contra JVM reales.

1. **Preflight:** verificar con usuario/SSM digest/config/plataforma/JAR hash,
   JVM/runtime/PID/StartedAt, pool/DB exacta y classloader; contexto Spring único;
   attach no deshabilitado; sin confiar en etiquetas mutables o nombre de BD solo.
   Si no coincide algo, cancelar. No reiniciar ni desactivar flags para habilitarlo.
2. **Permisos mínimos:** operador SSM autorizado y acceso Docker (equivale a privilegio
   alto del host); ejecución en mismo UID/namespace de la JVM, JDK musl/arquitectura
   compatibles. En el lab no fueron necesarios privileged, PID host, ptrace o
   puertos admin. No concederlos en producción como parche si falla.
3. **Fase inventario/presupuesto separada:** aprobar primero consulta restringida de
   metadata/counts/counters de la BD viva. Medir heap/headroom, RAM/cgroup, disco
   libre y tamaño estimado, LOBs/esquemas/objetos no probados. El lab usó dump <3KiB;
   32MiB salida/timeout 20s NO limitan necesariamente la memoria interna del comando
   SCRIPT. No extrapolar el éxito ni ajustar -Xmx del proceso real (requeriría restart).
   Sin presupuesto razonable y restore ensayado, cancelar antes de carga/export.
4. **Consistencia:** aprobar ventana de quiescencia de TODOS los escritores, incluyendo
   GET Carrito getOrCreate, Orden, tareas/consumidores y clientes. No basta pausar UI.
   Gate temporal de ingreso/canales sería cambio AWS/operativo y requiere nueva
   autorización. Mantener JVM vivas, no purgar/republicar RabbitMQ. Si no puede
   acreditarse quiescencia o protocolo snapshot validado, no declarar conservación.
5. **Pausas/riesgo:** attach y enumeración de clases pueden requerir safepoints;
   SCRIPT toma locks y puede aumentar heap/GC/latencia/OOM. El query timeout no es
   cancelación dura garantizada. Monitorizar estado con umbrales previamente
   aprobados; no matar JVM o usar GC/heap dump para solucionar bloqueo. Abortos
   seguros antes de attach/export son preferibles a una interrupción tardía.
6. **Salida privada:** acordar un directorio nuevo 0700/archivos 0600 en host/cliente
   o canal restringido compatible con el contenedor actual. No se puede agregar un
   volumen a un contenedor vivo recreándolo. Cualquier copia transitoria de agente/
   salida en filesystem requiere permiso explícito futuro, nunca reemplazar app.jar.
   Prohibidos SQL/PII/credenciales en logs/chat/Git. Cifrar con claves privadas fuera
   de argumentos/historial; dos copias verificadas y una fuera de AWS Academy.
7. **Qué conservar:** inventario completo de tablas/campos/PK/FK/constraints/índices/
   vistas/secuencias/identidades y excepciones. SCRIPT NOPASSWORDS excluye contraseñas;
   si se pide autenticación/settings íntegros, definir exportación/custodia adicional
   y no llamar al resultado copia integral sin ellas. R2 no prueba triggers/cifrado/
   extensiones/volúmenes de datos arbitrarios, transacciones abiertas o bases H2
   adicionales. Un respaldo lógico recoge el estado comprometido, no la heap completa.
8. **Restore:** verificar SHA-256 en origen/copia/descifrado, restaurar en BD nueva
   aislada con misma H2 primero, sin app ni create-drop; comparar todas las tablas,
   valores/IDs/relaciones/tipos/objetos/contadores; reabrir en JVM independiente.
   Después evaluar migración PostgreSQL y app con ddl-auto=validate. No importar
   por APIs que regeneren IDs/fechas ni emitir eventos como parte del rescate.
9. **Postflight:** source JVM startTime/PID/StartedAt/RestartCount sin cambios,
   inventario/fingerprint/counters estables, salud autorizada y JDBC devuelto al
   pool. Archivos incompletos o fingerprints diferentes quedan cuarentenados;
   igualdad antes/después complementa, no sustituye quiescencia/snapshot.
10. **Cancelar/no aprobar** ante ID/versión/pool inesperados, múltiples contextos no
    previstos, permisos insuficientes, memoria/espacio desconocidos, escrituras
    persistentes, fallos de checksums/restore, latencia/bloqueo/OOM o incertidumbre
    de custodia. Detach no revierte clases cargadas; no prometer retirada sin huella.
    Rollback de imagen no recupera H2 ni justifica detener la JVM fuente.

**Resultado R2:** mecanismo nativo restaurable probado para ambos fixtures en
imágenes exactas. **Datos reales respaldados: NINGUNO.** El despliegue y el rescate
real siguen bloqueados hasta nueva autorización y aprobación del protocolo R3.

**PAUSADO — esperando revisión.**
