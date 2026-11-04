import { Router } from 'express';
import { catalog } from '../catalog.js';

/** Datos que ve el cliente final. Siempre filtrados por req.tenant (lo resuelve tenantMiddleware). */
export function publicRoutes(db) {
  const cat = catalog(db);
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

  r.get('/products', (req, res) => {
    res.json(
      cat.listProducts(req.tenant.id, { onlyActive: true }).map(
        ({ id, sku, name, category, description, coats, yield_m2_per_l, sizes }) => ({
          id, sku, name, category, description, coats, yield_m2_per_l, sizes,
        }),
      ),
    );
  });

  return r;
}
