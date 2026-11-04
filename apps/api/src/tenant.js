/**
 * Resuelve la pinturería (tenant) de un pedido PÚBLICO.
 *  - En producción: SOLO por dominio (Host) -> tabla tenant_domains.
 *  - Con ALLOW_TENANT_PARAM=1 (dev/staging): ?tenant=slug o header X-Tenant tiene PRIORIDAD sobre el dominio,
 *    así en un único dominio de staging se pueden previsualizar varias pinturerías.
 */
export function tenantMiddleware(db, { allowTenantParam = false } = {}) {
  const byDomain = db.prepare(
    'SELECT t.* FROM tenants t JOIN tenant_domains d ON d.tenant_id = t.id WHERE d.domain = ?',
  );
  const bySlug = db.prepare('SELECT * FROM tenants WHERE slug = ?');
  return (req, res, next) => {
    let tenant;
    if (allowTenantParam) {
      const slug = req.get('x-tenant') || req.query.tenant;
      if (typeof slug === 'string') tenant = bySlug.get(slug);
    }
    tenant ??= byDomain.get((req.hostname || '').toLowerCase());
    if (!tenant) return res.status(404).json({ error: 'tenant_desconocido' });
    req.tenant = tenant;
    next();
  };
}
