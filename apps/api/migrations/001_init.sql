CREATE TABLE tenants (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  whatsapp      TEXT NOT NULL DEFAULT '',
  logo_url      TEXT NOT NULL DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '#1f6feb',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tenant_domains (
  domain    TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE admin_users (
  id            INTEGER PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, username)
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,           -- sha256 del token de la cookie (el token nunca se guarda)
  user_id    INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  expires_at INTEGER NOT NULL            -- epoch ms
);

CREATE TABLE colors (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  family    TEXT NOT NULL DEFAULT '',
  hex       TEXT NOT NULL,
  lab_l     REAL NOT NULL,
  lab_a     REAL NOT NULL,
  lab_b     REAL NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE products (
  id              INTEGER PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  coats           INTEGER NOT NULL DEFAULT 2,       -- manos recomendadas
  yield_m2_per_l  REAL NOT NULL,                    -- rendimiento por mano (m2/L)
  tech_sheet      TEXT NOT NULL DEFAULT '',         -- ficha técnica (texto, alimenta el RAG)
  active          INTEGER NOT NULL DEFAULT 1,
  embedding_stale INTEGER NOT NULL DEFAULT 1,       -- 1 = hay que (re)generar el embedding (etapa G)
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, sku)
);

CREATE TABLE product_sizes (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  liters      REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  UNIQUE (product_id, liters)
);

CREATE INDEX idx_colors_tenant   ON colors(tenant_id);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_sessions_exp    ON sessions(expires_at);
