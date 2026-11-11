// Web Worker: corre MobileSAM (ONNX Runtime Web, WASM) fuera del hilo de la interfaz.
import * as ort from 'onnxruntime-web/wasm';
import { Sam, encoderSize, rgbaToRgbFloat } from './sam.js';
import { runDetect } from './detect.js';
import { runSegmenter } from './seg.js';

// El .wasm lo empaqueta Vite junto al worker (ruta con hash), no hace falta configurar wasmPaths.
// 1 hilo por defecto. El multihilo (?threads=N) necesita SharedArrayBuffer => página con aislamiento de origen
// (COOP+COEP; en el servidor: CROSS_ORIGIN_ISOLATION=1). Ver docs/RENDIMIENTO-MOVIL.md.
ort.env.wasm.numThreads = 1;

let sam = null;
let seg = null; // segmentador semántico opcional { session, S } (ver seg.js); solo si la página pidió ?modelo=1
let lastImg = null; // la foto de trabajo (RGBA) con la que se calculó el encoder: la detección automática corre sobre ella, acá adentro
let cancelDetect = false; // lo levanta 'cancel' (o una foto nueva) y la detección en curso se corta antes de la próxima decodificación

/** Descarga un modelo con progreso y lo guarda en Cache Storage: la segunda visita no vuelve a bajarlo. */
async function loadModel(url, label, report) {
  const cache = await caches.open('sam-models-v1');
  const hit = await cache.match(url);
  if (hit && (hit.headers.get('content-type') ?? '').toLowerCase().includes('html')) { await cache.delete(url); } // una respuesta HTML guardada por error (el servidor responde la página cuando el modelo no existe): se descarta
  else if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer());
    report(label, buf.length, buf.length);
    return buf;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo bajar ${label} (${res.status})`);
  if ((res.headers.get('content-type') ?? '').toLowerCase().includes('html')) throw new Error(`${label}: el servidor devolvió una página en vez del modelo (¿falta el archivo?)`); // no se guarda en la caché
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    report(label, loaded, total || loaded);
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  await cache.put(url, new Response(buf.slice(), { headers: { 'content-type': 'application/octet-stream' } }));
  return buf;
}


let pedidoServidor = null; // { img, promesa }: el mapa del servidor para la foto actual, pedido en paralelo con el análisis de MobileSAM

/** Pide el mapa de clases al servidor con GPU (PNG 0 otro / 1 pared / 2 techo) y lo devuelve al tamaño de la foto; null si falla. */
async function pedirMapa(url, img) {
  try {
    const { width, height } = img, c = new OffscreenCanvas(width, height);
    c.getContext('2d').putImageData(new ImageData(img.data, width, height), 0, 0);
    const t0 = performance.now();
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bmp = await createImageBitmap(await r.blob()), d = new OffscreenCanvas(width, height), dctx = d.getContext('2d', { willReadFrequently: true });
    dctx.imageSmoothingEnabled = false; dctx.drawImage(bmp, 0, 0, width, height);
    const px = dctx.getImageData(0, 0, width, height).data, map = new Uint8Array(width * height), inst = new Uint8Array(width * height), veto = new Uint8Array(width * height);
    for (let i = 0; i < map.length; i++) { map[i] = px[i * 4]; inst[i] = px[i * 4 + 1]; if (px[i * 4 + 2] > 127 && px[i * 4 + 2] !== px[i * 4]) veto[i] = 1; } // R = clase, G = número de pared (si el PNG es gris, G = R y se ignora abajo)
    console.info(`[servidor] mapa listo en ${Math.round(performance.now() - t0)} ms (GPU ${r.headers.get('X-Segundos') ?? '?'} s)`);
    const rgb = inst.some((v, i) => v !== map[i]); // PNG RGB del servidor nuevo; uno gris viejo trae G = R
    return { map, inst: rgb ? inst : null, veto };
  } catch (e) { console.warn('[servidor] falló, se sigue con el modelo local:', e?.message); return null; }
}

const handlers = {
  async init({ encoderUrl, decoderUrl, threads }) {
    // Se fija acá (justo antes de crear la sesión) y no solo al cargar el módulo: así sí se respeta.
    // ?threads=N en la URL permite probar multihilo para diagnóstico.
    ort.env.wasm.numThreads = threads || 1;
    const bytes = { encoder: 0, decoder: 0 }, totals = { encoder: 0, decoder: 0 };
    const report = (which) => (_l, loaded, total) => {
      bytes[which] = loaded; totals[which] = total;
      const t = totals.encoder + totals.decoder;
      postMessage({ type: 'progress', loaded: bytes.encoder + bytes.decoder, total: t });
    };
    const [encoder, decoder] = await Promise.all([
      loadModel(encoderUrl, 'encoder', report('encoder')),
      loadModel(decoderUrl, 'decoder', report('decoder')),
    ]);
    const t0 = performance.now();
    sam = await Sam.create(ort, { encoder, decoder });
    return { threads: ort.env.wasm.numThreads, initMs: Math.round(performance.now() - t0) };
  },

  async loadSeg({ url, size = 256 }) {
    const bytes = await loadModel(url, 'seg', () => {});
    seg = { session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }), S: size };
    return {};
  },

  async embed({ rgba, width, height, servidor = null }) {
    const t0 = performance.now();
    const { width: rw, height: rh } = encoderSize(width, height);
    const data = new Uint8ClampedArray(rgba);
    lastImg = { data, width, height };
    pedidoServidor = servidor ? { img: lastImg, promesa: pedirMapa(servidor, lastImg) } : null; // en paralelo con MobileSAM
    const src = new OffscreenCanvas(width, height);
    src.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
    const dst = new OffscreenCanvas(rw, rh);
    const ctx = dst.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, rw, rh);
    const small = ctx.getImageData(0, 0, rw, rh).data;
    await sam.embed(rgbaToRgbFloat(small, rw, rh), rw, rh, width, height);
    return { embedMs: Math.round(performance.now() - t0) };
  },

  async segment({ points, fresh }) {
    if (fresh) sam.reset();
    const t0 = performance.now();
    const { mask, score } = await sam.segment(points);
    return { result: { mask, score, ms: Math.round(performance.now() - t0) }, transfer: [mask.buffer] };
  },

  reset() { sam?.reset(); return {}; },

  /**
   * Detección automática de paredes y techo, ACÁ en el Worker: antes corría en el hilo principal y congelaba la pantalla
   * (35-50 % del tiempo era JS puro). Avisa el progreso con 'detect-progress' y devuelve las máscaras transferidas (sin copiar).
   */
  async detect({ mode = 'auto', useModel = false, servidor = null } = {}) {
    if (!lastImg || !sam) throw new Error('falta analizar la foto antes de detectar');
    cancelDetect = false;
    let classMap = null, instancias = null, veto = null, delServidor = false;
    if (servidor) { // mapa del servidor (SAM 3 + r9): se pidió en paralelo apenas se cargó la foto (embed); si no, se pide ahora
      const pedido = pedidoServidor?.img === lastImg ? pedidoServidor.promesa : pedirMapa(servidor, lastImg);
      const r = await pedido; classMap = r?.map ?? null; instancias = r?.inst ?? null; veto = r?.veto ?? null; delServidor = !!classMap;
    }
    if (!classMap && useModel && seg) { // mapa de clases del modelo (a 1/8 de resolución, agrandado): guía las semillas de SAM; si algo falla se detecta como siempre
      try {
        const { width, height } = lastImg, S = seg.S, src = new OffscreenCanvas(width, height);
        src.getContext('2d').putImageData(new ImageData(lastImg.data, width, height), 0, 0);
        const dst = new OffscreenCanvas(S, S), ctx = dst.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, S, S);
        classMap = await runSegmenter(ort, seg.session, ctx.getImageData(0, 0, S, S).data, S, width, height);
      } catch (e) { console.warn('[modelo] falló, se usa el detector clásico:', e?.message); }
    }
    const { found, decodes, mode: used } = await runDetect({
      image: lastImg,
      segment: (pts) => { sam.reset(); return sam.segment(pts); }, // cada semilla es independiente (como antes: fresh = true)
      onProgress: (n) => postMessage({ type: 'detect-progress', n }),
      isCancelled: () => cancelDetect,
      mode,
      classMap,
      instancias,
      veto,
      opts: delServidor ? { semantico: { directo: true } } : classMap ? { semantico: { veto: true, completar: true } } : {}, // del servidor: superficies directo del mapa (sin SAM). // con el modelo: solo modelo + SAM (sin el detector clásico, que metía puertas); completar recupera paredes que SAM no tomó; veto: nada fuera de lo que el modelo ve como pared/techo. Medido 2026-11-07: COCO dev pared 0.600 (=), techo 0.689 (+0.016), mitad de tiempo
    });
    const safe = found.map((f) => ({ ...f, mask: f.mask.slice() })); // buffer propio de cada máscara: se pueden transferir sin choques
    return { result: { found: safe, decodes, mode: used }, transfer: safe.map((f) => f.mask.buffer) };
  },
};

// ONNX Runtime Web arranca sus hilos (pthreads) como Workers con ESTE MISMO script (name "em-pthread"). Si acá pisáramos
// self.onmessage, el mensaje de carga de cada hilo llegaría a nuestro manejador, que lo rechaza: el hilo nunca arranca y
// la creación de la sesión queda colgada para siempre. Esa era la causa del cuelgue de ?threads=N.
if (!self.name?.startsWith('em-pthread')) {
  const run = async ({ id, type, ...payload }) => {
    try {
      const out = (await handlers[type](payload)) ?? {};
      const { transfer, result, ...rest } = out;
      postMessage({ id, ok: true, ...(result ?? rest) }, transfer ?? []);
    } catch (e) {
      postMessage({ id, ok: false, error: String(e?.message ?? e) });
    }
  };
  // Los pedidos se atienden de a uno, en orden: SAM guarda estado (embeddings, última máscara) y la detección dura decenas de
  // segundos, así que un 'embed' o un 'segment' nuevo no puede pisarla a la mitad. 'cancel' es la excepción: no hace cola.
  let queue = Promise.resolve();
  self.onmessage = ({ data }) => {
    if (data.type === 'cancel') { cancelDetect = true; return; }
    if (data.type === 'embed') cancelDetect = true; // una foto nueva cancela la detección de la anterior
    queue = queue.then(() => run(data));
  };
}
