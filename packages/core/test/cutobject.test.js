import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutObjectFromSurface, maskCount } from '../src/index.js';

const W = 100, H = 100;
const rect = (x0, y0, x1, y1) => {
  const m = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1;
  return m;
};

test('un objeto chico dentro de la pared se resta y no toca el resto', () => {
  const wall = rect(0, 0, 100, 100), obj = rect(40, 40, 60, 60);
  const r = cutObjectFromSurface(wall, obj);
  assert.equal(r.ok, true);
  assert.equal(r.removed, 400);
  assert.equal(maskCount(r.mask), 10000 - 400);
  assert.equal(r.mask[50 * W + 50], 0);
  assert.equal(r.mask[10 * W + 10], 1);
});

test('no modifica la máscara original de la superficie', () => {
  const wall = rect(0, 0, 100, 100), before = wall.slice();
  const r = cutObjectFromSurface(wall, rect(10, 10, 20, 20));
  assert.deepEqual(wall, before);
  assert.notEqual(r.mask, wall);
});

test('un objeto que sobresale de la pared sólo resta la parte que se solapa', () => {
  const wall = rect(0, 0, 50, 100), obj = rect(40, 40, 60, 60); // 10 columnas dentro, 10 fuera
  const r = cutObjectFromSurface(wall, obj);
  assert.equal(r.ok, true);
  assert.equal(r.removed, 200);
  assert.equal(maskCount(r.mask), 5000 - 200);
});

test('sin solape: se rechaza con "no-overlap"', () => {
  const r = cutObjectFromSurface(rect(0, 0, 50, 50), rect(60, 60, 80, 80));
  assert.deepEqual(r, { ok: false, reason: 'no-overlap' });
});

test('máscara de SAM vacía: se rechaza con "empty"', () => {
  assert.deepEqual(cutObjectFromSurface(rect(0, 0, 50, 50), new Uint8Array(W * H)), { ok: false, reason: 'empty' });
});

test('superficie vacía: se rechaza con "empty" (sin dividir por cero)', () => {
  assert.deepEqual(cutObjectFromSurface(new Uint8Array(W * H), rect(0, 0, 10, 10)), { ok: false, reason: 'empty' });
});

test('SAM agarró casi toda la superficie (≥ 85 %): "too-big"', () => {
  const wall = rect(0, 0, 100, 100);
  assert.deepEqual(cutObjectFromSurface(wall, rect(0, 0, 100, 85)), { ok: false, reason: 'too-big' }); // justo 85 %
  assert.equal(cutObjectFromSurface(wall, rect(0, 0, 100, 84)).ok, false); // 84 % > 60 %: también grande
});

test('el recorte total pasa el 60 % de la superficie: "too-big"', () => {
  const wall = rect(0, 0, 100, 100);
  assert.equal(cutObjectFromSurface(wall, rect(0, 0, 100, 61)).reason, 'too-big');
  assert.equal(cutObjectFromSurface(wall, rect(0, 0, 100, 60)).ok, true); // justo 60 % todavía se acepta
});

test('el límite de 60 % cuenta también lo que cae fuera de la superficie', () => {
  const wall = rect(0, 0, 100, 10); // 1000 px
  const sale = rect(0, 5, 50, 30);  // 250 px adentro (25 %), 1250 totales = 125 % > 60 %
  assert.equal(cutObjectFromSurface(wall, sale).reason, 'too-big');
});

test('tamaños distintos lanzan error', () => {
  assert.throws(() => cutObjectFromSurface(new Uint8Array(10), new Uint8Array(11)));
});
