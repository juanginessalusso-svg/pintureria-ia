import crypto from 'node:crypto';

const SESSION_TTL_MS = 8 * 3600 * 1000;
const COOKIE = 'sid';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(got, expected);
}

// Hash "señuelo": se verifica igual cuando el usuario no existe, para no filtrar por tiempo qué usuarios hay.
const DUMMY_HASH = hashPassword('señuelo-no-usar');
export const verifyAgainstDummy = (pw) => verifyPassword(pw, DUMMY_HASH);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (id, user_id, tenant_id, csrf, expires_at) VALUES (?,?,?,?,?)').run(
    sha256(token), user.id, user.tenant_id, csrf, Date.now() + SESSION_TTL_MS,
  );
  return { token, csrf };
}

export function cookieHeader(token, { secure }) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}
export const clearCookieHeader = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export function readCookie(req, name = COOKIE) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
export const sessionId = (token) => sha256(token);

/** Exige sesión válida; en métodos que modifican exige además el header X-CSRF-Token. */
export function requireAuth(db) {
  const find = db.prepare(`SELECT s.id, s.csrf, s.tenant_id, s.user_id, u.username
                           FROM sessions s JOIN admin_users u ON u.id = s.user_id
                           WHERE s.id = ? AND s.expires_at > ?`);
  return (req, res, next) => {
    const token = readCookie(req);
    const s = token && find.get(sha256(token), Date.now());
    if (!s) return res.status(401).json({ error: 'no_autenticado' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
      const real = Buffer.from(s.csrf);
      if (sent.length !== real.length || !crypto.timingSafeEqual(sent, real)) {
        return res.status(403).json({ error: 'csrf_invalido' });
      }
    }
    req.session = { id: s.id, csrf: s.csrf, tenantId: s.tenant_id, userId: s.user_id, username: s.username };
    next();
  };
}

/** Límite de intentos fallidos de login: max por ventana, por IP+usuario. */
export function createLoginLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map();
  const live = (key) => {
    const e = fails.get(key);
    if (e && Date.now() - e.first > windowMs) {
      fails.delete(key);
      return null;
    }
    return e ?? null;
  };
  return {
    blocked: (key) => (live(key)?.count ?? 0) >= max,
    fail: (key) => {
      const e = live(key) ?? { count: 0, first: Date.now() };
      e.count++;
      fails.set(key, e);
    },
    ok: (key) => fails.delete(key),
  };
}
