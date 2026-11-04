# pintureria-ia

Visualizador de color + Asesor IA para pinturerías (multi-cliente).

## Levantar en desarrollo
Requiere Docker (en WSL2/Ubuntu o Docker Desktop).

    cp .env.example .env
    docker compose up --build

Probar: http://localhost:8080/api/health

## Tests
    npm install
    npm test

## Estructura
- `apps/api` API Node + Express
- `packages/core` lógica pura (litros, color) — etapa D
- `infra/` Nginx, scripts de deploy y backup
