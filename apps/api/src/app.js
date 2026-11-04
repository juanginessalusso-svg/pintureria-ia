import express from 'express';
import path from 'node:path';
import { ZodError } from 'zod';
import { tenantMiddleware } from './tenant.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';

// 'wasm-unsafe-eval' = permitir compilar WebAssembly (ONNX Runtime); no habilita eval() de JavaScript.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

export function createApp({ db, webDir, modelsDir, allowTenantParam = false, secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Nginx va adelante: confiamos en 1 proxy para leer la IP real del cliente.
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CSP);
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: process.env.APP_VERSION ?? 'dev' });
  });

  if (db) {
    app.use('/api/public', tenantMiddleware(db, { allowTenantParam }), publicRoutes(db));
    app.use('/api/admin', adminRoutes(db, { secureCookies }));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'no_encontrado' }));

  // Modelos ONNX (~45 MB): archivos fijos, cacheables por mucho tiempo (el navegador además los guarda en Cache Storage).
  if (modelsDir) app.use('/models', express.static(modelsDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

  if (webDir) {
    app.use(express.static(webDir, {
      maxAge: 0,
      // Los archivos de /assets llevan hash en el nombre: nunca cambian, se pueden cachear un año.
      // El resto (index.html) se revalida siempre, así un deploy nuevo llega en la próxima visita.
      setHeaders(res, file) {
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    // SPA: cualquier ruta que no sea /api devuelve el index
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'datos_invalidos',
        details: err.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`),
      });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'json_invalido' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'demasiado_grande' });
    console.error(err);
    res.status(500).json({ error: 'error_interno' });
  });

  return app;
}
