import { pesos } from './whatsapp.js';

/** Clave única de un ítem en el carrito para agrupar duplicados. */
export function cartKey(item) {
  const colorKey = item.color ? (item.color.code || item.color.name || '') : '';
  return `${item.sku || item.name || 'item'}_${item.liters || 0}_${colorKey}`;
}

/** Calcula totales del carrito: cantidad de unidades y total en centavos. */
export function cartTotals(items = []) {
  let count = 0;
  let totalCents = 0;
  for (const item of items) {
    const qty = Math.max(0, Math.floor(item.qty || 0));
    count += qty;
    totalCents += qty * Math.max(0, item.unit_price_cents || 0);
  }
  return { count, totalCents, formattedTotal: pesos(totalCents) };
}

/** Agrega un ítem al carrito o incrementa su cantidad si ya existe. */
export function addToCart(items = [], newItem) {
  if (!newItem) return items;
  const qtyToAdd = Math.max(1, Math.floor(newItem.qty ?? 1));
  const key = cartKey(newItem);
  const idx = items.findIndex((it) => cartKey(it) === key);
  if (idx >= 0) {
    return items.map((it, i) => (i === idx ? { ...it, qty: it.qty + qtyToAdd } : it));
  }
  return [...items, { ...newItem, qty: qtyToAdd }];
}

/** Actualiza la cantidad de un ítem (por índice o por clave). Si es <= 0, lo elimina. */
export function updateCartQty(items = [], keyOrIndex, qty) {
  const newQty = Math.floor(qty);
  if (typeof keyOrIndex === 'number') {
    if (newQty <= 0) return items.filter((_, i) => i !== keyOrIndex);
    return items.map((it, i) => (i === keyOrIndex ? { ...it, qty: newQty } : it));
  }
  if (newQty <= 0) return items.filter((it) => cartKey(it) !== keyOrIndex);
  return items.map((it) => (cartKey(it) === keyOrIndex ? { ...it, qty: newQty } : it));
}

/** Elimina un ítem del carrito. */
export function removeFromCart(items = [], keyOrIndex) {
  return updateCartQty(items, keyOrIndex, 0);
}

/** Mensaje de WhatsApp para finalizar el pedido de la tienda. */
export function buildCartOrderMessage({ shop, branch, items = [], notes = '' } = {}) {
  const { totalCents, count } = cartTotals(items);
  const lines = [
    `Hola${shop ? ` ${shop}` : ''}${branch ? ` (sucursal ${branch})` : ''}! Quiero encargar este pedido desde la tienda web:`,
    '',
    `🛒 Detalle del pedido (${count} ${count === 1 ? 'artículo' : 'artículos'}):`,
  ];
  for (const item of items) {
    const lit = item.liters ? ` × ${String(item.liters).replace('.', ',')} L` : '';
    const color = item.color ? ` [Color: ${item.color.name}${item.color.code ? ` (${item.color.code})` : ''}]` : '';
    const unitPrice = item.unit_price_cents > 0 ? ` (${pesos(item.unit_price_cents)} c/u)` : '';
    lines.push(`   • ${item.qty} × ${item.name}${lit}${color}${unitPrice}`);
  }
  lines.push('', `💰 Total: ${pesos(totalCents)}`);
  if (notes.trim()) {
    lines.push('', `📝 Aclaraciones: ${notes.trim()}`);
  }
  lines.push('', '¿Tienen disponibilidad para retiro o envío? Muchas gracias.');
  return lines.join('\n');
}
