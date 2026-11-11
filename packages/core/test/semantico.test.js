import test from 'node:test';
import assert from 'node:assert/strict';
import { semillasDesdeMapa, detectSurfacesSemantico, componentes, CLASE, vetarConModelo, completarConModelo, recortarObjetos } from '../src/semantico.js';

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

test('vetarConModelo: SAM no puede sumar una puerta que el modelo ve como "otro"; el borde se puede correr hasta el margen', () => {
  const w = 100, h = 50, N = w * h, cm = new Uint8Array(N).fill(CLASE.pared), pared = new Uint8Array(N).fill(1);
  for (let y = 10; y < h; y++) for (let x = 40; x < 60; x++) cm[y * w + x] = CLASE.otro; // puerta en el medio: el modelo la ve como "otro"
  const found = [{ kind: 'pared', name: 'Pared 1', area: 1, mask: pared }]; // SAM/el clásico la pegaron a la pared
  const r = vetarConModelo(found, cm, w, h, { r: 0.02 }); // margen 2 px
  assert.equal(r.length, 1);
  assert.equal(r[0].mask[30 * w + 50], 0, 'el centro de la puerta no se pinta');
  assert.equal(r[0].mask[30 * w + 41], 1, 'dentro del margen el borde se respeta');
  assert.equal(r[0].mask[30 * w + 10], 1, 'la pared sigue entera');
  assert.equal(r[0].mask[5 * w + 50], 1, 'arriba de la puerta sigue la pared');
  // un techo no se recorta con la zona de pared
  const techo = new Uint8Array(N); for (let i = 0; i < 10 * w; i++) techo[i] = 1;
  const cm2 = new Uint8Array(cm); for (let i = 0; i < 10 * w; i++) cm2[i] = CLASE.techo;
  const r2 = vetarConModelo([{ kind: 'techo', name: 'Techo', area: 0.2, mask: techo }], cm2, w, h);
  assert.equal(r2.length, 1); assert.equal(r2[0].mask[5 * w + 50], 1);
});

test('completarConModelo: una pared que el modelo ve pero quedó sin cubrir se vuelve a pedir y se agrega', async () => {
  const w = 100, h = 50, N = w * h, cm = new Uint8Array(N).fill(CLASE.pared), der = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 50; x < w; x++) der[y * w + x] = 1; // solo la pared derecha quedó como superficie
  const pedidos = [];
  const segment = async (pts) => { pedidos.push(pts); const m = new Uint8Array(N); for (let y = 0; y < h; y++) for (let x = 0; x < 50; x++) m[y * w + x] = 1; return m; }; // SAM devuelve la izquierda
  const r = await completarConModelo([{ kind: 'pared', name: 'Pared 1', area: 0.5, mask: der }], cm, w, h, segment, { apertura: 0.02 });
  assert.equal(r.length, 2, 'se agregó la pared izquierda');
  assert.ok(pedidos.length >= 1);
  assert.equal(r[1].mask[25 * w + 10], 1); assert.equal(r[1].mask[25 * w + 80], 0, 'no pisa la que ya estaba');
  // si todo está cubierto no se pide nada
  const todo = new Uint8Array(N).fill(1); pedidos.length = 0;
  const r2 = await completarConModelo([{ kind: 'pared', name: 'Pared 1', area: 1, mask: todo }], cm, w, h, segment);
  assert.equal(r2.length, 1); assert.equal(pedidos.length, 0);
});

test('recortarObjetos: un cuadro pintado que el modelo ve como "otro" se saca con el borde de SAM; una franja fina de borde no', async () => {
  const w = 100, h = 80, N = w * h, cm = new Uint8Array(N).fill(CLASE.pared);
  const cuadro = (x, y) => x >= 30 && x < 60 && y >= 20 && y < 45;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (cuadro(x, y)) cm[y * w + x] = CLASE.otro; if (x >= 97) cm[y * w + x] = CLASE.otro; } // franja de 3 px a la derecha
  const pared = new Uint8Array(N).fill(1); // todo pintado (el veto dejó pasar el cuadro y la franja)
  const pedidos = [];
  const segment = async (pts) => { pedidos.push(pts[0]); const m = new Uint8Array(N); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cuadro(x, y)) m[y * w + x] = 1; return { mask: m }; };
  const out = await recortarObjetos([{ kind: 'pared', name: 'Pared 1', area: 1, mask: pared }], cm, w, h, segment, { nucleo: 0.03 });
  assert.equal(pedidos.length, 1, 'un solo objeto con cuerpo: la franja fina no cuenta');
  assert.ok(cuadro(pedidos[0].x, pedidos[0].y), 'el punto cae dentro del cuadro');
  const m = out[0].mask;
  assert.equal(m[30 * w + 45], 0, 'el cuadro queda sin pintar');
  assert.equal(m[10 * w + 10], 1, 'la pared sigue pintada');
  assert.equal(m[40 * w + 98], 1, 'la franja de borde no se toca');
});

test('recortarObjetos: si SAM devuelve algo que el modelo ve como pared (no es un objeto), no se saca nada', async () => {
  const w = 100, h = 80, N = w * h, cm = new Uint8Array(N).fill(CLASE.pared);
  for (let y = 20; y < 45; y++) for (let x = 30; x < 60; x++) cm[y * w + x] = CLASE.otro;
  const pared = new Uint8Array(N).fill(1);
  const segment = async () => ({ mask: new Uint8Array(N).fill(1) }); // SAM agarra toda la pared
  const out = await recortarObjetos([{ kind: 'pared', name: 'Pared 1', area: 1, mask: pared }], cm, w, h, segment, { nucleo: 0.03 });
  assert.equal(out[0].mask[30 * w + 45], 1);
});

