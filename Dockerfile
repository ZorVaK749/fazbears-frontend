# ─── FASE 1: Build de Angular ────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Instalar dependencias primero (caching de capas Docker)
COPY package*.json ./
RUN npm ci

# Copiar el resto del código y compilar en modo producción
COPY . .
RUN npm run build -- --configuration production

# ─── FASE 2: Servir con Nginx ────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Copiar el build de Angular (la carpeta dist/fazbear-frontend/browser)
COPY --from=build /app/dist/fazbear-frontend/browser /usr/share/nginx/html

# Reemplazar la configuración por defecto de Nginx con la nuestra
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Puerto 80 expuesto
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
