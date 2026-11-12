// Detección en el servidor con GPU (SAM 3 + r9) SIN usar nada pesado en el celular: se manda la foto, vuelve el mapa
// (PNG RGB: R = clase 0 otro / 1 pared / 2 techo, G = número de pared) y las superficies salen directo de él.
// Con esto el cliente no espera la descarga de ~45 MB de MobileSAM ni el análisis en el teléfono: foto -> ~3 s -> elegir colores.
import { superficiesDesdeMapa, rellenarBordes, marcarZocalos, afinarLimites, enderezarBordes, quitarCornisas, marcarOSB, enderezarTechoPared, separarMadera } from '@pintureria/core';

/** Lee un PNG de mapa (Blob) al tamaño de la foto: { map, inst|null }. Nearest (sin mezclar clases en los bordes). */
async function leerMapa(blob, width, height) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(width, height), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false; ctx.drawImage(bmp, 0, 0, width, height); bmp.close?.();
  const px = ctx.getImageData(0, 0, width, height).data, N = width * height, map = new Uint8Array(N), inst = new Uint8Array(N), veto = new Uint8Array(N);
  let rgb = false;
  let hayVeto = false;
  for (let i = 0; i < N; i++) { map[i] = px[i * 4]; inst[i] = px[i * 4 + 1]; if (inst[i] !== map[i]) rgb = true; const bz = px[i * 4 + 2]; if (bz > 127 && bz !== px[i * 4]) { veto[i] = bz >= 150 && bz <= 230 ? 2 : 1; hayVeto = true; } else if (bz >= 90 && bz <= 110) { veto[i] = 3; hayVeto = true; } }
  return { map, inst: rgb ? inst : null, veto: hayVeto ? veto : null }; // B = 255: zona prohibida por una regla (veto 1) · B = 200: objeto conocido (campana, portero, cable, llave...: veto 2, se rellena alrededor) · B = 100: madera/machimbre (veto 3, superficie sin color) // un PNG gris (servidor viejo) trae G = R: sin números de pared
}

/**
 * foto: { data (RGBA), width, height } · url: /api/public/segmentar?tenant=...
 * Devuelve { found: [{ name, kind, area, mask }], ms, gpu } o null si el servidor no respondió (la app sigue con el plan B del celular).
 */
export async function superficiesDelServidor(foto, url, { fetchFn = fetch } = {}) {
  const t0 = performance.now();
  try {
    const { data, width, height } = foto;
    const c = new OffscreenCanvas(width, height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    const r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { map, inst, veto } = await leerMapa(await r.blob(), width, height);
    // rellenarBordes: cierra las franjas blancas que deja el mapa en aristas, esquinas y contornos (foto de Agustín, 2026-11-11)
    const foto2 = { data: new Uint8ClampedArray(data), width, height };
    // marcarOSB: techo/pared de OSB queda sin color · quitarCornisas: la moldura pegada a la unión techo/pared no se pinta · enderezarBordes: el borde contra una moldura o un marco queda recto · marcarZocalos: el zócalo de otro color queda como superficie propia, que no se pinta con la pared
    const found = separarMadera(marcarOSB(enderezarBordes(quitarCornisas(marcarZocalos(enderezarTechoPared(afinarLimites(rellenarBordes(superficiesDesdeMapa(map, width, height, { instancias: inst }), foto2, { veto }), foto2), width, height), foto2), foto2), foto2, { veto }), foto2), veto, width, height);
    const ms = Math.round(performance.now() - t0), gpu = r.headers.get('X-Segundos');
    console.info(`[servidor] ${found.length} superficies en ${ms} ms (GPU ${gpu ?? '?'} s)`);
    return found.length ? { found, ms, gpu } : null;
  } catch (e) {
    console.warn('[servidor] no respondió, se usa el plan B del celular:', e?.message);
    return null;
  }
}
