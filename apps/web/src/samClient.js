// Cliente del worker: cada llamada devuelve una promesa.
export class SamClient {
  constructor(onProgress) {
    this.worker = new Worker(new URL('./sam.worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.nextId = 1;
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return onProgress?.(data);
      if (data.type === 'detect-progress') return this.onDetectProgress?.(data.n);
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      data.ok ? p.resolve(data) : p.reject(new Error(data.error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'error del worker'));
      this.pending.clear();
    };
  }

  call(type, payload = {}, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  init() {
    // ?threads=N fuerza la cantidad. Sin el parámetro: 1 hilo, salvo que el servidor haya activado el aislamiento de origen
    // (CROSS_ORIGIN_ISOLATION=1, ver docs/RENDIMIENTO-MOVIL.md): ahí se usa la mitad de los núcleos (máx. 4).
    // Sin aislamiento onnxruntime-web ignora el pedido y usa 1 hilo (con un aviso en consola), así que nunca falla.
    const forced = Number(new URLSearchParams(location.search).get('threads')) || 0;
    const auto = globalThis.crossOriginIsolated ? Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 0;
    const threads = forced || auto;
    return this.call('init', { encoderUrl: '/models/mobile_sam_image_encoder.onnx', decoderUrl: '/models/sam_mask_decoder_single.onnx', threads }).then(async (r) => {
      // ?modelo=1 (opt-in, experimental): segmentador semántico propio como guía de SAM. Si el archivo no está en /models, se sigue sin él.
      if (new URLSearchParams(location.search).get('modelo') === '1') {
        try { await this.call('loadSeg', { url: '/models/interior-seg-r8.onnx', size: 320 }); this.useSeg = true; } catch (e) { console.warn('[modelo] no se pudo cargar el segmentador:', e?.message); }
      }
      return r;
    });
  }
  embed(rgba, width, height) { return this.call('embed', { rgba, width, height }, [rgba]); }
  segment(points, fresh) { return this.call('segment', { points, fresh }); }
  /** Detección automática de superficies: corre en el Worker (la interfaz no se congela). El progreso llega por `onDetectProgress(n)`. */
  detect(mode = 'auto') { return this.call('detect', { mode, useModel: !!this.useSeg }); }
  /** Corta la detección en curso (si la hay) antes de su próxima decodificación. */
  cancelDetect() { this.worker.postMessage({ type: 'cancel' }); }
  terminate() { this.worker.terminate(); }
}
