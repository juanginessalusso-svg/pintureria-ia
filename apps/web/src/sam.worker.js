// Web Worker: corre MobileSAM (ONNX Runtime Web, WASM) fuera del hilo de la interfaz.
import * as ort from 'onnxruntime-web/wasm';
import { Sam, encoderSize, rgbaToRgbFloat } from './sam.js';
import { runDetect } from './detect.js';

// El .wasm lo empaqueta Vite junto al worker (ruta con hash), no hace falta configurar wasmPaths.
// 1 hilo por defecto. El multihilo (?threads=N) necesita SharedArrayBuffer => página con aislamiento de origen
// (COOP+COEP; en el servidor: CROSS_ORIGIN_ISOLATION=1). Ver docs/RENDIMIENTO-MOVIL.md.
ort.env.wasm.numThreads = 1;

let sam = null;
let lastImg = null; // la foto de trabajo (RGBA) con la que se calculó el encoder: la detección automática corre sobre ella, acá adentro
let cancelDetect = false; // lo levanta 'cancel' (o una foto nueva) y la detección en curso se corta antes de la próxima decodificación

/** Descarga un modelo con progreso y lo guarda en Cache Storage: la segunda visita no vuelve a bajarlo. */
async function loadModel(url, label, report) {
  const cache = await caches.open('sam-models-v1');
  const hit = await cache.match(url);
  if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer());
    report(label, buf.length, buf.length);
    return buf;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo bajar ${label} (${res.status})`);
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

  async embed({ rgba, width, height }) {
    const t0 = performance.now();
    const { width: rw, height: rh } = encoderSize(width, height);
    const data = new Uint8ClampedArray(rgba);
    lastImg = { data, width, height };
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
  async detect() {
    if (!lastImg || !sam) throw new Error('falta analizar la foto antes de detectar');
    cancelDetect = false;
    const { found, decodes } = await runDetect({
      image: lastImg,
      segment: (pts) => { sam.reset(); return sam.segment(pts); }, // cada semilla es independiente (como antes: fresh = true)
      onProgress: (n) => postMessage({ type: 'detect-progress', n }),
      isCancelled: () => cancelDetect,
    });
    const safe = found.map((f) => ({ ...f, mask: f.mask.slice() })); // buffer propio de cada máscara: se pueden transferir sin choques
    return { result: { found: safe, decodes }, transfer: safe.map((f) => f.mask.buffer) };
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
