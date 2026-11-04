import { hashPassword } from './auth.js';
import { catalog } from './catalog.js';

/** Crea una pinturería con su dominio(s) y su usuario admin. Devuelve el id del tenant. */
export function createTenant(db, { slug, name, domains = [], username, password, whatsapp = '', primaryColor = '#1f6feb' }) {
  return db.transaction(() => {
    const { lastInsertRowid: id } = db.prepare('INSERT INTO tenants (slug, name, whatsapp, primary_color) VALUES (?, ?, ?, ?)')
      .run(slug, name, whatsapp, primaryColor);
    for (const d of domains) db.prepare('INSERT INTO tenant_domains (domain, tenant_id) VALUES (?, ?)').run(d.toLowerCase(), id);
    db.prepare('INSERT INTO admin_users (tenant_id, username, password_hash) VALUES (?,?,?)')
      .run(id, username, hashPassword(password));
    return Number(id);
  })();
}

// Datos de DEMO inventados (no son un catálogo real ni de ninguna marca). Rendimientos orientativos.
const DEMO_COLORS = [
  ['B-001', 'Blanco Nieve', 'Blancos', '#f7f7f2'], ['B-002', 'Hueso', 'Blancos', '#eee6d6'],
  ['G-010', 'Gris Perla', 'Grises', '#cfd2d4'], ['G-020', 'Gris Cemento', 'Grises', '#9a9d9f'],
  ['G-030', 'Grafito', 'Grises', '#4a4d52'], ['T-101', 'Arena', 'Tierras', '#d9c3a0'],
  ['T-102', 'Terracota', 'Tierras', '#b9694a'], ['V-201', 'Verde Salvia', 'Verdes', '#a3b18a'],
  ['V-202', 'Verde Bosque', 'Verdes', '#3a5a40'], ['A-301', 'Celeste Cielo', 'Azules', '#a9cce3'],
  ['A-302', 'Azul Noche', 'Azules', '#1f3a5f'], ['Y-401', 'Amarillo Manteca', 'Amarillos', '#f2dc8f'],
];
const DEMO_PRODUCTS = [
  ['LAT-INT-MATE', 'Látex interior mate (demo)', 'interior', 'Látex acrílico lavable para paredes interiores.', 2, 11,
    'Aplicar sobre superficie limpia, seca y sellada. Diluir 10-20% con agua. Repintar a las 4 horas.', [[4, 4800000], [10, 11000000], [20, 20000000]]],
  ['LAT-EXT', 'Látex exterior acrílico (demo)', 'exterior', 'Látex para frentes, resistente a la intemperie.', 2, 10,
    'No aplicar con lluvia inminente ni por debajo de 5°C. Repintar a las 6 horas.', [[4, 5600000], [10, 13000000], [20, 24000000]]],
  ['ESM-SINT', 'Esmalte sintético brillante (demo)', 'esmalte', 'Para madera y metal, interior y exterior.', 2, 12,
    'Lijar y desengrasar. Diluir con aguarrás. Repintar a las 24 horas.', [[1, 1900000], [4, 6800000]]],
  ['CONV-OX', 'Convertidor de óxido (demo)', 'antioxido', 'Convierte el óxido en una capa estable antes de pintar.', 2, 8,
    'Quitar óxido suelto con cepillo de acero. Aplicar 2 manos. Esperar 24 hs antes de esmaltar.', [[1, 2300000], [4, 8400000]]],
  ['HIDRO-SAL', 'Hidrorepelente antisalitre (demo)', 'humedad', 'Tratamiento para muros con salitre y humedad superficial.', 2, 6,
    'Raspar el salitre, cepillar y aplicar. Si la humedad sube del suelo, consultar a un profesional.', [[4, 7600000], [10, 17000000]]],
  ['FIJ-SELL', 'Fijador sellador al agua (demo)', 'preparacion', 'Uniformiza la absorción antes de pintar.', 1, 9,
    'Aplicar una mano sobre muro nuevo o repintado. Esperar 2 horas.', [[4, 3900000], [10, 9000000]]],
];

export function seedDemo(db, tenantId) {
  const cat = catalog(db);
  for (const [code, name, family, hex] of DEMO_COLORS) cat.createColor(tenantId, { code, name, family, hex, active: true });
  for (const [sku, name, category, description, coats, yield_m2_per_l, tech_sheet, sizes] of DEMO_PRODUCTS) {
    cat.createProduct(tenantId, {
      sku, name, category, description, coats, yield_m2_per_l, tech_sheet, active: true,
      sizes: sizes.map(([liters, price_cents]) => ({ liters, price_cents })),
    });
  }
}
