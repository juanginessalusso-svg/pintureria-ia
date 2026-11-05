import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, embedFraction, detectFraction, totalFraction, timeHint, DETECT_MAX, DETECT_TYPICAL } from '../src/progress.js';

test('fmtDuration redondea y no aparenta precisión', () => {
  assert.equal(fmtDuration(3000), 'unos segundos');
  assert.equal(fmtDuration(42000), 'unos 40 s');
  assert.equal(fmtDuration(120000), '2 min');
  assert.equal(fmtDuration(150000), '2,5 min');
  assert.equal(fmtDuration(15 * 60000), '15 min');
});

test('la barra nunca llega al 100 % antes de terminar y es monótona', () => {
  assert.equal(embedFraction(1e9, 1000), 0.95);
  assert.equal(embedFraction(5, 0), 0);
  assert.equal(detectFraction(DETECT_MAX * 2), 0.95);
  let prev = -1;
  for (let n = 0; n <= 80; n++) {
    const f = totalFraction({ stage: 'detect', n });
    assert.ok(f >= prev && f < 1); prev = f;
  }
  assert.ok(totalFraction({ stage: 'embed', embedElapsed: 1e9, embedEstimate: 1 }) <= totalFraction({ stage: 'detect', n: 0 }));
  assert.equal(totalFraction({ stage: 'wait' }), 0);
});

test('timeHint: sólo cotas basadas en el ritmo medido en este teléfono', () => {
  assert.match(timeHint({ stage: 'embed' }), /par de minutos/);
  assert.match(timeHint({ stage: 'embed', initMs: 10000, embedElapsed: 5000 }), /faltan unos 30 s/);
  assert.match(timeHint({ stage: 'embed', initMs: 10000, embedElapsed: 29000 }), /casi lista/);
  assert.match(timeHint({ stage: 'detect', n: 1 }), /Calculando/);
  // 10 decodificaciones en 30 s = 3 s c/u -> como mucho (60-10)*3 = 150 s = 2,5 min
  assert.match(timeHint({ stage: 'detect', n: 10, detectElapsed: 30000 }), /como mucho 2,5 min/);
  assert.match(timeHint({ stage: 'detect', n: DETECT_TYPICAL, detectElapsed: 30000 }), /Falta poco/);
  assert.equal(timeHint({ stage: 'wait' }), '');
});
