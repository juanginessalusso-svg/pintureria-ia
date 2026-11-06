import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeMetrics, renderedSurfaceMask, aggregate, globalIoU } from '../../../eval/visualizador/metrica-bordes.mjs';

const W = 120, H = 100;
const rect = (x0, y0, x1, y1) => { const m = new Uint8Array(W * H); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; return m; };
// "render" de Sinteplast: rectángulo pintado de rosa sobre fondo gris; un bloque lejano de otro color (artefacto: tono alterado de lo que no se pintó)
function render({ artifact = false } = {}) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0, pink = x >= 20 && x < 80 && y >= 10 && y < 90; const far = x >= 95 && y >= 30 && y < 70; const c = pink ? [200, 120, 140] : far && artifact ? [60, 120, 200] : far ? [128, 128, 128] : [128, 128, 128]; d.set([...c, 255], i * 4); }
  return d;
}

test('la métrica de franja da 1 con contornos idénticos y no se mueve con el artefacto lejano', () => {
  const ours = rect(20, 10, 80, 90), theirsA = renderedSurfaceMask(render(), ours, W, H, { band: 12 }), theirsB = renderedSurfaceMask(render({ artifact: true }), ours, W, H, { band: 12 });
  const a = edgeMetrics({ ours, theirs: theirsA, width: W, height: H }), b = edgeMetrics({ ours, theirs: theirsB, width: W, height: H });
  assert.ok(a.bandIoU > 0.99 && a.in3 === 1 && a.dOurs < 0.5);
  assert.equal(b.bandIoU, a.bandIoU);
  assert.equal(b.dOurs, a.dOurs);
});

test('un contorno corrido 5 px se nota en la franja y en la distancia', () => {
  const theirs = rect(20, 10, 80, 90), ours = rect(25, 10, 85, 90);
  const m = edgeMetrics({ ours, theirs, width: W, height: H });
  assert.ok(m.bandIoU < 0.9 && m.bandIoU > 0.5);
  assert.ok(m.dOurs > 1 && m.in3 < 1);
  assert.equal(edgeMetrics({ ours: theirs, theirs, width: W, height: H }).bandIoU, 1);
});

test('las superficies ignoradas no cuentan, y aggregate pondera por píxeles', () => {
  const theirs = rect(20, 10, 80, 90), ours = rect(20, 10, 80, 60), ignore = rect(20, 60, 80, 90);
  const con = edgeMetrics({ ours, theirs, width: W, height: H }), sin = edgeMetrics({ ours, theirs, ignore, width: W, height: H });
  assert.ok(sin.bandIoU > con.bandIoU);
  const ag = aggregate([con, sin]);
  assert.ok(ag.bandIoU > con.bandIoU && ag.bandIoU < sin.bandIoU + 1e-9);
  assert.equal(globalIoU(ours, ours), 1);
});
