FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Copiamos primero los package.json para aprovechar la caché de capas de Docker.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
RUN npm install --omit=dev --workspace @pintureria/api --include-workspace-root=false
COPY apps/api apps/api
USER node
EXPOSE 3000
CMD ["node", "apps/api/src/server.js"]
