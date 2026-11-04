import express from 'express';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Nginx va adelante: confiamos en 1 proxy para leer la IP real del cliente.
  app.set('trust proxy', 1);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: process.env.APP_VERSION ?? 'dev' });
  });

  return app;
}
