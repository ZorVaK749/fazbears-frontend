# F1.4 — Perfil/Historial con identidad compartida y sin admin por email

Fecha: 12/11/2026. Base F1.3: `9f1a11e353c930a60c1403aad45a413477895ba9`.
Rama `ev3/identidad-pedidos-f1-4`; sin merge/imágenes/AWS.

Carrito expone señal readonly de identidad ya resuelta por /api/carrito/me, con
oid/tid y número local de sesión; solo se publica después de verificar sesión y
respuesta. Al cerrar/cambiar cuenta se elimina antes de cancelar operaciones.
El método esIdentidadActual comprueba también la cuenta MSAL actual. No nuevo /me,
servicio de identidad paralelo, JWT decodificado en cliente ni ID remoto localAccountId.

MisPedidosService (singleton) consume esa señal y comparte una consulta propia
GET /api/pedidos/usuario/{oid} entre Perfil e Historial. No solicita GET global ni
filtra una lista global descargada. Ambos usan estado por signals, sin detectChanges
tardío sobre vistas destruidas. Las respuestas se validan contra el owner esperado.

Cambio de identidad cancela GET/PUT anteriores, limpia lista/error/procesando y
descarta callbacks de otra generación/sesión. Revalidar al volver a las pantallas
no repite /me ni carga ya pendiente. ACTUALIZAR explícito y timeout 15s en pedidos;
errores no se presentan como historial vacío confirmado. /me fallido bloquea sin fallback.
Carrito puede fallar cargando su contenido sin impedir consultas propias si /me
ya obtuvo identidad válida. Datos no se cachean entre sesiones ni en localStorage.

Cancelación propia PENDIENTE: un PUT pendiente por id, sin éxito optimista, misma
respuesta actualiza Perfil e Historial; fallo no reenvía. ACTUALIZAR lee estado
real si el resultado fue incierto; cancelar suscripción no revierte un PUT aplicado.
No cancela IDs no cargados/ajenos/terminales desde la UI; backend es la autoridad.

Se quitan las cuatro listas ADMIN_EMAILS de Perfil/Historial/Navbar/Reportes.
Sin política/app roles Azure verificados, esAdmin=false y administración cerrada;
no se inventa autorización leyendo roles del ID token. Reportes no solicita API
ni concede acceso por email, incluso invocando cargar; las rutas/backend Reportes
no se modifican ni se declaran seguros por esta barrera de presentación.
Acciones PREPARAR/COMPLETAR/ELIMINAR no están disponibles; backend Pedidos las
deniega hasta nuevo bloque de roles. No anunciar funcionalidades admin restauradas.
Los cambios históricos siguen conservados en las referencias Git anteriores.

Checkout y tipos/servicio Orden **sin cambios**. Continúa snapshot F1.3 usuarioId=oid;
no se modificó ms-orden. La política del POST Pedidos mantiene JSON/Bearer delegado
para el propietario y rechaza usuarioId falso antes de persistir. No valida pago,
precios canónicos o totales confiables: requiere plan backend separado.

## Pruebas/build reales

- npm ci: 387 paquetes de lockfile existente, sin nuevas dependencias ni aprobación
  global de scripts pendientes.
- `npm test -- --watch=false`: **98/98, ocho archivos**, 82 previos conservados
  sin editar sus tests y 16 nuevos para Perfil/Historial/Reportes, identidad,
  deduplicación, cambio de cuenta/logout/races, errores/timeout y cancelación.
- `npm run build`: correcto; inicial 608,48 kB / budget 500, CSS checkout 5,04 kB /
  budget 4. Sin modificar presupuestos.
- Tests con HTTP/MSAL simulados solo en fixtures; nada de Azure/AWS/compras/eventos.
- MSAL/config/interceptor, app.ts, checkout, dependencias y workflows preservados.

## Dependencias antes de desplegar

1. Aprobar cierre administrativo: sin evidencia de roles reales no se habilitan.
   Revisar matriz backend en fazbears-pedidos/docs/SEGURIDAD_PEDIDOS_F1_4.md.
2. Usuario/ChatGPT configura/verifica en otro bloque app roles reales/asignaciones/
   access tokens saneados. Se requiere código aprobado futuro para consumirlos;
   activar roles en Azure por sí solo no habilita este frontend/backend.
3. Con autorización aparte publicar imágenes por digest y desplegar Carrito /me
   (F1.3) y Pedidos seguro (F1.4) antes del frontend. Revisar CORS Gateway/ALB,
   tenant/audience/scope y preservación H2/create-drop antes de reinicio.
4. Datos históricos sub/alias necesitan reconciliación autorizada; no usar email ni
   aceptar dos identidades. Rollback de imagen no migra claves ni recupera H2.
5. Pruebas A/B de lectura/cancelación en datos desechables, sin ejecutar confirmar
   compra ni publicar RabbitMQ. No afirmar E2E hasta evidencia real por digest/config.

PAUSADO — esperando autorización. No Kafka/pagos/recomendaciones/FazCoins.
