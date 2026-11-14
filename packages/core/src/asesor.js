// Asesor de color (pedido de Ginés 2026-11-13): apenas se detectan las paredes, la app propone COMBINACIONES de la carta del comercio
// (Tersuave en Plaza Olmos) y las muestra aplicadas sobre la foto; el cliente puede pasar entre ellas o elegir a mano.
// Sin IA generativa ni servicios externos: reglas de armonía en LCh sobre los colores que NO se pintan de la foto (piso, muebles, madera)
// y la luz de las paredes. Funciones puras (se prueban con node --test).
//
// Mezclas propias (lo común en las pinturerías: "rebajalo", "un punto entre estos dos"): la sucursal las prepara en la máquina
// tintométrica; acá se calculan para VERLAS (aproximado) y cada una lleva su receta en texto para el pedido.

import { rgbToLab, labToHex } from './color.js';

const lch = ({ L, a, b }) => ({ L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 });
const dh = (h1, h2) => { const d = Math.abs(h1 - h2) % 360; return d > 180 ? 360 - d : d; };
const BLANCO_BASE = { L: 96, a: 0, b: 1.5 }; // base de tinte (aprox.): lo que queda si se le saca todo el tinte

/**
 * Colores de lo que NO se pinta (muebles, piso, madera) y luz de las paredes. img: { data, width, height }; superficies: [{ kind, mask }].
 * Devuelve { fijos: [{ lab, peso }] (hasta 4, de más a menos presentes), paredLab, calida }.
 */
export function analizarAmbiente(img, superficies, { muestra = 6 } = {}) {
  const { data, width: w, height: h } = img, N = w * h;
  const pinta = new Uint8Array(N);
  for (const s of superficies) if (s.kind === 'pared' || s.kind === 'techo') for (let i = 0; i < N; i++) if (s.mask[i]) pinta[i] = 1;
  const fijos = [], pared = [];
  for (let i = 0; i < N; i += muestra) {
    const lab = rgbToLab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    if (pinta[i]) { if (i % (muestra * 4) === 0) pared.push(lab); } else if (lab.L > 12 && lab.L < 95) fijos.push(lab);
  }
  // k-medias simple (k = 4) en LAB sobre lo que no se pinta
  const k = Math.min(4, fijos.length);
  let cen = fijos.filter((_, i) => i % Math.max(1, Math.floor(fijos.length / Math.max(1, k))) === 0).slice(0, k).map((c) => ({ ...c, n: 0 }));
  const asig = new Int32Array(fijos.length);
  for (let it = 0; it < 8 && k; it++) {
    fijos.forEach((c, i) => { let m = 0, d = Infinity; cen.forEach((q, j) => { const e = (c.L - q.L) ** 2 + (c.a - q.a) ** 2 + (c.b - q.b) ** 2; if (e < d) { d = e; m = j; } }); asig[i] = m; });
    cen = cen.map((q, j) => { let n = 0, L = 0, a = 0, b = 0; fijos.forEach((c, i) => { if (asig[i] === j) { n++; L += c.L; a += c.a; b += c.b; } }); return n ? { L: L / n, a: a / n, b: b / n, n } : { ...q, n: 0 }; });
  }
  const tot = Math.max(1, fijos.length);
  const out = cen.filter((c) => c.n).map((c) => ({ lab: { L: c.L, a: c.a, b: c.b }, peso: c.n / tot })).sort((x, y) => y.peso - x.peso);
  const np = Math.max(1, pared.length);
  const paredLab = pared.length ? pared.reduce((s, c) => ({ L: s.L + c.L / np, a: s.a + c.a / np, b: s.b + c.b / np }), { L: 0, a: 0, b: 0 }) : { L: 80, a: 0, b: 5 };
  // cálido: lo que no se pinta tira a madera/beige (b* alto) o la luz de la pared es cálida
  const bFijo = out.reduce((s, c) => s + c.lab.b * c.peso, 0);
  return { fijos: out, paredLab, calida: bFijo > 12 || paredLab.b > 9 };
}

/** Armonía de un color de pared con lo que no se pinta: que se distinga en luz de lo dominante y que el tono acompañe (análogo). */
function armonia(c, amb) {
  const p = lch(c.lab); let s = 0;
  for (const f of amb.fijos) {
    const q = lch(f.lab);
    s += f.peso * Math.min(1, Math.abs(p.L - q.L) / 20) * 0.6;
    if (q.C > 12 && p.C > 6) s += f.peso * (dh(p.h, q.h) < 45 ? 0.4 : dh(p.h, q.h) > 150 ? 0.25 : 0);
  }
  return s;
}

const elegir = (lista, f) => lista.reduce((m, c) => { const v = f(c); return v > m.v ? { c, v } : m; }, { c: null, v: -Infinity }).c;

/**
 * Hasta tres combinaciones { id, nombre, porque, principal, acento?, techo } con colores de la carta tal cual vienen de la API
 * ({ id, code, name, family, hex, lab }). Determinista para la misma foto y la misma carta.
 */
