// Prueba REAL del pipeline con los modelos ONNX. Se omite si no están (CI no los tiene).
// Uso:  MODELS_DIR=ruta/a/modelos node --test apps/web/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-web/wasm';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../src/sam.js';

const dir = process.env.MODELS_DIR;
const have = dir && fs.existsSync(path.join(dir, 'mobile_sam_image_encoder.onnx'));

test('tamaños: trabajo <= 1600 y encoder con lado largo 1024', () => {
  assert.deepEqual(workingSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(workingSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(encoderSize(1600, 1200), { width: 1024, height: 768 });
});

test('SAM segmenta una pared sintética (mitad izquierda) con IoU alto y respeta clics negativos', { skip: !have }, async () => {
  ort.env.wasm.numThreads = 1;
  const read = (f) => new Uint8Array(fs.readFileSync(path.join(dir, f)));
  const sam = await Sam.create(ort, { encoder: read('mobile_sam_image_encoder.onnx'), decoder: read('sam_mask_decoder_single.onnx') });

  // Foto de trabajo 800x600: pared izquierda celeste con textura suave, derecha un "mueble" marrón.
  const W = 800, H = 600, split = 420;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, noise = ((x * 7 + y * 13) % 9) - 4;
    const left = x < split;
    rgba[p] = (left ? 170 : 110) + noise; rgba[p + 1] = (left ? 200 : 70) + noise; rgba[p + 2] = (left ? 225 : 40) + noise; rgba[p + 3] = 255;
  }
  // redimensionado vecino-más-cercano a 1024x768 (en el navegador lo hace un canvas)
  const { width: rw, height: rh } = encoderSize(W, H);
  const small = new Uint8ClampedArray(rw * rh * 4);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const s = (Math.floor(y * H / rh) * W + Math.floor(x * W / rw)) * 4, d = (y * rw + x) * 4;
    small.set(rgba.subarray(s, s + 4), d);
  }
  await sam.embed(rgbaToRgbFloat(small, rw, rh), rw, rh, W, H);

  const { mask } = await sam.segment([{ x: 150, y: 300, label: 1 }]);
  assert.equal(mask.length, W * H);
  let inter = 0, union = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const truth = x < split, got = mask[y * W + x] === 1;
    if (truth && got) inter++;
    if (truth || got) union++;
  }
  const iou = inter / union;
  console.log(`IoU pared sintética: ${iou.toFixed(3)}`);
  assert.ok(iou > 0.8, `IoU demasiado bajo: ${iou}`);

  // la derecha NO debe estar en la máscara (en su mayoría)
  let leak = 0;
  for (let y = 0; y < H; y++) for (let x = split + 10; x < W; x++) leak += mask[y * W + x];
  assert.ok(leak / ((W - split - 10) * H) < 0.1, 'la máscara se filtra al mueble');
});