test('superficiesDesdeMapa: cada zona de pared es una superficie, el techo aparte, sin SAM y sin manchas chicas', async () => {
  const { superficiesDesdeMapa } = await import('../src/semantico.js');
  const w = 100, h = 80, N = w * h, cm = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (y < 15) cm[y * w + x] = CLASE.techo;
    else if (x < 40) cm[y * w + x] = CLASE.pared;          // pared grande a la izquierda
    else if (x >= 45 && x < 70) cm[y * w + x] = CLASE.pared; // otra pared, separada por una columna de "otro"
  }
  cm[79 * w + 99] = CLASE.pared; // mancha suelta de 1 px: no es superficie
  const s = superficiesDesdeMapa(cm, w, h);
  assert.deepEqual(s.map((x) => [x.kind, x.name]), [['pared', 'Pared 1'], ['pared', 'Pared 2'], ['techo', 'Techo']]);
  assert.equal(s[0].mask[50 * w + 10], 1); assert.equal(s[0].mask[50 * w + 50], 0);
  assert.equal(s[1].mask[50 * w + 50], 1);
  assert.ok(Math.abs(s[0].area - (65 * 40) / N) < 1e-9);
  assert.equal(s.every((x) => x.mask[79 * w + 99] === 0), true);
});

test('superficiesDesdeMapa con instancias: dos paredes que se tocan salen separadas y el relleno sin número va a la vecina', async () => {
  const { superficiesDesdeMapa } = await import('../src/semantico.js');
  const w = 100, h = 80, N = w * h, cm = new Uint8Array(N), ids = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (y < 15) { cm[i] = CLASE.techo; continue; }
    cm[i] = CLASE.pared;                                  // una sola zona de pared (las dos paredes se tocan en x = 50)
    ids[i] = x < 50 ? 1 : 2;
    if (y > 70 && x > 40 && x < 45) ids[i] = 0;           // relleno sin número (de r9), del lado de la pared 1
  }
  const s = superficiesDesdeMapa(cm, w, h, { instancias: ids });
  assert.deepEqual(s.map((x) => x.name), ['Pared 1', 'Pared 2', 'Techo']);
  const izq = s.find((x) => x.mask[40 * w + 10]), der = s.find((x) => x.mask[40 * w + 90]);
  assert.notEqual(izq, der);
  assert.equal(izq.mask[75 * w + 42], 1, 'el relleno sin número quedó con la pared vecina');
  assert.equal(s.slice(0, 2).reduce((a, x) => a + x.area, 0).toFixed(4), ((65 * 100) / N).toFixed(4), 'no se pierde pared');
});

test('rellenarBordes: cierra la franja blanca entre dos paredes y contra el techo, sin comerse un objeto de otro color', async () => {
  const { rellenarBordes } = await import('../src/semantico.js');
  const w = 100, h = 80, N = w * h, data = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { data[i * 4] = 235; data[i * 4 + 1] = 232; data[i * 4 + 2] = 225; data[i * 4 + 3] = 255; } // pared y techo blancos
  const rojo = (x, y) => x >= 10 && x < 30 && y >= 60; // un mueble rojo abajo a la izquierda
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rojo(x, y)) { const i = y * w + x; data[i * 4] = 180; data[i * 4 + 1] = 40; data[i * 4 + 2] = 40; }
  const m1 = new Uint8Array(N), m2 = new Uint8Array(N), t = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (y < 15) t[i] = 1;
    else if (y >= 18 && x < 48 && !(x >= 7 && x < 33 && y >= 57)) m1[i] = 1; // pared 1: franja de 3 px contra el techo y 4 px contra la pared 2; aire alrededor del mueble
    else if (y >= 18 && x >= 52) m2[i] = 1;
  }
  const s = rellenarBordes([{ kind: 'pared', mask: m1 }, { kind: 'pared', mask: m2 }, { kind: 'techo', mask: t }], { data, width: w, height: h }, { r: 4 });
  const cub = (x, y) => s.some((f) => f.mask[y * w + x]);
  assert.ok(cub(50, 40) && cub(49, 40) && cub(30, 16), 'se cerraron las uniones');
  assert.equal(cub(20, 70), false, 'el mueble rojo no se pinta');
  assert.ok(cub(8, 58), 'el aire blanco alrededor del mueble sí');
});

test('rellenarBordes: una llave de luz blanca como la pared (hueco encerrado) no se rellena, pero el margen liso alrededor sí', async () => {
  const { rellenarBordes } = await import('../src/semantico.js');
  const w = 200, h = 200, N = w * h, data = new Uint8ClampedArray(N * 4), mask = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, tapa = x >= 90 && x < 110 && y >= 85 && y < 115, contorno = !tapa && x >= 89 && x <= 110 && y >= 84 && y <= 115;
    const v = contorno ? 150 : 225; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; // tapa blanca con un contorno gris
    if (!(x >= 84 && x < 116 && y >= 79 && y < 121)) mask[i] = 1; // el servidor deja un hueco algo más grande que la tapa
  }
  const [p] = rellenarBordes([{ kind: 'pared', mask, area: 0 }], { data, width: w, height: h }, { r: 8 });
  assert.equal(p.mask[100 * w + 91], 0, 'la tapa no se pinta'); // a 8 px del hueco: sin la regla de huecos se pintaba
  assert.equal(p.mask[100 * w + 86], 1, 'el margen liso entre la pared y la tapa sí');
});
