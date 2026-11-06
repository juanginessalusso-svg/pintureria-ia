// Segmentador semántico de interiores (pared / techo / piso / otro) como guía de SAM. Parte pura (sin DOM ni Worker) para probarla con `node --test`.
// El modelo (training/train.py) recibe RGB 0..1 [1,3,S,S] y devuelve logits [1,4,S/8,S/8]; acá se agrandan (bilineal) al tamaño de trabajo y se hace argmax.

/** logits: Float32Array [K*lh*lw] (K clases), dims [1,K,lh,lw] -> Uint8Array(width*height) con la clase de cada píxel. */
export function classMapFromLogits(logits, dims, width, height) {
  const [, K, lh, lw] = dims, out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(lh - 1, Math.max(0, ((y + 0.5) * lh) / height - 0.5)), y0 = Math.floor(fy), y1 = Math.min(lh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(lw - 1, Math.max(0, ((x + 0.5) * lw) / width - 0.5)), x0 = Math.floor(fx), x1 = Math.min(lw - 1, x0 + 1), tx = fx - x0;
      let best = 0, bv = -Infinity;
      for (let k = 0; k < K; k++) {
        const b = k * lh * lw;
        const v = (logits[b + y0 * lw + x0] * (1 - tx) + logits[b + y0 * lw + x1] * tx) * (1 - ty) + (logits[b + y1 * lw + x0] * (1 - tx) + logits[b + y1 * lw + x1] * tx) * ty;
        if (v > bv) { bv = v; best = k; }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

/** RGBA (S*S*4, ya reducida a SxS) -> tensor plano NCHW 0..1. */
export function rgbaToNchw(rgba, S) {
  const t = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) t[c * S * S + i] = rgba[i * 4 + c] / 255;
  return t;
}

/** Corre la sesión de ONNX Runtime y devuelve el mapa de clases al tamaño de trabajo. `small` = RGBA de la foto reducida a SxS. */
export async function runSegmenter(ort, session, small, S, width, height) {
  const out = await session.run({ rgb: new ort.Tensor('float32', rgbaToNchw(small, S), [1, 3, S, S]) });
  return classMapFromLogits(out.logits.data, out.logits.dims, width, height);
}
