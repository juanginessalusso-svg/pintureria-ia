import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afinarLimites, featherCapas } from '../src/limites.js';

// Foto 40x20: mitad izquierda clara, mitad derecha oscura (la arista en x = 20). Las dos paredes vienen con el límite dentado.
function foto() {
  const w = 40, h = 20, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < 20 ? 230 : 150, i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  return { data, width: w, height: h };
}

test('afinarLimites: el límite entre dos paredes va a la arista de la foto', () => {
  const img = foto(), { width: w, height: h } = img, N = w * h;
  const a = new Uint8Array(N), b = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const corte = 20 + ((y % 4) - 2) * 2; (x < corte ? a : b)[y * w + x] = 1; } // dentado ±4 px
  const out = afinarLimites([{ kind: 'pared', mask: a, area: 0 }, { kind: 'pared', mask: b, area: 0 }], img, { banda: 6 });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.equal(out[0].mask[y * w + x], x < 20 ? 1 : 0, `(${x},${y})`);
  assert.equal(out[0].area + out[1].area, 1); // no cambia lo pintado en total
});

test('afinarLimites: con una sola superficie no toca nada', () => {
  const img = foto(), m = new Uint8Array(img.width * img.height).fill(1), f = [{ kind: 'pared', mask: m, area: 1 }];
  assert.equal(afinarLimites(f, img), f);
});

test('featherCapas: en la unión de dos capas no queda nada sin pintar; contra lo que no se pinta sí suaviza', () => {
  const w = 30, h = 10, N = w * h, a = new Uint8Array(N), b = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (x < 10) a[y * w + x] = 1; else if (x < 20) b[y * w + x] = 1; } // x >= 20: puerta
  const [sa, sb] = featherCapas([a, b], w, h, 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 18; x++) { /* x 18-19: el borde contra la puerta, que sí se suaviza */ const i = y * w + x; assert.ok(sa[i] + sb[i] >= 0.999, `hueco en (${x},${y}): ${sa[i] + sb[i]}`); }
    assert.ok(sb[y * w + 19] < 1 && sb[y * w + 19] > 0, 'borde contra la puerta suavizado');
    assert.equal(sa[y * w + 12], 0); // a no se mete en b
  }
});
