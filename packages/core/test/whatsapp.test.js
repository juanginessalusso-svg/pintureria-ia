import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetMessage, whatsappUrl, cleanWhatsapp, pesos, suggestCans, litersNeeded } from '../src/index.js';

const SIZES = [{ liters: 4, price_cents: 4800000 }, { liters: 10, price_cents: 11000000 }];

function ejemplo(extra = {}) {
  const liters = litersNeeded({ m2: 18, coats: 3, yieldM2PerL: 11 }); // 5,4 L
  return {
    shop: 'Pinturería Demo',
    color: { name: 'Verde Salvia', code: 'V-201' },
    product: { name: 'Látex interior mate', sku: 'LAT-INT-MATE' },
    coats: 3, m2: 18, liters, cans: suggestCans(liters, SIZES), ref: 'PA-7K3Q', date: '04/11/2026', ...extra,
  };
}

test('pesos: formato argentino con puntos de mil', () => {
  assert.equal(pesos(4800000), '$48.000');
  assert.equal(pesos(123456700), '$1.234.567');
  assert.equal(pesos(0), '$0');
});

test('cleanWhatsapp: deja dígitos y valida el largo', () => {
  assert.equal(cleanWhatsapp('+54 9 11 1234-5678'), '5491112345678');
  assert.equal(cleanWhatsapp('123'), '');
  assert.equal(cleanWhatsapp(''), '');
  assert.equal(cleanWhatsapp(undefined), '');
  assert.equal(cleanWhatsapp('1'.repeat(16)), '');
});

test('mensaje: trae color, producto, manos, m², litros, latas y total', () => {
  const t = buildBudgetMessage(ejemplo());
  for (const s of ['Hola Pinturería Demo!', 'Color: Verde Salvia (V-201)', 'Producto: Látex interior mate (LAT-INT-MATE)', 'Manos: 3',
    'Superficie: 18 m² (estimada)', 'Pintura necesaria: 5,4 L (incluye 10 % de margen)', '2 × 4 L ($48.000 c/u)', 'Total estimado: $96.000',
    'estimación', 'Ref: PA-7K3Q · 04/11/2026']) {
    assert.ok(t.includes(s), `falta: ${s}\n${t}`);
  }
});

test('mensaje: sin color ni precios no inventa líneas', () => {
  const sinPrecio = [{ liters: 4, price_cents: 0 }];
  const liters = 3;
  const t = buildBudgetMessage(ejemplo({ color: undefined, liters, cans: suggestCans(liters, sinPrecio) }));
  assert.ok(!t.includes('Color:'));
  assert.ok(!t.includes('Total estimado'));
  assert.ok(!t.includes('c/u'));
  assert.ok(t.includes('1 × 4 L'));
});

test('mensaje: no contiene datos personales ni la foto (solo lo calculado)', () => {
  const t = buildBudgetMessage(ejemplo());
  assert.ok(!/data:image|base64|@|tel/i.test(t));
});

test('whatsappUrl: con número abre el chat; sin número deja elegir contacto; el texto va codificado', () => {
  const text = buildBudgetMessage(ejemplo());
  const u = whatsappUrl('+54 9 11 1234-5678', text);
  assert.ok(u.startsWith('https://wa.me/5491112345678?text='));
  const back = decodeURIComponent(u.split('?text=')[1]);
  assert.equal(back, text); // ida y vuelta exacta (emojis, saltos de línea, tildes, $)
  assert.ok(whatsappUrl('', 'hola').startsWith('https://wa.me/?text=hola'));
  assert.ok(!u.includes(' ') && !u.includes('\n'));
});
