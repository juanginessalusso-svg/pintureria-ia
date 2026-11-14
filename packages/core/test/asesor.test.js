import test from 'node:test';
import assert from 'node:assert/strict';
import { recomendarCombinaciones, asignarCombinacion, rebajar, mezclarColores, analizarAmbiente } from '../src/asesor.js';
import { hexToLab, labToHex } from '../src/color.js';
import { buildBudgetMessage } from '../src/whatsapp.js';

const c = (id, code, name, hex) => ({ id, code, name, family: 'x', hex, lab: hexToLab(hex) });
const CARTA = [
  c(1, 'TS-1', 'Blanco tiza', '#f7f4ee'), c(2, 'TS-2', 'Greige', '#d8cfc0'), c(3, 'TS-3', 'Arena', '#d9cbb0'),
  c(4, 'TS-4', 'Salvia', '#a9b8a0'), c(5, 'TS-5', 'Celeste gris', '#8fa9c6'), c(6, 'TS-6', 'Verde bosque', '#3f6b4f'),
  c(7, 'TS-7', 'Terracota', '#b5653f'), c(8, 'TS-8', 'Gris perla', '#cfd2d4'),
];

test('labToHex invierte a hexToLab', () => {
  for (const h of ['#f7f4ee', '#3f6b4f', '#b5653f', '#000000', '#ffffff']) assert.equal(labToHex(hexToLab(h)), h);
});

test('recomendarCombinaciones: tres combinaciones distintas, con techo claro y colores de la carta', () => {
  const amb = { fijos: [{ lab: hexToLab('#6b4a2f'), peso: 0.6 }, { lab: hexToLab('#c9b9a0'), peso: 0.4 }], paredLab: hexToLab('#e8e2d8'), calida: true };
  const cs = recomendarCombinaciones(CARTA, amb);
  assert.deepEqual(cs.map((x) => x.id), ['clasica', 'suave', 'acento']);
  for (const x of cs) { assert.ok(CARTA.includes(x.principal)); assert.ok(x.techo.lab.L >= 90, 'techo claro'); assert.ok(x.porque.length > 10); }
  assert.notEqual(cs[0].principal, cs[1].principal, 'la suave no repite la clásica');
  assert.ok(cs[2].acento.lab.L < 60, 'el acento es un tono profundo');
  assert.deepEqual(recomendarCombinaciones(CARTA, amb), cs, 'determinista');
});

test('asignarCombinacion: acento a la pared más grande, techo al techo, zócalo sin color', () => {
  const combo = { principal: CARTA[1], acento: CARTA[5], techo: CARTA[0] };
  const sup = [{ kind: 'pared', area: 0.2 }, { kind: 'pared', area: 0.3 }, { kind: 'techo', area: 0.2 }, { kind: 'zocalo', area: 0.02 }];
  const a = asignarCombinacion(combo, sup);
  assert.equal(a[1], CARTA[5]); assert.equal(a[0], CARTA[1]); assert.equal(a[2], CARTA[0]); assert.equal(a[3], undefined);
});

test('rebajar y mezclar: más claro, receta legible para la sucursal', () => {
  const r = rebajar(CARTA[5], 0.5);
  assert.ok(r.lab.L > CARTA[5].lab.L); assert.match(r.receta, /TS-6 .* 50 %/); assert.match(r.hex, /^#[0-9a-f]{6}$/);
  const m = mezclarColores(CARTA[3], CARTA[6], 0.5);
  assert.match(m.receta, /50 % TS-4 .* \+ 50 % TS-7/);
  assert.ok(Math.abs(m.lab.L - (CARTA[3].lab.L + CARTA[6].lab.L) / 2) < 1e-9);
});

test('analizarAmbiente: separa lo que no se pinta y detecta ambiente cálido (madera)', () => {
  const w = 60, h = 40, N = w * h, data = new Uint8ClampedArray(N * 4), mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const y = Math.floor(i / w), pared = y < 25; const rgb = pared ? [235, 232, 226] : [120, 80, 45]; data.set([...rgb, 255], i * 4); if (pared) mask[i] = 1; }
  const amb = analizarAmbiente({ data, width: w, height: h }, [{ kind: 'pared', mask }], { muestra: 1 });
  assert.ok(amb.calida);
  assert.ok(amb.fijos[0].lab.b > 20, 'lo dominante que no se pinta es la madera');
});

test('rebajar parte siempre del color de la carta', () => {
  const r = rebajar(rebajar(CARTA[5], 0.5), 0.25);
  assert.match(r.receta, /^TS-6 \(Verde bosque\) rebajado al 25 %/);
});

test('WhatsApp: la mezcla va con su receta y el aviso de que la prepara la sucursal', () => {
  const r = rebajar(CARTA[5], 0.5);
  const txt = buildBudgetMessage({ shop: 'X', colors: [{ surface: 'Pared 1', name: r.name, code: r.code, receta: r.receta }], product: { name: 'Látex' }, coats: 2, m2: 10, liters: 2, cans: null });
  assert.match(txt, /Pared 1: Verde bosque rebajado al 50 % — receta: TS-6 \(Verde bosque\) rebajado al 50 % de tinte/);
  assert.match(txt, /máquina tintométrica/);
});
