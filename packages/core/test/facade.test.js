import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFacade, classifyFacade, carveOutliers } from '../src/facade.js';

// Fachada sintética 200x150: cielo azul arriba, casa en el medio (pared beige lisa con una ventana oscura y un ladrillo rugoso a la izquierda), piso gris abajo.
const W = 200, H = 150;
const sky = (x, y) => y < 30, ground = (x, y) => y >= 120;
const brick = (x, y) => !sky(x, y) && !ground(x, y) && x < 50;
const window_ = (x, y) => x >= 110 && x < 140 && y >= 60 && y < 90;
function makeImg() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = [225, 205, 170]; // beige liso
    if (sky(x, y)) c = [40, 110, 220];
    else if (ground(x, y)) c = [120, 120, 118];
    else if (brick(x, y)) c = x % 4 < 2 ? [150, 80, 60] : [200, 150, 130]; // rayas de alta frecuencia (el gradiente central no ve un damero)
    else if (window_(x, y)) c = [30, 35, 45];
    const p = (y * W + x) * 4; data.set([...c, 255], p);
  }
  return { data, width: W, height: H };
}
// "SAM" de mentira: devuelve el objeto que contiene al punto (cielo, piso, ladrillo, o casa lisa con la ventana adentro).
const segment = async (pts) => {
  const { x, y } = pts[0], px = Math.floor(x), py = Math.floor(y), m = new Uint8Array(W * H);
  const pred = sky(px, py) ? sky : ground(px, py) ? ground : brick(px, py) ? brick : (X, Y) => !sky(X, Y) && !ground(X, Y) && !brick(X, Y);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (pred(i, j)) m[j * W + i] = 1;
  return { mask: m };
};

test('fachada: separa cielo y piso, propone pared lisa sin la ventana y ladrillo aparte', async () => {
  const found = await detectFacade(makeImg(), segment, { nx: 4, ny: 3 });
  const pared = found.filter((f) => f.kind === 'pared'), lad = found.filter((f) => f.kind === 'ladrillo');
  assert.equal(pared.length, 1);
  assert.equal(lad.length, 1);
  assert.deepEqual(found.rechazadas.map((r) => r.motivo).sort(), ['cielo', 'piso']);
  const m = pared[0].mask;
  assert.equal(m[75 * W + 125], 0, 'la ventana no es pared');
  assert.equal(m[75 * W + 80], 1, 'el paño liso sí');
  assert.equal(m[10 * W + 100], 0, 'el cielo no');
  assert.equal(m[75 * W + 20], 0, 'el ladrillo no es pared');
  assert.equal(lad[0].mask[75 * W + 20], 1);
});

test('clasificación: portón blanco liso dentro de una pared mayor es abertura', () => {
  const base = { n: 100, touchesTop: false, touchesBottom: false, chroma: 3, grad50: 1 };
  const out = classifyFacade([
    { ...base, k: 0, frac: 0.3, cy: 0.5, top: 0.1, bottom: 0.8, left: 0.0, right: 1, L: 70, grad50: 6 },
    { ...base, k: 1, frac: 0.1, cy: 0.6, top: 0.4, bottom: 0.75, left: 0.1, right: 0.4, L: 90 },
  ]);
  assert.equal(out[0].role, 'pared');
  assert.equal(out[1].role, 'abertura');
});

test('carveOutliers: deja el color de la región y saca lo muy distinto', () => {
  const img = makeImg(), mask = new Uint8Array(W * H);
  for (let y = 30; y < 120; y++) for (let x = 50; x < W; x++) mask[y * W + x] = 1;
  const out = carveOutliers(img, mask, { L: 83, a: 3, b: 18 });
  assert.equal(out[75 * W + 125], 0);
  assert.equal(out[40 * W + 160], 1);
});
