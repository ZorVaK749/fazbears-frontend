# 🍕 Fazbear Frontend — Pedidos360

> **SPA Angular 22** para el sistema de gestión de pedidos de **Freddy Fazbear's Pizza**.  
> Interfaz de catálogo, carrito y seguimiento de pedidos con temática retro-pixelada.

---

## 📋 Tabla de Contenidos

- [Stack](#-stack)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Prerrequisitos](#-prerrequisitos)
- [Instalación y Arranque Local](#-instalación-y-arranque-local)
- [Variables de Entorno](#-variables-de-entorno)
- [Arquitectura de Componentes](#-arquitectura-de-componentes)
- [Conexión con los Microservicios](#-conexión-con-los-microservicios)
- [Build de Producción](#-build-de-producción)
- [Despliegue Cloud](#-despliegue-cloud)
- [Notas de Desarrollo](#-notas-de-desarrollo)

---

## 🛠 Stack

| Tecnología | Versión | Uso |
|---|---|---|
| Angular | `^22.1.0` | Framework principal (standalone components) |
| TypeScript | `~6.0.2` | Lenguaje base |
| RxJS | `~7.8.0` | Programación reactiva (HttpClient, Observables) |
| Angular Signals | built-in | Estado reactivo del carrito (`signal<CarritoState>`) |
| Tailwind CSS | `^4.3.3` | Utilidades CSS (via Vite plugin) |
| Vitest | `^4.0.8` | Testing unitario |
| Prettier | `^3.8.1` | Formateo de código |
| Node / npm | `npm@11.17.0` | Gestor de paquetes |

---

## 📁 Estructura del Proyecto

```
fazbear-frontend/
├── src/
│   ├── app/
│   │   ├── app.ts                          # Root component + router
│   │   ├── app.config.ts                   # provideRouter, provideHttpClient
│   │   ├── core/
│   │   │   └── services/
│   │   │       ├── producto.service.ts     # GET /api/productos → MS :8081
│   │   │       ├── carrito.service.ts      # Estado local + POST /api/carrito → MS :8083
│   │   │       └── pedido.service.ts       # GET/POST /api/pedidos → MS :8082
│   │   ├── features/
│   │   │   ├── catalog/
│   │   │   │   └── catalogo.component.ts   # Catálogo de productos con filtro por categoría
│   │   │   ├── cart/
│   │   │   │   └── carrito.component.ts    # Drawer del carrito lateral
│   │   │   └── orders/
│   │   │       └── orders.component.ts     # Historial de pedidos del usuario
│   │   └── shared/
│   │       └── navbar/
│   │           └── navbar.component.ts     # Barra de navegación global
│   ├── environments/                       # ⚠️ Crear antes de desplegar (ver §Variables de Entorno)
│   ├── index.html
│   └── styles.css                          # Variables CSS globales (tema FNAF)
├── angular.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## ✅ Prerrequisitos

- **Node.js** ≥ 20 LTS
- **npm** ≥ 11
- Los **3 microservicios backend** corriendo (ver sus respectivos READMEs):
  - `fazbear-productos` en `localhost:8081`
  - `fazbear-pedidos` en `localhost:8082`
  - `fazbear-carrito` en `localhost:8083`

---

## 🚀 Instalación y Arranque Local

```bash
# 1. Instalar dependencias
npm install

# 2. Arrancar el servidor de desarrollo
npm start
# → http://localhost:4200
```

> El servidor de desarrollo hace **proxy directo** a los microservicios en `localhost`. Asegúrate de que los 3 backends estén activos antes de navegar al catálogo.

---

## 🌐 Variables de Entorno

Los servicios Angular usan URLs base hardcodeadas para desarrollo local. **Antes de hacer build de producción o desplegar a cloud**, crea los archivos de entorno:

### `src/environments/environment.ts` — Desarrollo local

```typescript
export const environment = {
  production: false,
  apiProductos: 'http://localhost:8081/api/productos',
  apiCarrito:   'http://localhost:8083/api/carrito',
  apiPedidos:   'http://localhost:8082/api/pedidos'
};
```

### `src/environments/environment.prod.ts` — Azure / AWS

```typescript
export const environment = {
  production: true,
  // Reemplaza con la URL real de tu AWS API Gateway o Azure API Management
  apiProductos: 'https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod/productos',
  apiCarrito:   'https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod/carrito',
  apiPedidos:   'https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod/pedidos'
};
```

Luego actualizar cada servicio para importar `environment`:

```typescript
import { environment } from '../../../environments/environment';

// En el servicio:
private base = environment.apiProductos;
```

> ⚠️ **Nunca subas `environment.prod.ts` con URLs o credenciales reales a un repositorio público.**

---

## 🧩 Arquitectura de Componentes

```
AppComponent (router-outlet)
├── NavbarComponent          — Logo, nav links, botón del carrito (badge con signal)
├── CarritoComponent         — Drawer lateral, lista de ítems, total, botón confirmar pedido
├── CatalogoComponent        — Grid de productos, tabs por categoría (PIZZA/BEBIDA/SOUVENIR/ANIMATRONICO)
└── OrdersComponent          — Historial de pedidos del usuario autenticado
```

### Estado reactivo del carrito

El carrito usa **Angular Signals** (sin NgRx, sin BehaviorSubject):

```typescript
// carrito.service.ts
carrito = signal<CarritoState>({ items: [], total: 0 });
abierto = signal<boolean>(false);
```

Esto permite reactividad sin necesidad de `async pipe` en templates modernos (`@if`, `@for`).

---

## 🔗 Conexión con los Microservicios

| Servicio Angular | Microservicio destino | Puerto | Endpoints consumidos |
|---|---|---|---|
| `ProductoService` | `fazbear-productos` | `8081` | `GET /api/productos`, `GET /api/productos/{id}`, `GET /api/productos/categoria/{cat}` |
| `CarritoService` | `fazbear-carrito` | `8083` | `GET/POST /api/carrito` |
| `PedidoService` | `fazbear-pedidos` | `8082` | `GET /api/pedidos`, `GET /api/pedidos/usuario/{id}`, `POST /api/pedidos`, `PUT /api/pedidos/{id}/estado` |

---

## 📦 Build de Producción

```bash
npm run build
# Output en: dist/fazbear-frontend/browser/
```

La carpeta `dist/` contiene los assets estáticos listos para servir. **No subas `dist/` al repositorio** (está en `.gitignore`).

---

## ☁️ Despliegue Cloud

### Opción A — Azure Static Web Apps (recomendado)

1. Conectar el repositorio GitHub a Azure Static Web Apps
2. Configurar `app_location: "fazbear-frontend"`, `output_location: "dist/fazbear-frontend/browser"`
3. Azure genera automáticamente un pipeline CI/CD con GitHub Actions

### Opción B — AWS S3 + CloudFront

```bash
# Build
npm run build

# Sync a S3
aws s3 sync dist/fazbear-frontend/browser/ s3://<tu-bucket>/ --delete

# Invalidar caché CloudFront
aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
```

> En ambas opciones, los microservicios backend deben estar detrás de un **AWS API Gateway** o **Azure API Management** con CORS configurado para el dominio del frontend.

---

## 📝 Notas de Desarrollo

### Categorías de producto válidas

Las categorías son un tipo `union` en TypeScript y un `String` en el backend Java:

```typescript
type Categoria = 'TODOS' | 'PIZZA' | 'BEBIDA' | 'SOUVENIR' | 'ANIMATRONICO';
```

### Template Angular inline con backticks — Regla importante

El template del componente usa backticks de TypeScript. **Evitar `${{`** — TypeScript lo interpreta como template literal JS, no como interpolación Angular:

```html
<!-- ❌ MAL — rompe el compilador TypeScript -->
${{ producto.precio }}

<!-- ✅ BIEN — $ dentro del binding Angular -->
{{ '$' + producto.precio }}

<!-- ✅ MEJOR — usar CurrencyPipe (requiere import CurrencyPipe en imports:[]) -->
{{ producto.precio | currency:'USD' }}
```

### Scripts disponibles

| Script | Comando | Descripción |
|---|---|---|
| `start` | `ng serve` | Dev server en `:4200` con live reload |
| `build` | `ng build` | Build de producción en `dist/` |
| `watch` | `ng build --watch` | Build incremental en modo desarrollo |
| `test` | `ng test` | Tests unitarios con Vitest |

---

*Freddy Fazbear's Pizza © 1987 — "Where fantasy and fun come to life!"* 🐻
