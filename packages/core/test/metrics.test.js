import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMask, decodeMask, iou, matchSurfaces, evaluatePhoto, summarize } from '../src/index.js';

const W = 20, H = 10, N = W * H;
const rect = (x0, y0, x1, y1) => { const m = new Uint8Array(N); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; return m; };
const S = (name, kind, mask) => ({ name, kind, mask });

test('encodeMask/decodeMask: ida y vuelta, también con bordes (empieza/termina en 1)', () => {
  for (const m of [new Uint8Array(N), new Uint8Array(N).fill(1), rect(3, 2, 9, 7), rect(0, 0, W, 3)]) {
    assert.deepEqual(decodeMask(encodeMask(m), N), m);
  }
  assert.ok(encodeMask(rect(0, 0, W, H)).length <= 2);
});

test('iou: idénticas 1, disjuntas 0, mitad de solape', () => {
  assert.equal(iou(rect(0, 0, 10, 10), rect(0, 0, 10, 10)), 1);
  assert.equal(iou(rect(0, 0, 5, 10), rect(10, 0, 20, 10)), 0);
  assert.equal(iou(rect(0, 0, 10, 10), rect(5, 0, 15, 10)), 1 / 3);
});

test('matchSurfaces: empareja uno a uno por mayor IoU', () => {
  const truth = [S('A', 'pared', rect(0, 0, 10, 10)), S('B', 'pared', rect(10, 0, 20, 10))];
  const pred = [S('p1', 'pared', rect(10, 0, 20, 10)), S('p2', 'pared', rect(0, 0, 9, 10))];
  const m = matchSurfaces(truth, pred);
  assert.equal(m.length, 2);
  assert.equal(m.find((x) => x.t === 0).p, 1);
  assert.equal(m.find((x) => x.t === 1).p, 0);
});

test('evaluatePhoto: detección perfecta => sin tocar', () => {
  const t = [S('Pared', 'pared', rect(0, 2, 20, 10)), S('Techo', 'techo', rect(0, 0, 20, 2))];
  const r = evaluatePhoto(t, t.map((x) => ({ ...x })));
  assert.equal(r.zeroTouch, true);
  assert.equal(r.falsePaint, 0);
  assert.equal(r.missedPaint, 0);
  assert.ok(r.perSurface.every((s) => s.good && s.iou === 1));
});

test('evaluatePhoto: superficie perdida, sobrante y pintura mal puesta', () => {
  const truth = [S('Pared', 'pared', rect(0, 0, 10, 10)), S('Otra', 'pared', rect(10, 0, 20, 5))];
  const pred = [S('p', 'pared', rect(0, 0, 10, 10)), S('azulejo', 'pared', rect(10, 5, 20, 10))]; // acierta la 1ª, se pierde la 2ª, inventa una
  const r = evaluatePhoto(truth, pred);
  assert.equal(r.perSurface[0].good, true);
  assert.equal(r.perSurface[1].found, false);
  assert.equal(r.extras.length, 1);
  assert.ok(r.falsePaint > 0.3);
  assert.equal(r.zeroTouch, false);
});

test('evaluatePhoto: un IoU intermedio es "encontrada" pero no "buena"', () => {
  const r = evaluatePhoto([S('P', 'pared', rect(0, 0, 20, 10))], [S('p', 'pared', rect(0, 0, 20, 7))]);
  assert.equal(r.perSurface[0].found, true);
  assert.equal(r.perSurface[0].good, false);
  assert.equal(r.zeroTouch, false);
});

test('summarize: promedios y fracción sin tocar', () => {
  const a = evaluatePhoto([S('P', 'pared', rect(0, 0, 20, 10))], [S('p', 'pared', rect(0, 0, 20, 10))]);
  const b = evaluatePhoto([S('P', 'pared', rect(0, 0, 20, 10))], []);
  const s = summarize([a, b]);
  assert.equal(s.fotos, 2);
  assert.equal(s.sinTocar, 0.5);
  assert.equal(s.encontradas, 0.5);
  assert.equal(s.iouMedio, 0.5);
});
