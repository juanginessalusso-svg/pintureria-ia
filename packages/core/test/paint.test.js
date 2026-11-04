import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pxPerMeter, areaM2, wallPixels, litersNeeded, suggestCans } from '../src/index.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// Presentaciones de ejemplo (precios en centavos): 4 L $48.000, 10 L $110.000, 20 L $200.000
const SIZES = [
  { liters: 4, price_cents: 4800000 },
  { liters: 10, price_cents: 11000000 },
  { liters: 20, price_cents: 20000000 },
];

test('pxPerMeter: puerta de 2,05 m que mide 500 px en la foto', () => {
  close(pxPerMeter({ x: 100, y: 100 }, { x: 100, y: 600 }, 2.05), 500 / 2.05);
  close(pxPerMeter({ x: 0, y: 0 }, { x: 300, y: 400 }, 2), 250); // hipotenusa 3-4-5
});

test('pxPerMeter rechaza medidas inválidas', () => {
  assert.throws(() => pxPerMeter({ x: 0, y: 0 }, { x: 100, y: 0 }, 0));
  assert.throws(() => pxPerMeter({ x: 0, y: 0 }, { x: 100, y: 0 }, -1));
  assert.throws(() => pxPerMeter({ x: 5, y: 5 }, { x: 6, y: 5 }, 2)); // puntos pegados
});

test('areaM2: 100x100 px a 100 px/m = 1 m²; y escala 2x => 1/4 del área', () => {
  close(areaM2(10000, 100), 1);
  close(areaM2(10000, 200), 0.25);
  assert.throws(() => areaM2(10000, 0));
});

test('wallPixels une máscaras sin contar dos veces', () => {
  const a = new Uint8Array([1, 1, 0, 0]), b = new Uint8Array([0, 1, 1, 0]);
  assert.equal(wallPixels([a]), 2);
  assert.equal(wallPixels([a, b]), 3);
  assert.equal(wallPixels([]), 0);
});

test('litros = m² × manos ÷ rendimiento × 1,10', () => {
  close(litersNeeded({ m2: 20, coats: 2, yieldM2PerL: 10 }), 4.4);
  close(litersNeeded({ m2: 12.5, coats: 3, yieldM2PerL: 8, margin: 0 }), 4.6875);
  close(litersNeeded({ m2: 0, coats: 2, yieldM2PerL: 10 }), 0);
  assert.throws(() => litersNeeded({ m2: 10, coats: 0, yieldM2PerL: 10 }));
  assert.throws(() => litersNeeded({ m2: 10, coats: 2, yieldM2PerL: 0 }));
  assert.throws(() => litersNeeded({ m2: -1, coats: 2, yieldM2PerL: 10 }));
});

test('latas: 4,4 L => 2 x 4 L (menor costo que 1 x 10 L) con sobrante 3,6', () => {
  const r = suggestCans(4.4, SIZES);
  assert.deepEqual(r.items.map((i) => [i.liters, i.qty]), [[4, 2]]);
  assert.equal(r.total_cents, 9600000);
  close(r.leftover_liters, 3.6);
});

test('latas: 13 L => 10 L + 4 L', () => {
  const r = suggestCans(13, SIZES);
  assert.deepEqual(r.items.map((i) => [i.liters, i.qty]), [[10, 1], [4, 1]]);
  assert.equal(r.total_cents, 15800000);
  close(r.leftover_liters, 1);
});

test('latas: 37 L => 2 x 20 L (40 L por $400.000 sale menos que 20+10+4+4 = $406.000)', () => {
  const r = suggestCans(37, SIZES);
  assert.deepEqual(r.items.map((i) => [i.liters, i.qty]), [[20, 2]]);
  assert.equal(r.total_cents, 40000000);
});

test('latas: coincide con fuerza bruta (costo mínimo que cubre) para 200 valores', () => {
  const brute = (liters) => {
    let best = Infinity;
    for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) for (let c = 0; c <= 12; c++) {
      if (a * 4 + b * 10 + c * 20 >= liters - 1e-9) best = Math.min(best, a * 4800000 + b * 11000000 + c * 20000000);
    }
    return best;
  };
  for (let i = 1; i <= 200; i++) {
    const liters = i * 0.37; // 0,37 … 74 L
    const r = suggestCans(liters, SIZES);
    assert.ok(r.total_liters >= liters - 1e-9, `cubre ${liters}`);
    assert.equal(r.total_cents, brute(liters), `costo óptimo para ${liters} L`);
  }
});

test('latas: lo justo exacto no suma una lata de más', () => {
  const r = suggestCans(8, SIZES);
  assert.deepEqual(r.items.map((i) => [i.liters, i.qty]), [[4, 2]]);
  close(r.leftover_liters, 0);
});

test('latas: sin precios minimiza el sobrante; sin presentaciones devuelve null', () => {
  const sinPrecio = [{ liters: 4, price_cents: 0 }, { liters: 10, price_cents: 0 }, { liters: 20, price_cents: 0 }];
  const r = suggestCans(13, sinPrecio);
  assert.ok(r.total_liters >= 13 && r.leftover_liters <= 1.0001);
  assert.equal(suggestCans(5, []), null);
  assert.equal(suggestCans(0, SIZES), null);
});

test('latas: presentaciones raras (3,6 L y 0,9 L) y cantidades grandes', () => {
  const sizes = [{ liters: 0.9, price_cents: 1000 }, { liters: 3.6, price_cents: 3400 }, { liters: 18, price_cents: 15000 }];
  const r = suggestCans(40.2, sizes);
  assert.ok(r.total_liters >= 40.2);
  const big = suggestCans(500, SIZES);
  assert.ok(big.total_liters >= 500 && big.total_liters < 520);
});
