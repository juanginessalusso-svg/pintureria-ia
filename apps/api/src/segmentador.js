// Intermediario hacia el segmentador con GPU (SAM 3 + r9 en RunPod Serverless, ver servidor-sam3/).
// La clave de RunPod vive SOLO en el servidor (variables de entorno): el celular nunca la ve.
// Variables: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID. Sin ellas, el servicio responde 503 y la app sigue con el modelo del celular.

const BASE = 'https://api.runpod.ai/v2';

/**
 * Límite simple por IP (en memoria): cada foto cuesta segundos de GPU. Ventana deslizante de `ventanaMs`.
 */
export function crearLimitador({ max = 20, ventanaMs = 10 * 60_000, ahora = () => Date.now() } = {}) {
  const usos = new Map();
  return {
    permitir(clave) {
      const t = ahora(), lista = (usos.get(clave) ?? []).filter((x) => t - x < ventanaMs);
      if (lista.length >= max) { usos.set(clave, lista); return false; }
      lista.push(t); usos.set(clave, lista);
      if (usos.size > 5000) for (const [k, v] of usos) if (!v.some((x) => t - x < ventanaMs)) usos.delete(k); // limpieza
      return true;
    },
  };
}

/**
 * Manda la foto (Buffer jpeg/png) al endpoint de RunPod y devuelve { png: Buffer, ancho, alto, segundos }.
 * Usa /runsync y, si el trabajo sigue en cola (arranque en frío), consulta /status hasta `plazoMs`.
 */
export async function segmentarEnRunpod(foto, { apiKey, endpointId, fetchFn = fetch, plazoMs = 120_000, esperaMs = 1500, dormir = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const t0 = Date.now();
  let r = await fetchFn(`${BASE}/${endpointId}/runsync`, { method: 'POST', headers, body: JSON.stringify({ input: { imagen: foto.toString('base64') } }), signal: AbortSignal.timeout(plazoMs) });
  if (!r.ok) throw new Error(`runpod_http_${r.status}`);
  let job = await r.json();
  while (job.status === 'IN_QUEUE' || job.status === 'IN_PROGRESS') {
    if (Date.now() - t0 > plazoMs) throw new Error('runpod_tiempo_agotado');
    await dormir(esperaMs);
    r = await fetchFn(`${BASE}/${endpointId}/status/${job.id}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`runpod_http_${r.status}`);
    job = await r.json();
  }
  if (job.status !== 'COMPLETED') throw new Error(`runpod_${String(job.status ?? 'sin_estado').toLowerCase()}`);
  const out = job.output ?? {};
  if (out.error || !out.png) throw new Error(`segmentador: ${out.error ?? 'sin_png'}`);
  return { png: Buffer.from(out.png, 'base64'), ancho: out.ancho, alto: out.alto, segundos: out.segundos };
}
