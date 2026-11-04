let csrf = '';
export const setCsrf = (t) => { csrf = t; };

export class ApiError extends Error {
  constructor(code, status, details, body) {
    super(code);
    this.status = status;
    this.details = details;
    this.body = body; // respuesta completa (la importación de CSV devuelve ahí la lista de errores por línea)
  }
}

const MENSAJES = {
  credenciales_invalidas: 'Usuario o contraseña incorrectos.',
  demasiados_intentos: 'Demasiados intentos. Probá de nuevo en 15 minutos.',
  codigo_repetido: 'Ya existe un color con ese código.',
  sku_repetido: 'Ya existe un producto con ese SKU.',
  sucursal_repetida: 'Ya existe una sucursal con ese nombre.',
  no_autenticado: 'La sesión venció. Volvé a entrar.',
};
export const mensaje = (e) =>
  [MENSAJES[e.message] ?? `Error: ${e.message}`, ...(e.details ?? [])].join(' · ');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? `http_${res.status}`, res.status, data?.details, data);
  return data;
}
