import { z } from 'zod';
import { cleanWhatsapp } from '@pintureria/core';

// Acepta "+54 358 490-7406" y lo guarda como dígitos; vacío = sin WhatsApp propio (usa el de la pinturería).
const whatsapp = z.string().trim().transform((v, ctx) => {
  if (v === '') return '';
  const clean = cleanWhatsapp(v);
  if (!clean) ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido: 8 a 15 dígitos con código de país (ej: 5493584907406)' });
  return clean;
});

export const branchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().max(160).default(''),
  whatsapp: whatsapp.default(''),
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(999).default(0),
});

/** CRUD de sucursales. Todo filtrado por tenant_id. */
export function branches(db) {
  const q = {
    list: db.prepare('SELECT * FROM branches WHERE tenant_id = ? ORDER BY position, name'),
    listActive: db.prepare('SELECT * FROM branches WHERE tenant_id = ? AND active = 1 ORDER BY position, name'),
    get: db.prepare('SELECT * FROM branches WHERE id = ? AND tenant_id = ?'),
    insert: db.prepare(`INSERT INTO branches (tenant_id, name, address, whatsapp, active, position)
                        VALUES (@tenant_id, @name, @address, @whatsapp, @active, @position)`),
    update: db.prepare(`UPDATE branches SET name=@name, address=@address, whatsapp=@whatsapp, active=@active, position=@position
                        WHERE id=@id AND tenant_id=@tenant_id`),
    del: db.prepare('DELETE FROM branches WHERE id = ? AND tenant_id = ?'),
  };
  const out = (b) => (b ? { ...b, active: !!b.active } : null);
  const flag = (o) => ({ ...o, active: o.active ? 1 : 0 });
  return {
    list: (tenantId, { onlyActive = false } = {}) => (onlyActive ? q.listActive : q.list).all(tenantId).map(out),
    create(tenantId, data) {
      const info = q.insert.run({ ...flag(data), tenant_id: tenantId });
      return out(q.get.get(info.lastInsertRowid, tenantId));
    },
    update(tenantId, id, data) {
      return q.update.run({ ...flag(data), id, tenant_id: tenantId }).changes ? out(q.get.get(id, tenantId)) : null;
    },
    remove: (tenantId, id) => q.del.run(id, tenantId).changes > 0,
  };
}
