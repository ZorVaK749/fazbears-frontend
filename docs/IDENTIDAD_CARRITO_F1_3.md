# F1.3 — identidad backend antes del carrito

Fecha: 12/11/2026. Base: `92cbbcad3eb8598266e9a117af3e1cc42a2ca94e`.
Rama: `ev3/identidad-carrito-f1-3`. Sin merge, imagen Docker ni AWS.

## Flujo implementado

1. Seleccionar la misma cuenta MSAL que F1.1 (activa, o única cacheada).
2. Encolar GET `https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api/carrito/me`.
   El interceptor MSAL existente adjunta Bearer. No se envía usuario elegido ni claims.
3. Recibir `{usuarioId, tenantId}`. Backend los deriva de oid/tid del access token
   validado, exige scope access_as_user y devuelve no-store; no accede a BD.
4. Validar forma de respuesta/segmento de URL y tenant == AZURE_TENANT_ID configurado.
   No exigir tenant de origen guest == tenant recurso ni localAccountId == oid.
   La forma frontend no prueba claims; el backend valida GUID/firma y autoriza.
5. Cargar `/api/carrito/{usuarioId}` y ejecutar escrituras FIFO solo después de
   identidad y carrito confirmados. El ID de respuesta de carrito debe coincidir.
6. Snapshot de checkout lleva usuarioId backend y tenantId local; el payload de
   Orden ya mapeaba snapshot.usuarioId y sigue sin enviar tenantId/metadata interna.

localAccountId/homeAccountId/tenantId de MSAL solo componen una clave local para
detectar cambios de cuenta; no eligen el propietario remoto. No se decodifican JWT
en Angular ni se usan ID tokens/claims del cliente como autorización backend.
Sin cambios en auth.config.ts, app.config.ts, interceptor, workflows o dependencias.

## Sesiones, errores y compatibilidad

Identidad privada solo en memoria y por sesión, sin localStorage ni parámetros
editables de propietario. Init/refresh simultáneos comparten cola; se resuelve /me
una vez por sesión, o de nuevo tras fallo previo a resolver identidad.
La cuenta MSAL y la sesión se verifican antes/después de await; logout/cambio cancelan
HTTP y cola vieja. Una respuesta ya entregada no dispara GET de otra cuenta.

Timeout 15s y cualquier error de /me (incluido 404 de backend antiguo) bloquean
carga/escrituras/checkout. No fallback a localAccountId/sub. ACTUALIZAR reintenta
lecturas y no reproduce acciones canceladas. Se preservan estado confirmado,
itemIds, FIFO, recuperación de errores y guardas de checkout/limpieza de F1.1.

Modificar el estado desde devtools nunca debe conceder acceso: backend conserva
comprobación tid/oid/scope/path en cada operación. /me no corrige autorización
pendiente del propio servicio Orden ni otros microservicios.

Datos: no migración automática. Claves históricas == oid siguen; claves con sub o
alias requieren reconciliación backend autorizada, no asignación por navegador.
Cambiar de tenant requiere aislamiento/migración, no aceptar todos los tenants.

## Pruebas/build ejecutados

- `npm ci --no-audit --no-fund`: lockfile existente, 387 paquetes; avisos de scripts
  pendientes sin aprobación global, sin dependencias/lockfile modificados.
- `npm test -- --watch=false`: **82/82, siete archivos**: los 59 escenarios F1.1
  conservados/adaptados al handshake + 21 de identidad + dos de checkout/Orden.
- `npm run build`: correcto; inicial 608,13 kB (budget 500), CSS checkout 5,04 kB
  (budget 4). Warnings visibles, presupuestos sin modificar.
- Ampliación de tests detectó un tipo inferido de categoria demasiado amplio en
  fixture; se tipó como Producto sin cambios runtime para resolverlo.

Incluye /me previo a GET/POST, deduplicación, ID distinto a localAccountId y tenant
de recurso distinto del de origen, cancelación y respuesta tardía ya entregada,
logout, 401/403/404/503/red/timeout, forma/tenant inválidos, recuperación explícita,
snapshot viejo y propagación del ID a Orden. HttpTestingController/MSAL/OrdenService
mock solo en tests; nada de compras reales, Azure o validación AWS.

## Despliegue futuro (no ejecutado)

Backend Carrito F1.3 primero, incluyendo F1.2; comprobar /me y preflight/rutas
Gateway/ALB con JWT. Después frontend. Si backend no tiene /me, UI se bloquea de
forma explícita en vez de usar un ID de cliente. Revisar preservación H2 antes del
reinicio y no confundir rollback de imagen con recuperación de datos/aliases.

Con autorización y cuentas de prueba: /me A/B → carritos respectivos, intentar A→B
rechazado; recarga/cambio de cuenta/error/sin token; confirmar identidad de entrada
a Orden con stub/DELETE aislado sin compra/eventos. Registrar digests/configs y
evidencia real de ambos antes de VALIDADO E2E. Contrato completo también en
`docs/IDENTIDAD_CARRITO_F1_3.md` del repositorio fazbear-carrito.

PAUSADO — esperando autorización. No Kafka, pagos, RabbitMQ o FazCoins ejecutados.
