import test from 'node:test';
import assert from 'node:assert/strict';
import { semillasDesdeMapa, detectSurfacesSemantico, componentes, CLASE } from '../src/semantico.js';

const W = 80, H = 60;
function mapa() { // techo arriba (y<15), pared izquierda (x<40) y pared derecha (x>=45), con un hueco de "otro" entre ellas
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = y < 15 ? CLASE.techo : x < 40 ? CLASE.pared : x >= 45 ? CLASE.pared : CLASE.otro;
  return m;
}

test('componentes: separa regiones no conexas', () => {
  const { comps } = componentes(Uint8Array.from(mapa(), (v) => (v === CLASE.pared ? 1 : 0)), W, H);
  assert.equal(comps.length, 2);
});

test('semillasDesdeMapa: una semilla por componente dentro de ella, la mayor primero', () => {
  const m = mapa(), s = semillasDesdeMapa(m, W, H);
  assert.deepEqual(s.map((x) => x.kind).sort(), ['pared', 'pared', 'techo']);
  for (const c of s) for (const p of c.points) assert.equal(m[p.y * W + p.x], c.kind === 'techo' ? CLASE.techo : CLASE.pared);
  assert.ok(s[0].area >= s[1].area);
});

test('semillasDesdeMapa: ignora componentes chicas', () => {
  const m = new Uint8Array(W * H); for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) m[y * W + x] = CLASE.pared;
  assert.equal(semillasDesdeMapa(m, W, H).length, 0);
});

test('detectSurfacesSemantico: usa SAM si coincide con la componente y cae al modelo si SAM se va de rango', async () => {
  const m = mapa();
  const bueno = async (pts) => { const o = new Uint8Array(W * H); const p = pts[0]; for (let i = 0; i < o.length; i++) { const x = i % W, y = (i - x) / W; if (m[y * W + x] === m[p.y * W + p.x]) o[i] = 1; } return o; };
  const r = await detectSurfacesSemantico(m, W, H, bueno);
  assert.equal(r.filter((s) => s.kind === 'pared').length, 2);
  assert.ok(r.every((s) => s.fuente === 'sam'));
  const malo = async () => new Uint8Array(W * H).fill(1); // SAM devuelve toda la foto: fuera de rango
  const r2 = await detectSurfacesSemantico(m, W, H, malo);
  assert.ok(r2.every((s) => s.fuente === 'modelo'));
  const total = r2.reduce((a, s) => a + s.area, 0);
  assert.ok(total > 0.8 && total <= 1, `cobertura ${total}`);
});

import { hibridar } from '../src/semantico.js';

test('hibridar: el techo lo pone el clásico si el modelo también lo ve; un "techo" clásico que el modelo ve como pared se descarta; sin manchas sueltas', () => {
  const w = 60, h = 40, N = w * h, cm = new Uint8Array(N), pared = new Uint8Array(N), techoM = new Uint8Array(N), techoC = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; cm[i] = y < 10 ? CLASE.techo : CLASE.pared; if (y >= 8) pared[i] = 1; if (y < 12) techoM[i] = 1; if (y < 10) techoC[i] = 1; }
  pared[(h - 1) * w + (w - 1)] = 0; for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) pared[(30 + y) * w + 5 + x] = 0; // hueco: no se rellena
  const mancha = new Uint8Array(N); mancha[2 * w + 50] = 1; mancha[2 * w + 51] = 1; // mancha de 2 px lejos de la pared (arriba)
  const paredConMancha = new Uint8Array(pared); paredConMancha[2 * w + 50] = 1; paredConMancha[2 * w + 51] = 1;
  const found = [{ kind: 'pared', name: 'Pared 1', area: 0.7, mask: paredConMancha }, { kind: 'techo', name: 'Techo', area: 0.3, mask: techoM }];
  const r = hibridar(found, [{ kind: 'techo', name: 'Techo', area: 0.25, mask: techoC }], cm, w, h);
  const t = r.find((s) => s.kind === 'techo'), p = r.find((s) => s.kind === 'pared');
  assert.equal(t.fuente, 'clasico');
  assert.equal(t.mask[5 * w + 5], 1); assert.equal(t.mask[11 * w + 5], 0, 'el techo es el del clásico, no el del modelo');
  assert.equal(p.mask[9 * w + 5], 0, 'lo que es techo del clásico no queda como pared');
  assert.equal(p.mask[2 * w + 50], 0, 'la mancha suelta se borró');
  assert.equal(p.mask[30 * w + 5], 0, 'un hueco dentro de la pared no se rellena');
  // un "techo" clásico que el modelo ve como pared se descarta
  const falso = hibridar(found, [{ kind: 'techo', name: 'Techo', area: 0.3, mask: pared }], cm, w, h);
  assert.ok(falso.find((s) => s.kind === 'techo').mask === techoM, 'se conserva el techo del modelo');
});

