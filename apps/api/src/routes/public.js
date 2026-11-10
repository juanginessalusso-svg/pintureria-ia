import express, { Router } from 'express';
import { catalog } from '../catalog.js';
import { branches } from '../branches.js';
import { crearLimitador, segmentarEnRunpod } from '../segmentador.js';

/** Datos que ve el cliente final. Siempre filtrados por req.tenant (lo resuelve tenantMiddleware). `segmentarFn` es para tests. */
export function publicRoutes(db, { segmentarFn, diagnostico = false } = {}) {
  const cat = catalog(db);
  const branchRepo = branches(db);
  const r = Router();

  r.get('/tenant', (req, res) => {
    const { name, whatsapp, logo_url, primary_color } = req.tenant;
    res.json({ name, whatsapp, logo_url, primary_color });
  });

  r.get('/colors', (req, res) => {
    res.json(
      cat.listColors(req.tenant.id, { onlyActive: true }).map(({ id, code, name, family, hex, lab_l, lab_a, lab_b }) => ({
        id, code, name, family, hex, lab: { L: lab_l, a: lab_a, b: lab_b },
      })),
    );
  });

  // Sucursales activas (el cliente elige a cuál le manda el presupuesto por WhatsApp).
  r.get('/branches', (req, res) => {
    res.json(branchRepo.list(req.tenant.id, { onlyActive: true }).map(({ id, name, address, whatsapp }) => ({ id, name, address, whatsapp })));
  });

  r.get('/products', (req, res) => {
    res.json(
      cat.listProducts(req.tenant.id, { onlyActive: true }).map(
        ({ id, sku, name, category, description, coats, yield_m2_per_l, sizes }) => ({
          id, sku, name, category, description, coats, yield_m2_per_l, sizes,
        }),
      ),
    );
  });

  // Segmentador con GPU (SAM 3 + r9): la app manda la foto (jpeg/png crudo) y recibe el mapa de clases en PNG
  // (0 otro / 1 pared / 2 techo). Si no está configurado o falla, 503: la app sigue con el modelo del celular.
  const limitador = crearLimitador({ max: Number(process.env.SEGMENTADOR_MAX ?? 20) });
  r.post('/segmentar', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }), async (req, res) => {
    const apiKey = process.env.RUNPOD_API_KEY, endpointId = process.env.RUNPOD_ENDPOINT_ID;
    if (!apiKey || !endpointId) return res.status(503).json({ error: 'segmentador_no_configurado' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'falta_la_foto' });
    if (!limitador.permitir(req.ip)) return res.status(429).json({ error: 'demasiadas_fotos' });
    try {
      // 55 s: Nginx corta a los 60 s. Si el worker estaba apagado (arranque en frío) y no llega, la app usa el modelo del celular para esa foto.
      const out = await (segmentarFn ?? segmentarEnRunpod)(req.body, { apiKey, endpointId, plazoMs: 55_000 });
      res.set('Cache-Control', 'no-store').set('X-Segundos', String(out.segundos ?? '')).type('png').send(out.png);
    } catch (e) {
      console.warn('[segmentador]', e?.message);
      res.status(503).json({ error: 'segmentador_no_disponible' });
    }
  });

  // Diagnóstico (SOLO staging, mismo interruptor que ?tenant=): puntajes de SAM 3 para textos arbitrarios, para probar reglas nuevas.
  if (diagnostico) {
    r.post('/segmentar/diag', express.raw({ type: ['image/jpeg', 'image/png'], limit: '4mb' }), async (req, res) => {
      const apiKey = process.env.RUNPOD_API_KEY, endpointId = process.env.RUNPOD_ENDPOINT_ID;
      if (!apiKey || !endpointId) return res.status(503).json({ error: 'segmentador_no_configurado' });
      const textos = String(req.query.textos ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      if (!textos.length || textos.length > 12 || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'pedido_invalido' });
      if (!limitador.permitir(req.ip)) return res.status(429).json({ error: 'demasiadas_fotos' });
      try { res.json(await (segmentarFn ?? segmentarEnRunpod)(req.body, { apiKey, endpointId, textos, plazoMs: 55_000 })); }
      catch (e) { console.warn('[segmentador diag]', e?.message); res.status(503).json({ error: 'segmentador_no_disponible' }); }
    });
  }

  return r;
}
