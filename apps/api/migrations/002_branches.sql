-- Sucursales de cada pinturería: cada una con su propio WhatsApp (el presupuesto se envía a la que elija el cliente).
CREATE TABLE branches (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  address   TEXT NOT NULL DEFAULT '',
  whatsapp  TEXT NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1,
  position  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_branches_tenant ON branches(tenant_id);