test('hibridar con union: la pared del clásico que el modelo dejó como "otro" se suma a la pared del modelo; no toca techo ni piso', () => {
  const w = 60, h = 40, N = w * h, cm = new Uint8Array(N), modelo = new Uint8Array(N), clas = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    cm[i] = x < 30 ? CLASE.pared : (y > 30 ? CLASE.piso : CLASE.otro); // derecha = pared oscura que el modelo no ve; abajo a la derecha = piso
    if (x < 30) modelo[i] = 1;
    if (x < 45) clas[i] = 1; // el clásico ve pared hasta x=45 (incluye 15 columnas "otro" y el piso de la derecha)
  }
  const found = [{ kind: 'pared', name: 'Pared 1', area: 0.5, mask: modelo }];
  const sin = hibridar(found, [{ kind: 'pared', name: 'Pared', area: 0.75, mask: clas }], cm, w, h);
  assert.equal(sin[0].mask[10 * w + 40], 0);
  const con = hibridar(found, [{ kind: 'pared', name: 'Pared', area: 0.75, mask: clas }], cm, w, h, { union: true });
  assert.equal(con.length, 1, 'se fusiona con la pared del modelo');
  assert.equal(con[0].mask[10 * w + 40], 1, 'se sumó la zona oscura');
  assert.equal(con[0].mask[35 * w + 40], 0, 'el piso que ve el modelo no se suma');
});

test('hibridar con partir: una pared del modelo que abarca dos paredes del clásico se parte en dos', () => {
  const w = 80, h = 40, N = w * h, cm = new Uint8Array(N).fill(CLASE.pared), modelo = new Uint8Array(N).fill(1), izq = new Uint8Array(N), der = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (x >= 5 && x < 35) izq[y * w + x] = 1; if (x >= 45 && x < 75) der[y * w + x] = 1; } // el clásico deja una franja de dudas en el medio
  const found = [{ kind: 'pared', name: 'Pared 1', area: 1, mask: modelo }];
  const clas = [{ kind: 'pared', name: 'Pared izquierda', area: 0.4, mask: izq }, { kind: 'pared', name: 'Pared derecha', area: 0.4, mask: der }];
  const uno = hibridar(found, clas, cm, w, h);
  assert.equal(uno.length, 1);
  const dos = hibridar(found, clas, cm, w, h, { partir: true });
  assert.deepEqual(dos.map((s) => s.name).sort(), ['Pared derecha', 'Pared izquierda']);
  const i = dos.find((s) => s.name === 'Pared izquierda'), d = dos.find((s) => s.name === 'Pared derecha');
  assert.equal(i.mask[20 * w + 2], 1, 'el borde izquierdo (sin clásico) va a la pared más cercana');
  assert.equal(d.mask[20 * w + 78], 1);
  assert.equal(i.mask[20 * w + 60], 0); assert.equal(d.mask[20 * w + 10], 0);
  // con una sola pared del clásico no se parte
  assert.equal(hibridar(found, [clas[0]], cm, w, h, { partir: true }).length, 1);
});
