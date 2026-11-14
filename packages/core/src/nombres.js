// Nombres de las superficies como los dice un cliente (y como los muestra Sinteplast): "Pared izquierda / central / derecha" en vez de
// "Pared 1, 2, 3". Se decide por el centro horizontal de cada pared en la foto. Solo renombra los nombres automáticos ("Pared N").

/** found: superficies { kind, name, mask }; w, h: tamaño. Devuelve superficies nuevas con nombres por posición. */
export function nombrarPorPosicion(found, w, h) {
  const auto = (f) => f.kind === 'pared' && /^Pared \d+$/.test(f.name ?? '');
  const paredes = found.map((f, i) => ({ f, i })).filter((x) => auto(x.f));
  if (!paredes.length) return found;
  const cx = (m) => { let s = 0, n = 0; for (let i = 0; i < m.length; i++) if (m[i]) { s += i % w; n++; } return n ? s / n / w : 0.5; };
  const nombres = new Map();
  if (paredes.length === 1) nombres.set(paredes[0].i, 'Pared');
  else {
    const pos = paredes.map((x) => ({ ...x, c: cx(x.f.mask) })).sort((a, b) => a.c - b.c);
    const lado = (c) => (c < 0.38 ? 'izquierda' : c > 0.62 ? 'derecha' : 'central');
    const usados = new Map();
    for (const p of pos) {
      const base = `Pared ${lado(p.c)}`, k = (usados.get(base) ?? 0) + 1; usados.set(base, k);
      nombres.set(p.i, k === 1 ? base : `${base} ${k}`);
    }
  }
  return found.map((f, i) => (nombres.has(i) ? { ...f, name: nombres.get(i) } : f));
}
