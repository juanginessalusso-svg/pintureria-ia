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
