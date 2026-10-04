# Fazbear's Pizza — Frontend (Angular SPA) 🍕🐻

Sistema de gestión de pedidos en la nube con arquitectura de microservicios. Este repositorio corresponde a la capa frontend de presentación.

## 🚀 Tecnologías

* **Framework:** Angular 17+ (Standalone Components, Signals, RxJS)
* **Auth:** Microsoft Azure Entra ID (`@azure/msal-angular`, `@azure/msal-browser`)
* **Styling:** CSS puro con diseño Neumórfico/Glassmorfismo oscuro
* **Deployment:** Nginx web server sobre Docker (Alpine)

---

## 🔒 Autenticación y Flujo (E2E Security)

Este frontend implementa un flujo estricto de seguridad utilizando Microsoft MSAL (OAuth 2.0 / OpenID Connect):
1. **SSO Azure:** Al ingresar, el usuario es redirigido a `login.microsoftonline.com`.
2. **Adquisición de Token:** Se adquiere silenciosamente un `Bearer Token` JWT.
3. **MsalInterceptor:** Se interceptan automáticamente las peticiones hacia el AWS API Gateway (`https://1nqf3okm71...`) inyectando el token en las cabeceras.

---

## 🐋 Despliegue en AWS EC2 (Docker + Nginx)

El proyecto está preparado para producción en la nube usando un build multi-stage con Docker, sirviendo la aplicación a través de Nginx y resolviendo certificados SSL autofirmados para complacer los estrictos requisitos de seguridad HTTPS de las Redirect URIs de Azure.

### Requisitos previos en el Host (EC2 Amazon Linux)
```bash
sudo dnf update -y
sudo dnf install git docker -y
sudo systemctl enable --now docker
```

### Comandos de Despliegue

```bash
# 1. Clonar
git clone https://github.com/ZorVaK749/fazbears-frontend.git
cd fazbears-frontend

# 2. Construir Imagen (compilación Angular + Config Nginx + SSL generation)
sudo docker build -t fazbear-frontend:1.0 .

# 3. Ejecutar Contenedor exponiendo puertos 80 y 443 (HTTPS requerido por Azure)
sudo docker run -d -p 80:80 -p 443:443 --name fz-frontend fazbear-frontend:1.0
```

### Configuración Nginx Interna
El archivo `nginx.conf` incluido redirige todo el tráfico al `index.html` (necesario para el Router de Angular) y activa la compresión / caché de estáticos.

---

## 💻 Desarrollo Local

Para correr este proyecto en entorno de desarrollo local (PC):

1. **Dependencias:** `npm install`
2. **Ejecutar servidor local:** `npm run dev` o `ng serve`
3. Navega a `http://localhost:4200/`

> **Nota de compatibilidad MSAL:** Las URLs de redirección están configuradas de forma dinámica con `window.location.origin`, lo que significa que el login funcionará sin modificaciones tanto en `localhost:4200` como en la IP pública de AWS, siempre que ambas estén registradas en el portal de Azure App Registrations.

## 👥 Arquitectura General

Este frontend es solo una de 4 piezas en la nube. Se conecta mediante API Gateway a:
- `fazbear-productos` (Spring Boot)
- `fazbear-carrito` (Spring Boot)
- `fazbear-pedidos` (Spring Boot)
