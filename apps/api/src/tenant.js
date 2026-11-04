/**
 * Resuelve la pinturería (tenant) de un pedido PÚBLICO.
 * 1) por dominio (Host) -> tabla tenant_domains
 * 2) solo si ALLOW_TENANT_PARAM=1 (dev/staging): ?tenant=slug o header X-Tenant
 */
export function tenantMiddleware(db, { allowTenantParam = false } = {}) {
  const byDomain = db.prepare(
    'SELECT t.* FROM tenants t JOIN tenant_domains d ON d.tenant_id = t.id WHERE d.domain = ?',
  );
  const bySlug = db.prepare('SELECT * FROM tenants WHERE slug = ?');
  return (req, res, next) => {
    let tenant = byDomain.get((req.hostname || '').toLowerCase());
    if (!tenant && allowTenantParam) {
      const slug = req.get('x-tenant') || req.query.tenant;
      if (typeof slug === 'string') tenant = bySlug.get(slug);
    }
    if (!tenant) return res.status(404).json({ error: 'tenant_desconocido' });
    req.tenant = tenant;
    next();
  };
}
