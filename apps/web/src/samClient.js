// Cliente del worker: cada llamada devuelve una promesa.
export class SamClient {
  constructor(onProgress) {
    this.worker = new Worker(new URL('./sam.worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.nextId = 1;
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return onProgress?.(data);
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
    const threads = Number(new URLSearchParams(location.search).get('threads')) || 0;
    return this.call('init', { encoderUrl: '/models/mobile_sam_image_encoder.onnx', decoderUrl: '/models/sam_mask_decoder_single.onnx', threads });
  }
  embed(rgba, width, height) { return this.call('embed', { rgba, width, height }, [rgba]); }
  segment(points, fresh) { return this.call('segment', { points, fresh }); }
  terminate() { this.worker.terminate(); }
}
