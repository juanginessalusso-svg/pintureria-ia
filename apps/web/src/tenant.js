// Manejo de datos de la pinturería (tenant) y preservación del query param ?tenant=
export function getTenantParam() {
  if (typeof location === 'undefined') return '';
  const t = new URLSearchParams(location.search).get('tenant');
  return t ? t.trim() : '';
}

export function tenantQuery() {
  const t = getTenantParam();
  return t ? `?tenant=${encodeURIComponent(t)}` : '';
}

/** Agrega el ?tenant= a una URL interna si existe */
export function tenantHref(path) {
  const q = tenantQuery();
  if (!q) return path;
  return path.includes('?') ? `${path}&tenant=${encodeURIComponent(getTenantParam())}` : `${path}${q}`;
}

export async function fetchTenant() {
  const res = await fetch(`/api/public/tenant${tenantQuery()}`);
  if (!res.ok) throw new Error(`Error ${res.status} al cargar datos de la pinturería`);
  const data = await res.json();
  if (data?.primary_color) {
    document.documentElement.style.setProperty('--brand', data.primary_color);
  }
  if (data?.name) {
    document.title = `${data.name} — Tienda & Visualizador`;
  }
  return data;
}

export async function fetchBranches() {
  const res = await fetch(`/api/public/branches${tenantQuery()}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}
