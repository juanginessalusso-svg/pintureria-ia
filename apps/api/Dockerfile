# ---- etapa 1: compila el front (Vite) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci
COPY apps/web apps/web
RUN npm run build -w @pintureria/web

# ---- etapa 2: imagen final, solo lo necesario para correr ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
# Copiamos primero los package.json para aprovechar la caché de capas de Docker.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci --omit=dev -w @pintureria/api -w @pintureria/core
COPY apps/api apps/api
COPY packages/core packages/core
COPY --from=build /app/apps/web/dist apps/web/dist
# La base SQLite vive en /app/data (volumen). Debe ser escribible por el usuario "node".
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "apps/api/src/server.js"]
