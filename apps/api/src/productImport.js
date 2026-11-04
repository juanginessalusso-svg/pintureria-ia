import { productsFromCsv } from '@pintureria/core';
import { catalog, productSchema } from './catalog.js';

/**
 * Importa productos desde el texto de un CSV a UNA pinturería.
 *  - mode 'upsert' (por defecto): crea los SKU nuevos y actualiza los existentes (datos y presentaciones).
 *  - mode 'replace': además BORRA los productos de la pinturería que no estén en el archivo.
 *  - dryRun: valida y devuelve el resumen sin escribir nada (vista previa).
 * Todo o nada: si hay UN error en cualquier fila no se aplica nada. Cada edición marca el embedding como viejo (etapa G).
 */
export function importProducts(db, tenantId, csvText, { mode = 'upsert', dryRun = false } = {}) {
  const parsed = productsFromCsv(csvText);
  const errors = [...parsed.errors];
  const valid = [];
  // Si el parser ya señaló un problema en un SKU, no se repite con el esquema (evita errores duplicados).
  const conErrores = new Set(parsed.errors.map((e) => e.sku).filter(Boolean));
  for (const p of parsed.products) {
    if (conErrores.has(p.sku)) continue;
    const { line, ...data } = p;
    const r = productSchema.safeParse(data);
    if (r.success) valid.push(r.data);
    else errors.push({ line, message: `${p.sku}: ${r.error.issues.map((i) => `${i.path.join('.') || 'dato'}: ${i.message}`).join('; ')}` });
  }

  const cat = catalog(db);
  const existing = new Map(cat.listProducts(tenantId).map((p) => [p.sku, p]));
  const inFile = new Set(valid.map((p) => p.sku));
  const toCreate = valid.filter((p) => !existing.has(p.sku));
  const toUpdate = valid.filter((p) => existing.has(p.sku));
  const toRemove = mode === 'replace' ? [...existing.values()].filter((p) => !inFile.has(p.sku)) : [];

  const summary = {
    mode,
    products: valid.length,
    sizes: valid.reduce((n, p) => n + p.sizes.length, 0),
    create: toCreate.length,
    update: toUpdate.length,
    remove: toRemove.length,
    removeNames: toRemove.slice(0, 10).map((p) => p.name),
  };
  const base = { errors, warnings: parsed.warnings, ignoredColumns: parsed.ignoredColumns, summary };
  if (errors.length) return { ok: false, applied: false, ...base };
  if (dryRun) return { ok: true, applied: false, ...base };

  db.transaction(() => {
    for (const p of toRemove) cat.deleteProduct(tenantId, p.id);
    for (const p of toUpdate) cat.updateProduct(tenantId, existing.get(p.sku).id, p);
    for (const p of toCreate) cat.createProduct(tenantId, p);
  })();
  return { ok: true, applied: true, ...base };
}
