import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cleanMask, detectSurfaces } from '@pintureria/core';
import { runDetect, DetectCancelled } from '../src/detect.js';

// Habitación sintética (igual que la de los tests del core): techo claro, pared grande y un hueco de puerta oscuro.
const W = 240, H = 320;
function room() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let v = 200 - Math.round((x / W) * 12);
    if (y < H * 0.2) v = 235;
    else if (x > 90 && x < 150 && y > H * 0.4 && y < H * 0.85) v = 40;
    data[i] = v; data[i + 1] = v; data[i + 2] = y < H * 0.2 || (x > 90 && x < 150 && y > H * 0.4 && y < H * 0.85) ? v : v - 4; data[i + 3] = 255;
  }
  return data;
}
async function fakeSegment(pts) {
  const m = new Uint8Array(W * H), { x, y } = pts[0];
  const inTecho = y < H * 0.2, inHueco = x > 90 && x < 150 && y > H * 0.4 && y < H * 0.85;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const t = j < H * 0.2, h = i > 90 && i < 150 && j > H * 0.4 && j < H * 0.85;
    if (inTecho ? t : inHueco ? h : !t && !h) m[j * W + i] = 1;
  }
  return { mask: m };
}
const md5 = (u8) => createHash('md5').update(u8).digest('hex');

test('runDetect: mismo resultado que llamar a detectSurfaces directo (pared + techo, hueco descartado)', async () => {
  const image = { data: room(), width: W, height: H };
  const directo = await detectSurfaces(image, async (pts) => cleanMask((await fakeSegment(pts.map((q) => ({ ...q, label: 1 })))).mask, W, H));
  const { found, decodes } = await runDetect({ image, segment: fakeSegment });
  assert.deepEqual(found.map((f) => [f.name, f.kind, f.area]), directo.map((f) => [f.name, f.kind, f.area]));
  assert.deepEqual(found.map((f) => md5(f.mask)), directo.map((f) => md5(f.mask)));
  assert.deepEqual(found.map((f) => f.kind).sort(), ['pared', 'techo']);
  assert.ok(decodes >= 2);
  // solo devuelve lo que la interfaz usa
  assert.deepEqual(Object.keys(found[0]).sort(), ['area', 'kind', 'mask', 'name']);
});

test('runDetect: avisa el progreso ANTES de cada decodificación, de 0 en adelante y sin saltos', async () => {
  const progreso = [];
  let llamadas = 0;
  const { decodes } = await runDetect({
    image: { data: room(), width: W, height: H },
    segment: async (pts) => { llamadas++; return fakeSegment(pts); },
    onProgress: (n) => progreso.push(n),
  });
  assert.equal(llamadas, decodes);
  assert.deepEqual(progreso, Array.from({ length: decodes }, (_, i) => i));
});

test('runDetect: cancelar corta con DetectCancelled y no sigue pidiéndole cosas a SAM', async () => {
  let llamadas = 0;
  let cancelar = false;
  await assert.rejects(
    runDetect({
      image: { data: room(), width: W, height: H },
      segment: async (pts) => { llamadas++; cancelar = true; return fakeSegment(pts); }, // se cancela durante la primera decodificación
      isCancelled: () => cancelar,
    }),
    (e) => e instanceof DetectCancelled && e.message === 'cancelado',
  );
  assert.equal(llamadas, 1);
});

test('runDetect: un error de SAM se propaga (la interfaz lo muestra)', async () => {
  await assert.rejects(
    runDetect({ image: { data: room(), width: W, height: H }, segment: async () => { throw new Error('SAM falló'); } }),
    /SAM falló/,
  );
});

test('modo fachada: usa el detector de fachadas y avisa cuál usó', async () => {
  const W = 120, H = 90, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(y < 20 ? [40, 110, 220, 255] : y >= 72 ? [120, 120, 118, 255] : [225, 205, 170, 255], (y * W + x) * 4);
  const segment = async ([p]) => { const m = new Uint8Array(W * H), y0 = p.y < 20 ? 0 : p.y >= 72 ? 72 : 20, y1 = p.y < 20 ? 20 : p.y >= 72 ? H : 72; for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) m[y * W + x] = 1; return { mask: m }; };
  const r = await runDetect({ image: { data, width: W, height: H }, segment, mode: 'fachada' });
  assert.equal(r.mode, 'fachada');
  assert.equal(r.found.filter((f) => f.kind === 'pared').length, 1);
});

test('runDetect: mergeTecho conserva el techo del interior cuando no hay pared y se cae a fachada (apagado: queda solo el techo)', async () => {
  const data = room();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // techo medio (luma 150) y "pared" con ruido de alto contraste: no es una zona lisa
    const i = (y * W + x) * 4;
    const v = y < H * 0.2 ? 150 : (x * 7 + y * 13) % 2 ? 250 : 10;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  const image = { data, width: W, height: H };
  const apagado = await runDetect({ image, segment: fakeSegment });
  assert.deepEqual(apagado.found.map((f) => f.kind), ['techo']);
  assert.equal(apagado.mode, 'interior');
  const prendido = await runDetect({ image, segment: fakeSegment, mergeTecho: true });
  assert.equal(prendido.mode, 'fachada');
  assert.ok(prendido.found.some((f) => f.kind === 'techo'), prendido.found.map((f) => f.kind).join());
});

test('runDetect: techoManda recorta el techo del interior de los paños de la fachada (apagado: el techo solo queda con lo que la fachada no ocupó)', async () => {
  const data = room();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = y < H * 0.2 ? 150 : (x * 7 + y * 13) % 2 ? 250 : 10;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  const image = { data, width: W, height: H };
  const interior = (await runDetect({ image, segment: fakeSegment })).found.find((f) => f.kind === 'techo');
  const manda = await runDetect({ image, segment: fakeSegment, mergeTecho: true, opts: { techoManda: true } });
  assert.equal(manda.mode, 'fachada');
  const techo = manda.found.find((f) => f.kind === 'techo');
  assert.ok(techo && Math.abs(techo.area - interior.area) < 1e-9, 'el techo del interior queda entero');
  for (const f of manda.found) if (f !== techo) for (let i = 0; i < f.mask.length; i++) assert.ok(!(f.mask[i] && techo.mask[i]), 'ningún paño pisa el techo');
});
