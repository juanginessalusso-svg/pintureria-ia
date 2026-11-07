import test from 'node:test';
import assert from 'node:assert/strict';
import { varita, labRapido, rgbToLab } from '../src/index.js';

const W = 120, H = 80;
function escena() { // pared con degradado de luz (200 -> 150), puerta oscura y un cuadro rojo
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 200 - Math.round((x / W) * 50), g = r - 4, b = r - 8;
    if (x >= 70 && x < 90 && y >= 20) { r = 60; g = 40; b = 30; } // puerta
    if (x >= 20 && x < 40 && y >= 10 && y < 30) { r = 190; g = 30; b = 40; } // cuadro rojo
    const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return { data: d, width: W, height: H };
}

test('labRapido coincide con rgbToLab', () => {
  const o = [0, 0, 0];
  for (const c of [[200, 190, 180], [10, 200, 30], [255, 255, 255], [0, 0, 0]]) {
    labRapido(c[0], c[1], c[2], o); const r = rgbToLab(c);
    assert.ok(Math.abs(o[0] - r.L) < 0.05 && Math.abs(o[1] - r.a) < 0.05 && Math.abs(o[2] - r.b) < 0.05, JSON.stringify([c, o, r]));
  }
});

test('varita: toma la pared completa con su degradado y se frena en la puerta y el cuadro', () => {
  const img = escena(), m = varita(img, 5, 50, { tol: 12, lejos: 2.4 }); // la escena tiene un degradado fuerte de luz: se pide más tolerancia
  assert.equal(m[50 * W + 5], 1);
  assert.equal(m[50 * W + 65], 1, 'sigue el degradado hasta la puerta');
  assert.equal(m[50 * W + 110], 1, 'y pasa al otro lado de la puerta por arriba/abajo');
  assert.equal(m[40 * W + 80], 0, 'la puerta no entra');
  assert.equal(m[20 * W + 30], 0, 'el cuadro rojo no entra');
  assert.equal(m[5 * W + 80], 1, 'la pared de arriba de la puerta sí');
});

test('varita: tolerancia baja toma menos y tolerancia alta toma de más', () => {
  const img = escena();
  const cuenta = (m) => m.reduce((a, v) => a + v, 0);
  const chica = cuenta(varita(img, 5, 50, { tol: 3, lejos: 1 })), media = cuenta(varita(img, 5, 50, { tol: 12, lejos: 2.4 })), grande = cuenta(varita(img, 5, 50, { tol: 120 }));
  assert.ok(chica < media && media < grande, `${chica} < ${media} < ${grande}`);
});
