// Tests de las reglas agregadas el 2026-11-12 (revisión foto por foto con Ginés): pared encerrada por un cable, borde recto contra una
// moldura, moldura entre techo y pared, OSB y esquina en sombra. Imágenes sintéticas chicas: verifican el comportamiento, no los umbrales
// exactos (esos se miden con eval/regresion).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rellenarBordes } from '../src/semantico.js';
import { enderezarBordes, quitarCornisas } from '../src/enderezar.js';
import { marcarOSB } from '../src/madera.js';

function imagen(w, h, color) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const [r, g, b] = color(i % w, Math.floor(i / w)); data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
  return { data, width: w, height: h };
}

test('rellenarBordes: la pared encerrada dentro del rulo de un cable se pinta; el cable no', () => {
  const w = 400, h = 400, N = w * h;
  // como en la foto del portero: un aparato claro arriba y debajo un cable oscuro cerrado alrededor de una franja de pared (x 140-160, y 120-220)
  const cable = (x, y) => (((x >= 136 && x < 140) || (x >= 160 && x < 164)) && y >= 116 && y < 224) || (y >= 220 && y < 224 && x >= 136 && x < 164) || (y >= 116 && y < 120 && x >= 136 && x < 164);
  const aparato = (x, y) => x >= 110 && x < 190 && y >= 60 && y < 112;
  const img = imagen(w, h, (x, y) => (cable(x, y) ? [60, 60, 60] : aparato(x, y) ? [225, 223, 220] : [200, 198, 195]));
  const mask = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!(x >= 100 && x < 200 && y >= 50 && y < 234)) mask[y * w + x] = 1; // el servidor deja sin asignar el aparato, el cable y su rulo
  const [p] = rellenarBordes([{ kind: 'pared', mask, area: 0 }], img, { r: 6 });
  assert.equal(p.mask[170 * w + 150], 1, 'la pared de adentro del rulo se pinta');
  assert.equal(p.mask[170 * w + 138], 0, 'el cable no se pinta');
  assert.equal(p.mask[80 * w + 150], 0, 'el aparato no se pinta');
});

test('enderezarBordes: el borde ondulado contra una moldura queda recto sobre el borde de la foto', () => {
  const w = 400, h = 300, N = w * h;
  // pared oscura abajo (y >= 150), moldura clara en y 130-149; la máscara de la pared llega ondulada (y 150 ± 2, como en las fotos)
  const img = imagen(w, h, (x, y) => (y >= 150 ? [110, 100, 90] : y >= 130 ? [235, 232, 225] : [190, 190, 188]));
  const mask = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y >= 150 + Math.round(2 * Math.sin(x / 9))) mask[y * w + x] = 1;
  const [p] = enderezarBordes([{ kind: 'pared', mask }], img);
  let errores = 0;
  for (let x = 20; x < w - 20; x++) for (let y = 140; y < 160; y++) if (p.mask[y * w + x] !== (y >= 150 ? 1 : 0)) errores++;
  assert.ok(errores < 0.04 * (w - 40) * 20, `borde recto (errores ${errores})`);
});

test('quitarCornisas: la moldura con ranuras pegada al techo no se pinta; una esquina lisa queda igual', () => {
  const w = 400, h = 400, N = w * h;
  const ranuras = (y) => [200, 235, 210, 240, 205, 238, 212][Math.floor((y - 186) / 2)] ?? 225; // franja clara con ranuras (y 186-199)
  const conMoldura = imagen(w, h, (x, y) => (y >= 200 ? [120, 110, 100] : y >= 186 ? [ranuras(y), ranuras(y), ranuras(y) - 4] : [170, 170, 168]));
  const techo = new Uint8Array(N), pared = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) (y < 200 ? techo : pared)[y * w + x] = 1; // el servidor metió la moldura en el techo
  const [t] = quitarCornisas([{ kind: 'techo', mask: techo }, { kind: 'pared', mask: pared }], conMoldura);
  assert.equal(t.mask[192 * w + 200], 0, 'la moldura sale del techo');
  assert.equal(t.mask[100 * w + 200], 1, 'el techo sigue');
  const liso = imagen(w, h, (x, y) => (y >= 200 ? [120, 110, 100] : [170, 170, 168]));
  const [t2] = quitarCornisas([{ kind: 'techo', mask: techo }, { kind: 'pared', mask: pared }], liso);
  assert.equal(t2.mask[192 * w + 200], 1, 'sin moldura no se saca nada');
});

test('marcarOSB: un techo con virutas marrones queda sin color; un techo liso no', () => {
  const w = 300, h = 300, N = w * h;
  let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  // "virutas": manchas de 6x6 px con luz al azar alrededor de un marrón anaranjado
  const manchas = Array.from({ length: 50 * 50 }, () => 0.7 + 0.6 * rnd());
  const osb = imagen(w, h, (x, y) => { const k = manchas[Math.floor(y / 6) * 50 + Math.floor(x / 6)] * (0.92 + 0.16 * rnd()); return [Math.min(255, 150 * k), Math.min(255, 100 * k), Math.min(255, 50 * k)]; });
  const mask = new Uint8Array(N).fill(1);
  const [a] = marcarOSB([{ kind: 'techo', name: 'Techo', mask, area: 1 }], osb);
  assert.equal(a.kind, 'ladrillo', 'el OSB queda como superficie sin color');
  const liso = imagen(w, h, () => [200, 198, 195]);
  const [b] = marcarOSB([{ kind: 'techo', name: 'Techo', mask, area: 1 }], liso);
  assert.equal(b.kind, 'techo');
});

test('rellenarBordes (sombra): la arista oscura entre dos paredes se pinta aunque sea mucho más oscura que el promedio', () => {
  const w = 200, h = 200, N = w * h;
  // pared iluminada a la izquierda (x < 96), pared en sombra a la derecha (x > 104), arista sin asignar en el medio con la luz de la sombra
  const img = imagen(w, h, (x) => (x < 96 ? [220, 205, 180] : [70, 65, 56]));
  const mask = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 96 || x > 104) mask[y * w + x] = 1;
  const [p] = rellenarBordes([{ kind: 'pared', mask, area: 0 }], img, { r: 6, encerrados: false });
  assert.equal(p.mask[100 * w + 100], 1, 'la arista en sombra se pinta');
  const [q] = rellenarBordes([{ kind: 'pared', mask, area: 0 }], img, { r: 6, encerrados: false, sombra: false });
  assert.equal(q.mask[100 * w + 100], 0, 'sin la regla de sombra quedaba blanca');
});
