// Cliente de MobileSAM (encoder + decoder ONNX) independiente del entorno:
// recibe `ort` (onnxruntime-web en el navegador, o su build de Node en los tests).
//
// Contrato de los modelos (verificado inspeccionándolos, export de Acly/MobileSAM):
//  - encoder:  input_image [H,W,3] float32 en 0..255 (HWC). Normaliza y rellena a 1024x1024 por dentro,
//              pero NO redimensiona: el lado largo tiene que ser 1024. -> image_embeddings [1,256,64,64]
//  - decoder:  image_embeddings, point_coords [1,N,2], point_labels [1,N], mask_input [1,1,256,256],
//              has_mask_input [1], orig_im_size [2] -> masks [1,1,H,W], iou_predictions, low_res_masks
export const SAM_SIZE = 1024;

export class Sam {
  constructor(ort, encoder, decoder) {
    this.ort = ort;
    this.encoder = encoder;
    this.decoder = decoder;
    this.embeddings = null;
    this.scale = 1;
    this.lowRes = null; // máscara de baja resolución de la última predicción (afina clics sucesivos)
  }

  static async create(ort, { encoder, decoder }, sessionOptions = { executionProviders: ['wasm'] }) {
    const [e, d] = await Promise.all([
      ort.InferenceSession.create(encoder, sessionOptions),
      ort.InferenceSession.create(decoder, sessionOptions),
    ]);
    return new Sam(ort, e, d);
  }

  /**
   * Calcula los embeddings de la imagen. `rgb` es Float32Array HWC (0..255) YA redimensionada a lado largo 1024;
   * `origWidth/origHeight` son el tamaño de la foto de trabajo (donde se piden las máscaras y se dan los clics).
   */
  async embed(rgb, rw, rh, origWidth, origHeight) {
    const { Tensor } = this.ort;
    const out = await this.encoder.run({ input_image: new Tensor('float32', rgb, [rh, rw, 3]) });
    this.embeddings = out.image_embeddings;
    this.origWidth = origWidth;
    this.origHeight = origHeight;
    this.scale = SAM_SIZE / Math.max(origWidth, origHeight);
    this.lowRes = null;
  }

  /** Empieza una selección nueva (otro paño de pared): olvida la máscara previa. */
  reset() { this.lowRes = null; }

  /**
   * points: [{x, y, label}] en coordenadas de la foto de trabajo; label 1 = "esto es pared", 0 = "esto no".
   * Devuelve { mask: Uint8Array (W*H, 0/1), score }.
   */
  async segment(points) {
    if (!this.embeddings) throw new Error('falta llamar a embed() primero');
    if (!points.length) throw new Error('hace falta al menos un punto');
    const { Tensor } = this.ort;
    const n = points.length + 1; // SAM exige un punto de relleno (0,0) con etiqueta -1 cuando no hay caja
    const coords = new Float32Array(n * 2), labels = new Float32Array(n);
    points.forEach((p, i) => {
      coords[i * 2] = p.x * this.scale;
      coords[i * 2 + 1] = p.y * this.scale;
      labels[i] = p.label;
    });
    labels[n - 1] = -1;

    const out = await this.decoder.run({
      image_embeddings: this.embeddings,
      point_coords: new Tensor('float32', coords, [1, n, 2]),
      point_labels: new Tensor('float32', labels, [1, n]),
      mask_input: this.lowRes ?? new Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new Tensor('float32', [this.lowRes ? 1 : 0], [1]),
      orig_im_size: new Tensor('float32', [this.origHeight, this.origWidth], [2]),
    });
    this.lowRes = out.low_res_masks;
    const logits = out.masks.data;
    const mask = new Uint8Array(this.origWidth * this.origHeight);
    for (let i = 0; i < mask.length; i++) mask[i] = logits[i] > 0 ? 1 : 0;
    return { mask, score: out.iou_predictions.data[0] };
  }
}

/** Tamaño de trabajo: lado largo <= maxDim (la foto se reduce una sola vez al cargar). */
export function workingSize(w, h, maxDim = 1600) {
  const s = Math.min(1, maxDim / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** Tamaño de entrada del encoder: lado largo = 1024. */
export function encoderSize(w, h) {
  const s = SAM_SIZE / Math.max(w, h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** RGBA (Uint8ClampedArray) -> Float32Array HWC RGB sin alfa, en 0..255. */
export function rgbaToRgbFloat(rgba, w, h) {
  const out = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2];
  }
  return out;
}
