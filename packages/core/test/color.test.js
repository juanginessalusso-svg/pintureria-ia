import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHex, hexToLab } from '../src/index.js';

const close = (a, b, eps = 0.1) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('normalizeHex acepta variantes y rechaza basura', () => {
  assert.equal(normalizeHex('#FFF'), '#ffffff');
  assert.equal(normalizeHex('a1b2c3'), '#a1b2c3');
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex('zzzzzz'), null);
  assert.equal(normalizeHex(undefined), null);
});

test('hexToLab: blanco, negro y rojo (valores de referencia D65)', () => {
  const w = hexToLab('#ffffff'); close(w.L, 100); close(w.a, 0); close(w.b, 0);
  const k = hexToLab('#000000'); close(k.L, 0); close(k.a, 0); close(k.b, 0);
  const r = hexToLab('#ff0000'); close(r.L, 53.24); close(r.a, 80.09); close(r.b, 67.2);
});
