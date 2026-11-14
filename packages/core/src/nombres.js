// Nombres de las superficies como los dice un cliente (y como los muestra Sinteplast): "Pared izquierda / central / derecha" en vez de
// "Pared 1, 2, 3". Se decide por el centro horizontal de cada pared en la foto. Solo renombra los nombres automáticos ("Pared N").

/** found: superficies { kind, name, mask }; w, h: tamaño. Devuelve superficies nuevas con nombres por posición. */
export function nombrarPorPosicion(found, w, h) {
  const auto = (f) => f.kind === 'pared' && /^Pared \d+$/.test(f.name ?? '');
  const paredes = found.map((f, i) => ({ f, i })).filter((x) => auto(x.f));
  if (!paredes.length) return found;
  const caja = (m) => { let s = 0, sy = 0, n = 0, x0 = w, x1 = 0; for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % w; s += x; sy += (i - x) / w; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; } return n ? { c: s / n / w, cy: sy / n / h, x0, x1 } : { c: 0.5, cy: 0.5, x0: 0, x1: w }; };
  const nombres = new Map();
  if (paredes.length === 1) nombres.set(paredes[0].i, 'Pared');
  else {
    const pos = paredes.map((x) => ({ ...x, ...caja(x.f.mask) })).sort((a, b) => a.c - b.c);
    // dos paredes una ARRIBA de otra (una moldura o guardasilla las separa, 2026-11-16 foto del reloj de Ginés): mismo plano, se nombran
    // por la de mayor ancho y se les agrega "(arriba)" / "(abajo)" en vez de llamar "derecha" a la de abajo
    const encima = new Map();
    for (const a of pos) for (const b of pos) {
      if (a === b) continue;
      const solape = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), menor = Math.min(a.x1 - a.x0, b.x1 - b.x0);
      if (solape > 0.6 * menor && Math.abs(a.cy - b.cy) > 0.12) { const grande = (a.x1 - a.x0) >= (b.x1 - b.x0) ? a : b; encima.set(a.i, { ref: grande, arriba: a.cy < b.cy }); }
    }
    const lado = (c) => (c < 0.38 ? 'izquierda' : c > 0.62 ? 'derecha' : 'central');
    const usados = new Map();
    for (const p of pos) {
      const e = encima.get(p.i);
      const base = `Pared ${lado(e ? e.ref.c : p.c)}${e ? (e.arriba ? ' (arriba)' : ' (abajo)') : ''}`, k = (usados.get(base) ?? 0) + 1; usados.set(base, k);
      nombres.set(p.i, k === 1 ? base : `${base} ${k}`);
    }
  }
  return found.map((f, i) => (nombres.has(i) ? { ...f, name: nombres.get(i) } : f));
}
