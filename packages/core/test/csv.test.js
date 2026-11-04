import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectDelimiter, parseNumber, parsePriceCents, productsFromCsv, decodeCsvBytes, CSV_TEMPLATE } from '../src/index.js';

test('parseNumber: formatos argentinos', () => {
  assert.equal(parseNumber('11,5'), 11.5);
  assert.equal(parseNumber('48.000'), 48000);
  assert.equal(parseNumber('1.250.000'), 1250000);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56); // formato US
  assert.equal(parseNumber('11.5'), 11.5);
  assert.equal(parseNumber('0,75'), 0.75);
  assert.equal(parseNumber('$ 48.000,50'), 48000.5);
  assert.equal(parseNumber('4 L'), 4);
  assert.equal(parseNumber('3,6 lts'), 3.6);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
});

test('parsePriceCents: pesos -> centavos sin errores de punto flotante', () => {
  assert.equal(parsePriceCents('$ 48.000'), 4800000);
  assert.equal(parsePriceCents('19000,50'), 1900050);
  assert.equal(parsePriceCents('0,29'), 29);
  assert.equal(parsePriceCents('1.005,10'), 100510);
});

test('detectDelimiter: ; , y tab (ignora separadores dentro de comillas)', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('"a,b";c;d'), ';');
});

test('parseCsv: comillas, "" escapadas, saltos de línea dentro de un campo, CRLF, BOM, líneas', () => {
  const rows = parseCsv('﻿a;b\r\n"x;y";"di ""hola"""\r\n"multi\nlinea";z\r\n\r\nfin;1');
  assert.deepEqual(rows.map((r) => r.cells), [['a', 'b'], ['x;y', 'di "hola"'], ['multi\nlinea', 'z'], ['fin', '1']]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 3, 6]); // la línea de cada fila en el archivo original
});

test('decodeCsvBytes: UTF-8 y Windows-1252 (Excel en español)', () => {
  assert.equal(decodeCsvBytes(new TextEncoder().encode('Látex niño')), 'Látex niño');
  // "Látex" en Windows-1252: á = 0xE1
  assert.equal(decodeCsvBytes(new Uint8Array([0x4c, 0xe1, 0x74, 0x65, 0x78])), 'Látex');
});

test('productsFromCsv: archivo típico de Excel (;, coma decimal, una fila por presentación)', () => {
  const csv = [
    'Código;Producto;Rubro;Manos;Rinde (m2/L);Litros;Precio;Activo',
    'LAT-1;Látex interior mate;Interior;2;11,5;4;$ 48.000,00;Sí',
    'LAT-1;;;;;10;$ 110.000,00;',
    'LAT-1;;;;;20;$ 200.000,00;',
    'ESM-1;Esmalte sintético;Esmalte;2;12;0,5;9.500;no',
    'ESM-1;;;;;1;19.000;',
  ].join('\r\n');
  const r = productsFromCsv(csv);
  assert.deepEqual(r.errors, []);
  assert.equal(r.products.length, 2);
  const [lat, esm] = r.products;
  assert.equal(lat.sku, 'LAT-1');
  assert.equal(lat.yield_m2_per_l, 11.5);
  assert.equal(lat.coats, 2);
  assert.equal(lat.active, true);
  assert.deepEqual(lat.sizes, [{ liters: 4, price_cents: 4800000 }, { liters: 10, price_cents: 11000000 }, { liters: 20, price_cents: 20000000 }]);
  assert.equal(esm.active, false);
  assert.deepEqual(esm.sizes, [{ liters: 0.5, price_cents: 950000 }, { liters: 1, price_cents: 1900000 }]);
});

test('productsFromCsv: "activo" acepta Sí/SI/no con tildes y mayúsculas sin avisos', () => {
  const r = productsFromCsv('sku;nombre;rendimiento;activo\nA;A;10;Sí\nB;B;10;NO\nC;C;10;\nD;D;10;quizás');
  assert.deepEqual(r.products.map((p) => p.active), [true, false, true, true]);
  assert.equal(r.warnings.length, 1); // solo "quizás"
});

test('productsFromCsv: encabezados con sinónimos, tildes y mayúsculas', () => {
  const r = productsFromCsv('SKU,NOMBRE,Rendimiento (m²/L por mano),Ficha técnica\nA1,Producto A,10,"Paso 1\nPaso 2"');
  assert.deepEqual(r.errors, []);
  assert.equal(r.products[0].tech_sheet, 'Paso 1\nPaso 2');
  assert.deepEqual(r.products[0].sizes, []); // sin presentaciones: se permite
});

test('productsFromCsv: errores con número de línea', () => {
  const csv = ['sku;nombre;rendimiento;litros;precio', 'A;Prod A;abc;4;100', 'B;;10;4;100', ';Sin sku;10;4;100',
    'C;Prod C;10;cuatro;100', 'C;;;4;mil', 'D;Prod D;10;4;100', 'D;;;4;200'].join('\n');
  const r = productsFromCsv(csv);
  const lines = r.errors.map((e) => e.line);
  assert.deepEqual(lines.sort((a, b) => a - b), [2, 3, 4, 5, 6, 8]); // un solo error por problema (sin duplicados)
  assert.ok(r.errors.find((e) => e.line === 2 && /rendimiento inválido/.test(e.message)));
  assert.ok(r.errors.find((e) => e.line === 3 && /nombre/.test(e.message)));
  assert.ok(r.errors.find((e) => e.line === 4 && /SKU/.test(e.message)));
  assert.ok(r.errors.find((e) => e.line === 5 && /litros inválidos/.test(e.message)));
  assert.ok(r.errors.find((e) => e.line === 6 && /precio inválido/.test(e.message)));
  assert.ok(r.errors.find((e) => e.line === 8 && /repetida/.test(e.message)));
});

test('productsFromCsv: avisos (nombre distinto, sin precio, columnas ignoradas) y columnas obligatorias', () => {
  const r = productsFromCsv('sku;nombre;rendimiento;litros;precio;color favorito\nA;Prod A;10;4;;rojo\nA;Otro nombre;;10;100;azul');
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
  assert.deepEqual(r.ignoredColumns, ['color favorito']);
  assert.equal(r.products[0].name, 'Prod A');
  assert.deepEqual(r.products[0].sizes[0], { liters: 4, price_cents: 0 });
  const bad = productsFromCsv('codigo;nombre\nA;B');
  assert.ok(bad.errors[0].message.includes('rendimiento'));
  assert.equal(productsFromCsv('').errors.length, 1);
});

test('la plantilla descargable se importa sin errores ni avisos', () => {
  const r = productsFromCsv(CSV_TEMPLATE);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.products.length, 2);
  assert.equal(r.products[0].sizes.length, 3);
  assert.equal(r.products[1].sizes[0].price_cents, 1900050);
});
