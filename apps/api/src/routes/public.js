import { Router } from 'express';
import { catalog } from '../catalog.js';
import { branches } from '../branches.js';

/** Datos que ve el cliente final. Siempre filtrados por req.tenant (lo resuelve tenantMiddleware). */
export function publicRoutes(db) {
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

  return r;
}
