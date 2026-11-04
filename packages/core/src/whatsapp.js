// Presupuesto por WhatsApp: arma el texto y el link wa.me. Funciones puras: no guardan ni envían nada.
// Es el usuario quien toca "Enviar" en WhatsApp; el link solo deja el mensaje escrito.

/** 48000 -> "48.000" (formato es-AR sin depender de ICU). */
const miles = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// Solo muestra centavos cuando los hay: 4800000 -> "$48.000"; 700050 -> "$7.000,50".
export const pesos = (cents) => {
  const n = Math.round(cents);
  const rest = Math.abs(n % 100);
  return `$${miles(Math.trunc(n / 100))}${rest ? `,${String(rest).padStart(2, '0')}` : ''}`;
};
/** 4 -> "4", 1.4 -> "1,4" */
const lit = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

/** Deja solo dígitos; válido si tiene entre 8 y 15 (formato internacional sin +, ej: 5491112345678). */
export function cleanWhatsapp(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}

/**
 * Texto del presupuesto.
 * { shop, color?:{name,code}, product:{name,sku}, coats, m2, liters, cans:{items,total_cents,total_liters,leftover_liters}|null,
 *   margin?, ref?, date? }
 */
export function buildBudgetMessage({ shop, branch, color, product, coats, m2, liters, cans, margin = 0.1, ref, date }) {
  const lines = [
    `Hola${shop ? ` ${shop}` : ''}${branch ? ` (sucursal ${branch})` : ''}! Quiero consultar este presupuesto que armé en el visualizador:`,
    '',
  ];
  if (color) lines.push(`🎨 Color: ${color.name}${color.code ? ` (${color.code})` : ''}`);
  lines.push(
    `🧴 Producto: ${product.name}${product.sku ? ` (${product.sku})` : ''}`,
    `🖌️ Manos: ${coats}`,
    `📐 Superficie: ${lit(m2)} m² (estimada)`,
    `💧 Pintura necesaria: ${lit(liters)} L (incluye ${Math.round(margin * 100)} % de margen)`,
  );
  if (cans?.items?.length) {
    lines.push('🛒 Latas sugeridas:');
    for (const i of cans.items) {
      lines.push(`   • ${i.qty} × ${lit(i.liters)} L${i.unit_price_cents > 0 ? ` (${pesos(i.unit_price_cents)} c/u)` : ''}`);
    }
    if (cans.total_cents > 0) lines.push(`💰 Total estimado: ${pesos(cans.total_cents)}`);
  }
  lines.push('', 'Es una estimación hecha a partir de una foto: me gustaría confirmar medidas, color y precios.');
  const tail = [ref && `Ref: ${ref}`, date].filter(Boolean).join(' · ');
  if (tail) lines.push(tail);
  return lines.join('\n');
}

/** Link de WhatsApp. Con número válido abre el chat de la pinturería; sin número, WhatsApp deja elegir el contacto. */
export function whatsappUrl(number, text) {
  const n = cleanWhatsapp(number);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
