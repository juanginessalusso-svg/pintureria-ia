import { z } from 'zod';
import { hexToLab, normalizeHex } from '@pintureria/core';

const hex = z.string().transform((v, ctx) => {
  const h = normalizeHex(v);
  if (!h) ctx.addIssue({ code: 'custom', message: 'hex inválido (ej: #d9cbb4)' });
  return h;
});

export const colorSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(80),
  family: z.string().trim().max(40).default(''),
  hex,
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40).default(''),
  description: z.string().trim().max(2000).default(''),
  coats: z.number().int().min(1).max(4).default(2),
  yield_m2_per_l: z.number().positive().max(100),
  tech_sheet: z.string().max(20000).default(''),
  active: z.boolean().default(true),
  sizes: z
    .array(z.object({ liters: z.number().positive().max(1000), price_cents: z.number().int().min(0).max(1_000_000_000) }))
    .max(10)
    .default([])
    .refine((s) => new Set(s.map((x) => x.liters)).size === s.length, 'litros repetidos'),
});

export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  whatsapp: z.string().trim().regex(/^(\d{8,15})?$/, 'solo dígitos con código de país, ej: 5491112345678'),
  logo_url: z.string().trim().max(500).regex(/^(https:\/\/.+|\/uploads\/[\w.-]+)?$/, 'debe empezar con https:// o ser un archivo de /uploads/'),
  primary_color: hex,
});

const labCols = (h) => {
  const { L, a, b } = hexToLab(h);
  return { lab_l: L, lab_a: a, lab_b: b };
};

export function catalog(db) {
  const q = {
    colorsAll: db.prepare('SELECT * FROM colors WHERE tenant_id = ? ORDER BY family, name'),
    colorsActive: db.prepare('SELECT * FROM colors WHERE tenant_id = ? AND active = 1 ORDER BY family, name'),
    colorInsert: db.prepare(`INSERT INTO colors (tenant_id, code, name, family, hex, lab_l, lab_a, lab_b, active)
                             VALUES (@tenant_id, @code, @name, @family, @hex, @lab_l, @lab_a, @lab_b, @active)`),
    colorUpdate: db.prepare(`UPDATE colors SET code=@code, name=@name, family=@family, hex=@hex,
                             lab_l=@lab_l, lab_a=@lab_a, lab_b=@lab_b, active=@active
                             WHERE id=@id AND tenant_id=@tenant_id`),
    colorDelete: db.prepare('DELETE FROM colors WHERE id = ? AND tenant_id = ?'),
    colorGet: db.prepare('SELECT * FROM colors WHERE id = ? AND tenant_id = ?'),

    productsAll: db.prepare('SELECT * FROM products WHERE tenant_id = ? ORDER BY name'),
    productsActive: db.prepare('SELECT * FROM products WHERE tenant_id = ? AND active = 1 ORDER BY name'),
    productGet: db.prepare('SELECT * FROM products WHERE id = ? AND tenant_id = ?'),
    productInsert: db.prepare(`INSERT INTO products (tenant_id, sku, name, category, description, coats, yield_m2_per_l, tech_sheet, active)
                               VALUES (@tenant_id, @sku, @name, @category, @description, @coats, @yield_m2_per_l, @tech_sheet, @active)`),
    // Cada edición marca el embedding como viejo: la etapa G lo regenera.
    productUpdate: db.prepare(`UPDATE products SET sku=@sku, name=@name, category=@category, description=@description,
                               coats=@coats, yield_m2_per_l=@yield_m2_per_l, tech_sheet=@tech_sheet, active=@active,
                               embedding_stale=1, updated_at=datetime('now')
                               WHERE id=@id AND tenant_id=@tenant_id`),
    productDelete: db.prepare('DELETE FROM products WHERE id = ? AND tenant_id = ?'),
    sizesFor: db.prepare('SELECT liters, price_cents FROM product_sizes WHERE product_id = ? ORDER BY liters'),
    sizesDelete: db.prepare('DELETE FROM product_sizes WHERE product_id = ?'),
    sizeInsert: db.prepare('INSERT INTO product_sizes (product_id, liters, price_cents) VALUES (?,?,?)'),
  };

  const withSizes = (p) => ({ ...p, active: !!p.active, embedding_stale: undefined, sizes: q.sizesFor.all(p.id) });
  const colorOut = (c) => ({ ...c, active: !!c.active });
  const flag = (o) => ({ ...o, active: o.active ? 1 : 0 });

  return {
    listColors: (tenantId, { onlyActive = false } = {}) =>
      (onlyActive ? q.colorsActive : q.colorsAll).all(tenantId).map(colorOut),
    createColor(tenantId, data) {
      const info = q.colorInsert.run({ ...flag(data), ...labCols(data.hex), tenant_id: tenantId });
      return colorOut(q.colorGet.get(info.lastInsertRowid, tenantId));
    },
    updateColor(tenantId, id, data) {
      const info = q.colorUpdate.run({ ...flag(data), ...labCols(data.hex), id, tenant_id: tenantId });
      return info.changes ? colorOut(q.colorGet.get(id, tenantId)) : null;
    },
    deleteColor: (tenantId, id) => q.colorDelete.run(id, tenantId).changes > 0,

    listProducts: (tenantId, { onlyActive = false } = {}) =>
      (onlyActive ? q.productsActive : q.productsAll).all(tenantId).map(withSizes),
    createProduct: db.transaction((tenantId, data) => {
      const { sizes, ...p } = data;
      const info = q.productInsert.run({ ...flag(p), tenant_id: tenantId });
      for (const s of sizes) q.sizeInsert.run(info.lastInsertRowid, s.liters, s.price_cents);
      return withSizes(q.productGet.get(info.lastInsertRowid, tenantId));
    }),
    updateProduct: db.transaction((tenantId, id, data) => {
      const { sizes, ...p } = data;
      const info = q.productUpdate.run({ ...flag(p), id, tenant_id: tenantId });
      if (!info.changes) return null;
      q.sizesDelete.run(id);
      for (const s of sizes) q.sizeInsert.run(id, s.liters, s.price_cents);
      return withSizes(q.productGet.get(id, tenantId));
    }),
    deleteProduct: (tenantId, id) => q.productDelete.run(id, tenantId).changes > 0,
  };
}
