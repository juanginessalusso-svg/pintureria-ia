import { Router } from 'express';
import { z } from 'zod';
import {
  clearCookieHeader, cookieHeader, createLoginLimiter, createSession, hashPassword,
  readCookie, requireAuth, sessionId, verifyAgainstDummy, verifyPassword,
} from '../auth.js';
import { catalog, colorSchema, productSchema, settingsSchema } from '../catalog.js';

const loginSchema = z.object({ tenant: z.string().min(1).max(60), username: z.string().min(1).max(60), password: z.string().min(1).max(200) });
const passwordSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(10).max(200) });

const isUnique = (e) => e?.code === 'SQLITE_CONSTRAINT_UNIQUE';
const idOf = (req) => Number.parseInt(req.params.id, 10);

export function adminRoutes(db, { secureCookies = false } = {}) {
  const r = Router();
  const cat = catalog(db);
  const limiter = createLoginLimiter();
  const auth = requireAuth(db);

  // ---- sesión -------------------------------------------------------------
  r.post('/login', (req, res) => {
    const { tenant: slug, username, password } = loginSchema.parse(req.body);
    const key = `${req.ip}|${slug}|${username}`;
    if (limiter.blocked(key)) return res.status(429).json({ error: 'demasiados_intentos' });

    const user = db.prepare(
      `SELECT u.* FROM admin_users u JOIN tenants t ON t.id = u.tenant_id WHERE t.slug = ? AND u.username = ?`,
    ).get(slug, username);
    const ok = user ? verifyPassword(password, user.password_hash) : (verifyAgainstDummy(password), false);
    if (!ok) {
      limiter.fail(key);
      return res.status(401).json({ error: 'credenciales_invalidas' });
    }
    limiter.ok(key);
    const { token, csrf } = createSession(db, user);
    res.setHeader('Set-Cookie', cookieHeader(token, { secure: secureCookies }));
    res.json({ username: user.username, csrf });
  });

  r.post('/logout', (req, res) => {
    const token = readCookie(req);
    if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId(token));
    res.setHeader('Set-Cookie', clearCookieHeader());
    res.status(204).end();
  });

  r.use(auth); // todo lo de abajo exige sesión (y CSRF en escrituras)

  r.get('/me', (req, res) => {
    const t = db.prepare('SELECT slug, name FROM tenants WHERE id = ?').get(req.session.tenantId);
    res.json({ username: req.session.username, csrf: req.session.csrf, tenant: t });
  });

  r.post('/password', (req, res) => {
    const { current, next } = passwordSchema.parse(req.body);
    const u = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.userId);
    if (!verifyPassword(current, u.password_hash)) return res.status(401).json({ error: 'credenciales_invalidas' });
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
    // cierra las demás sesiones de este usuario
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(u.id, req.session.id);
    res.status(204).end();
  });

  // ---- ajustes de la pinturería ------------------------------------------
  r.get('/settings', (req, res) => {
    const { name, whatsapp, logo_url, primary_color } = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.session.tenantId);
    res.json({ name, whatsapp, logo_url, primary_color });
  });
  r.put('/settings', (req, res) => {
    const s = settingsSchema.parse(req.body);
    db.prepare('UPDATE tenants SET name=?, whatsapp=?, logo_url=?, primary_color=? WHERE id=?')
      .run(s.name, s.whatsapp, s.logo_url, s.primary_color, req.session.tenantId);
    res.json(s);
  });

  // ---- colores ------------------------------------------------------------
  r.get('/colors', (req, res) => res.json(cat.listColors(req.session.tenantId)));
  r.post('/colors', (req, res) => {
    try {
      res.status(201).json(cat.createColor(req.session.tenantId, colorSchema.parse(req.body)));
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: 'codigo_repetido' });
      throw e;
    }
  });
  r.put('/colors/:id', (req, res) => {
    try {
      const c = cat.updateColor(req.session.tenantId, idOf(req), colorSchema.parse(req.body));
      c ? res.json(c) : res.status(404).json({ error: 'no_encontrado' });
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: 'codigo_repetido' });
      throw e;
    }
  });
  r.delete('/colors/:id', (req, res) =>
    cat.deleteColor(req.session.tenantId, idOf(req)) ? res.status(204).end() : res.status(404).json({ error: 'no_encontrado' }));

  // ---- productos ----------------------------------------------------------
  r.get('/products', (req, res) => res.json(cat.listProducts(req.session.tenantId)));
  r.post('/products', (req, res) => {
    try {
      res.status(201).json(cat.createProduct(req.session.tenantId, productSchema.parse(req.body)));
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: 'sku_repetido' });
      throw e;
    }
  });
  r.put('/products/:id', (req, res) => {
    try {
      const p = cat.updateProduct(req.session.tenantId, idOf(req), productSchema.parse(req.body));
      p ? res.json(p) : res.status(404).json({ error: 'no_encontrado' });
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: 'sku_repetido' });
      throw e;
    }
  });
  r.delete('/products/:id', (req, res) =>
    cat.deleteProduct(req.session.tenantId, idOf(req)) ? res.status(204).end() : res.status(404).json({ error: 'no_encontrado' }));

  return r;
}
