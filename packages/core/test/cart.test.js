import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cartKey,
  cartTotals,
  addToCart,
  updateCartQty,
  removeFromCart,
  buildCartOrderMessage,
} from '../src/index.js';

test('cartKey: genera clave única según sku, litros y color', () => {
  const k1 = cartKey({ sku: 'LAT-INT', liters: 4 });
  const k2 = cartKey({ sku: 'LAT-INT', liters: 10 });
  const k3 = cartKey({ sku: 'LAT-INT', liters: 4, color: { code: 'V-201', name: 'Verde' } });
  assert.notEqual(k1, k2);
  assert.notEqual(k1, k3);
  assert.equal(cartKey({ sku: 'LAT-INT', liters: 4 }), k1);
});

test('cartTotals: calcula cantidad total y precio total en pesos centavos', () => {
  const items = [
    { sku: 'A', name: 'Prod A', liters: 4, unit_price_cents: 4800000, qty: 2 },
    { sku: 'B', name: 'Prod B', liters: 1, unit_price_cents: 1500000, qty: 1 },
  ];
  const { count, totalCents, formattedTotal } = cartTotals(items);
  assert.equal(count, 3);
  assert.equal(totalCents, 2 * 4800000 + 1500000); // 11.100.000 centavos = $111.000
  assert.equal(formattedTotal, '$111.000');
});

test('addToCart: agrega producto nuevo o suma cantidad si ya existe', () => {
  let cart = [];
  cart = addToCart(cart, { sku: 'LAT', name: 'Látex', liters: 4, unit_price_cents: 500000, qty: 1 });
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 1);

  // Mismo producto, suma 2
  cart = addToCart(cart, { sku: 'LAT', name: 'Látex', liters: 4, unit_price_cents: 500000, qty: 2 });
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 3);

  // Producto con distinto tamaño se agrega como nuevo ítem
  cart = addToCart(cart, { sku: 'LAT', name: 'Látex', liters: 10, unit_price_cents: 1100000, qty: 1 });
  assert.equal(cart.length, 2);
});

test('updateCartQty y removeFromCart: actualiza o elimina si cantidad es 0', () => {
  let cart = [
    { sku: 'A', name: 'A', liters: 4, unit_price_cents: 1000, qty: 2 },
    { sku: 'B', name: 'B', liters: 1, unit_price_cents: 2000, qty: 1 },
  ];
  cart = updateCartQty(cart, 0, 5);
  assert.equal(cart[0].qty, 5);

  // Disminuir a 0 elimina
  cart = updateCartQty(cart, 0, 0);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].sku, 'B');

  // removeFromCart
  cart = removeFromCart(cart, 0);
  assert.equal(cart.length, 0);
});

test('buildCartOrderMessage: arma el texto de WhatsApp completo y claro', () => {
  const items = [
    { sku: 'LAT', name: 'Látex Lavable', liters: 4, unit_price_cents: 4800000, qty: 2, color: { name: 'Verde Salvia', code: 'TS-10' } },
  ];
  const msg = buildCartOrderMessage({
    shop: 'Plaza Olmos',
    branch: 'Centro',
    items,
    notes: 'Retiro el sábado por la mañana',
  });
  assert.ok(msg.includes('Hola Plaza Olmos (sucursal Centro)!'));
  assert.ok(msg.includes('2 × Látex Lavable × 4 L [Color: Verde Salvia (TS-10)] ($48.000 c/u)'));
  assert.ok(msg.includes('Total: $96.000'));
  assert.ok(msg.includes('Aclaraciones: Retiro el sábado por la mañana'));
});