export function recomendarCombinaciones(carta, amb) {
  const conLch = carta.filter((c) => c.lab && c.hex).map((c) => ({ c, p: lch(c.lab) }));
  if (!conLch.length) return [];
  const techoPara = (pr) => {
    const q = lch(pr.lab);
    const blancos = conLch.filter((x) => x.p.L >= 93 && x.p.C <= 7);
    return elegir(blancos.map((x) => x.c), (c) => { const p = lch(c.lab); return -dh(p.h, q.h) / 180 - Math.abs(p.C - Math.min(5, q.C / 3)) / 10; }) ?? pr;
  };
  const calido = (p) => p.h >= 60 && p.h <= 100; // beige / greige / arena (no rosados ni naranjas)
  // 1) clásica: neutro de verdad (muy poco color), beige/greige si el ambiente es cálido, gris claro si no
  const neutros = conLch.filter((x) => x.p.L >= 76 && x.p.L <= 90 && x.p.C >= 2 && x.p.C <= 9 && (amb.calida ? calido(x.p) : !calido(x.p) || x.p.C < 4));
  const baseClasica = neutros.length ? neutros : conLch.filter((x) => x.p.L >= 74 && x.p.C <= 12);
  const clasica = elegir(baseClasica.map((x) => x.c), (c) => armonia(c, amb) - Math.abs(lch(c.lab).L - 84) / 40);
  // 2) suave con color: tono apagado (salvia, celeste grisáceo, terracota suave) que acompañe lo que no se pinta
  // (de OTRA familia que la clásica: si no, las dos se ven iguales en la foto)
  const hClas = clasica ? lch(clasica.lab).h : 80;
  const suave = elegir(conLch.filter((x) => x.p.L >= 62 && x.p.L <= 82 && x.p.C >= 12 && x.p.C <= 26 && dh(x.p.h, hClas) >= 60).map((x) => x.c),
    (c) => armonia(c, amb) - Math.abs(lch(c.lab).L - 72) / 50);
  // 3) acento: la pared más grande en un tono profundo y el resto en el neutro de la clásica
  const acento = elegir(conLch.filter((x) => x.p.L >= 32 && x.p.L <= 58 && x.p.C >= 18 && x.p.C <= 48).map((x) => x.c),
    (c) => armonia(c, amb) + (clasica ? Math.min(1, dh(lch(c.lab).h, lch(clasica.lab).h) / 90) * 0.2 : 0));
  const out = [];
  if (clasica) out.push({ id: 'clasica', nombre: 'Clásica', principal: clasica, techo: techoPara(clasica),
    porque: amb.calida ? 'Un neutro cálido que acompaña la madera y los tonos del ambiente.' : 'Un neutro luminoso que agranda el ambiente y va con todo.' });
  if (suave) out.push({ id: 'suave', nombre: 'Suave con color', principal: suave, techo: techoPara(suave), porque: 'Un color apagado que da calidez sin cansar la vista.' });
  if (acento && clasica) out.push({ id: 'acento', nombre: 'Con pared de acento', principal: clasica, acento, techo: techoPara(clasica),
    porque: 'La pared principal en un tono intenso y el resto en un neutro que lo equilibra.' });
  return out;
}

/** Colores de una combinación por superficie: { [índice]: color }. El acento va a la pared más grande; el techo, al techo. */
export function asignarCombinacion(combo, superficies) {
  const paredes = superficies.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'pared');
  const mayor = paredes.reduce((m, x) => (!m || x.s.area > m.s.area ? x : m), null);
  const out = {};
  superficies.forEach((s, i) => {
    if (s.kind === 'techo') out[i] = combo.techo;
    else if (s.kind === 'pared') out[i] = combo.acento && mayor && mayor.i === i ? combo.acento : combo.principal;
  });
  return out;
}

/** Color "rebajado": la misma fórmula con menos tinte (fraccion 0..1 del tinte original: 0,5 = al 50 %). Visual aproximado. */
export function rebajar(color0, fraccion) {
  const color = color0.base ?? color0; // siempre desde el color original de la carta (no "rebajado del rebajado")
  const f = Math.max(0.05, Math.min(1, fraccion)), t = 1 - f;
  const lab = { L: color.lab.L + (BLANCO_BASE.L - color.lab.L) * t, a: color.lab.a * f + BLANCO_BASE.a * t, b: color.lab.b * f + BLANCO_BASE.b * t };
  const pct = Math.round(f * 100);
  return { id: `${color.id}@${pct}`, code: `${color.code} al ${pct} %`, name: `${color.name} rebajado al ${pct} %`, family: color.family, lab, hex: labToHex(lab),
    receta: `${color.code} (${color.name}) rebajado al ${pct} % de tinte`, mezcla: true, base: color };
}

/** Punto entre dos colores de la carta (proporcion 0..1 de `b`; 0,5 = mitad y mitad). Visual aproximado. */
export function mezclarColores(a, b, proporcion = 0.5) {
  const p = Math.max(0, Math.min(1, proporcion)), q = 1 - p;
  const lab = { L: a.lab.L * q + b.lab.L * p, a: a.lab.a * q + b.lab.a * p, b: a.lab.b * q + b.lab.b * p };
  const pa = Math.round(q * 100), pb = 100 - pa;
  return { id: `${a.id}+${b.id}@${pb}`, code: `${a.code} ${pa} % + ${b.code} ${pb} %`, name: `Mezcla de ${a.name} y ${b.name}`, family: a.family, lab, hex: labToHex(lab),
    receta: `${pa} % ${a.code} (${a.name}) + ${pb} % ${b.code} (${b.name})`, mezcla: true };
}
