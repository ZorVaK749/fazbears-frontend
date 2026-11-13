# Integración Angular EV3

## Ejecución local

- Node 22.22.3+ o 24.15+ (validación local/CI: 24.19.0), npm y `npm ci`.
- Levantar el gateway del stack coordinado en `http://localhost:18090`.
- `npm run start:local` sirve Angular en `http://localhost:4200`; `/api/**` se reenvía a ese gateway mediante `proxy.conf.json`.
- `npm start` y `npm run build` conservan la URL AWS Gateway original. No se hicieron llamadas ni despliegues AWS.
- `API_BASE_URL` es el token DI compartido por todos los clientes HTTP. Los entornos seleccionan la URL y el mismo origen protegido por MSAL. El mapa local usa exclusivamente el origen del navegador + `/api`, no un comodín de hosts.
- Sigue siendo obligatorio iniciar sesión con Entra. El URI localhost debe estar registrado en la aplicación existente. No hay bypass de tokens, usuarios locales, ni JWT artificiales en localStorage.

Docker opcional: `docker build -f Dockerfile.local -t fazbear-frontend:local .`; conectar al mismo network del gateway con nombre de servicio `gateway` y puerto interno `8080` (ajustar `nginx.local.conf` si el stack usa otro). Publicar el puerto 80 del contenedor en localhost. El Dockerfile original de producción no cambia.

## Flujos

- Catálogo consulta `GET /api/recomendaciones/me?limit=6`; muestra estrategia, razón y fecha del backend. FALLBACK_POPULARITY/CATALOG se identifica como alternativa, no personalización. Un error remite al catálogo general sin inventar resultados. Abrir un nombre registra VIEW; añadir registra SELECT. Solo `{tipo}` en el cuerpo, mediante HttpClient/MSAL.
- Perfil y checkout consultan saldo, movimientos y recompensas reales. El canje digital usa Idempotency-Key y `{recompensaId,cantidad:1}`. No constituye pago ni descuento monetario. Se informan 422 y 409; errores inciertos mantienen la clave y contenido original para reintento explícito.
- Checkout espera la cola FIFO y `/carrito/me` recuperados; cotiza únicamente IDs y cantidades. No envía propietario/email/precios del navegador para cotizar o pagar. Solo instrumentos `sim-approved` / `sim-declined`; sin captura de PAN, CVV u otros datos de tarjeta.
- Cotización → POST pagos (`SIMULADO`) → **solo APPROVED** permite confirmar-pago. DECLINED 201 y BLOCKED 429 no confirman ni limpian carrito. La pantalla señala pago simulado y ausencia de cargo real.
- Reintentos explícitos tras red/503/timeout reutilizan la misma cotización y las mismas claves/contenido, incluso si se cambia el selector por código. Confirmación incierta reenvía solo confirmar-pago con la misma clave. No hay retry automático de escrituras. Nuevo intento solo descarta un rechazo/bloqueo definitivo.
- Pendientes en memoria del servicio raíz: sobreviven navegación dentro de la SPA, no recargas completas. Tras recargar con resultado incierto, comprobar el historial de la cuenta original antes de volver a pagar; no se promete recuperación persistente. Nunca se almacena material de autenticación adicional ni datos bancarios.
- Respuestas tardías y nuevos writes se guardan con identidad/sesión; no muestran datos de la cuenta anterior. Confirmación solo limpia el snapshot vigente, nunca un carrito modificado posteriormente. Se mantienen F1.3/F1.4 y administración cerrada.

## Validación y límites

Angular actualizado a 22.2.6 y herramientas 22.2.7, dentro de la misma rama mayor,
para corregir vulnerabilidades de dependencias detectadas durante integración.
121 tests aprobados, builds normal/local correctos; npm audit final sin hallazgos.
Build productivo conserva advertencia de presupuesto inicial (aprox.611kB vs500kB),
no se amplió el presupuesto para ocultarla. No es bloqueo de build ni prueba de AWS.

`npm test -- --watch=false`, `npm run build`, `npm run build -- --configuration local`.

Tests con Angular TestBed y HttpTestingController: contratos HTTP, sincronización de carrito, /me, cambios de cuenta, respuestas tardías, aprobación/rechazo/bloqueo, reintentos idempotentes, ledger/canjes, UI de recomendaciones/fallback. No son validación de un navegador contra Azure Entra real ni E2E contra el stack; esos recorridos dependen de registro/credenciales reales y del harness coordinado externo. CI de esta rama solo tests/build, sin publicar imágenes.
