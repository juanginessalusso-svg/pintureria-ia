// Importación de productos desde CSV pensada para archivos de Excel argentinos:
//  - separador ; o , o tab (se detecta), comillas con "" escapadas, saltos de línea CRLF, BOM al principio
//  - números con coma decimal ("11,5") y precios "$ 48.000,50"
//  - una FILA POR PRESENTACIÓN: se repite el SKU y cambian litros y precio
// Funciones puras, sin dependencias. La validación fina (rangos, longitudes) la completa el esquema de la API.

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Decodifica bytes de un CSV: UTF-8 y, si no es válido (típico "CSV" de Excel en Windows), Windows-1252. */
export function decodeCsvBytes(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function detectDelimiter(text) {
  const head = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const count = (ch) => {
    let n = 0, q = false;
    for (const c of head) { if (c === '"') q = !q; else if (!q && c === ch) n++; }
    return n;
  };
  const best = [';', '\t', ','].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ';';
}

/** Parser CSV (RFC 4180 + campos con saltos de línea). Devuelve filas de {line, cells}. */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let cells = [], cell = '', q = false, line = 1, rowLine = 1;
  const endCell = () => { cells.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"') q = true;
    else if (c === delimiter) endCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow(); line++; rowLine = line;
    } else cell += c;
  }
  if (cell !== '' || cells.length) endRow();
  return rows;
}

/** "11,5" -> 11.5 · "48.000" -> 48000 · "1.234,56" -> 1234.56 · "4 L" -> 4 · basura -> null. */
export function parseNumber(raw) {
  let s = String(raw ?? '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.'); // convención argentina: la coma es decimal
  } else if (hasDot) {
    // "48.000" / "1.250.000" = miles; "11.5" / "0.75" = decimal
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Precio en pesos -> centavos enteros. */
export function parsePriceCents(raw) {
  const n = parseNumber(raw);
  return n == null ? null : Math.round(n * 100);
}

const COLUMNS = [
  ['sku', (k) => ['sku', 'codigo', 'cod', 'code', 'articulo', 'codigodeproducto'].includes(k)],
  ['name', (k) => ['nombre', 'producto', 'name', 'denominacion'].includes(k)],
  ['category', (k) => ['categoria', 'rubro', 'familia', 'tipo', 'linea'].includes(k)],
  ['description', (k) => ['descripcion', 'detalle', 'description'].includes(k)],
  ['coats', (k) => k.startsWith('manos') || k === 'coats'],
  ['yield', (k) => k.includes('rendimiento') || k.includes('rinde') || k.startsWith('m2')],
  ['tech', (k) => k.includes('fichatecnica') || k.includes('instruccion') || k.includes('aplicacion') || k === 'ficha' || k.includes('pasos')],
  ['active', (k) => ['activo', 'visible', 'habilitado', 'active', 'publicado'].includes(k)],
  ['liters', (k) => ['litros', 'litro', 'lts', 'lt', 'presentacion', 'contenido', 'capacidad', 'l'].includes(k)],
  ['price', (k) => k.includes('precio') || k === 'pvp' || k.includes('importe') || k === 'valor'],
];

const YES = new Set(['si', 's', '1', 'true', 'x', 'activo', 'yes', 'y', 'verdadero']);
const NO = new Set(['no', 'n', '0', 'false', 'inactivo', 'falso']);

/**
 * CSV -> productos. Devuelve { products, errors, warnings, ignoredColumns }.
 * Cada producto: {sku,name,category,description,coats,yield_m2_per_l,tech_sheet,active,sizes:[{liters,price_cents}], line}
 * `line` es la primera línea del archivo donde aparece el SKU (para que la API pueda señalar errores).
 */
export function productsFromCsv(text) {
  const errors = [], warnings = [];
  const rows = parseCsv(text);
  if (rows.length < 2) return { products: [], errors: [{ line: 1, message: 'El archivo está vacío o solo tiene los encabezados.' }], warnings, ignoredColumns: [] };

  const header = rows[0].cells.map((h) => h.trim());
  const col = {}, ignoredColumns = [];
  header.forEach((h, i) => {
    const key = strip(h);
    const hit = COLUMNS.find(([name, test]) => !(name in col) && test(key));
    if (hit) col[hit[0]] = i; else if (h) ignoredColumns.push(h);
  });
  for (const [need, label] of [['sku', 'sku (o código)'], ['name', 'nombre (o producto)'], ['yield', 'rendimiento (m² por litro y por mano)']]) {
    if (!(need in col)) errors.push({ line: 1, message: `Falta la columna obligatoria "${label}". Encabezados encontrados: ${header.join(' | ')}` });
  }
  if (errors.length) return { products: [], errors, warnings, ignoredColumns };

  const get = (r, name) => (name in col ? (r.cells[col[name]] ?? '').trim() : '');
  const bySku = new Map();

  for (const r of rows.slice(1)) {
    const line = r.line;
    const sku = get(r, 'sku');
    if (!sku) { errors.push({ line, message: 'Fila sin SKU.' }); continue; }
    const key = sku.toLowerCase();
    let p = bySku.get(key);

    const yRaw = get(r, 'yield'), cRaw = get(r, 'coats');
    const yieldN = yRaw ? parseNumber(yRaw) : null, coatsN = cRaw ? parseNumber(cRaw) : null;
    if (yRaw && !(yieldN > 0 && yieldN <= 100)) errors.push({ line, sku, message: `${sku}: rendimiento inválido "${yRaw}" (esperado un número entre 0 y 100, en m² por litro y por mano).` });
    if (cRaw && !(Number.isInteger(coatsN) && coatsN >= 1 && coatsN <= 4)) errors.push({ line, sku, message: `${sku}: manos inválidas "${cRaw}" (1 a 4).` });

    if (!p) {
      const aRaw = strip(get(r, 'active')); // "Sí", "SI", " si " => "si"
      if (aRaw && !YES.has(aRaw) && !NO.has(aRaw)) warnings.push({ line, message: `${sku}: valor de "activo" no reconocido ("${aRaw}"), se toma como sí.` });
      p = {
        sku, name: get(r, 'name'), category: get(r, 'category'), description: get(r, 'description'),
        coats: coatsN ?? 2, yield_m2_per_l: yieldN, tech_sheet: get(r, 'tech'), active: !NO.has(aRaw), sizes: [], line,
      };
      if (!p.name) errors.push({ line, sku, message: `${sku}: falta el nombre.` });
      if (!yRaw) errors.push({ line, sku, message: `${sku}: falta el rendimiento.` });
      bySku.set(key, p);
    } else {
      // Filas siguientes del mismo SKU: pueden dejar vacío lo del producto; si lo cambian, se avisa y manda la primera.
      const name = get(r, 'name');
      if (name && name !== p.name) warnings.push({ line, message: `${sku}: el nombre difiere del de la primera fila ("${p.name}"); se usa el primero.` });
      if (yieldN != null && p.yield_m2_per_l != null && yieldN !== p.yield_m2_per_l) warnings.push({ line, message: `${sku}: rendimiento distinto al de la primera fila; se usa el primero.` });
      if (p.yield_m2_per_l == null && yieldN > 0) p.yield_m2_per_l = yieldN;
    }

    const lRaw = get(r, 'liters'), pRaw = get(r, 'price');
    if (!lRaw && !pRaw) continue; // producto sin presentación en esta fila
    const liters = parseNumber(lRaw);
    if (!(liters > 0 && liters <= 1000)) { errors.push({ line, sku, message: `${sku}: litros inválidos "${lRaw}".` }); continue; }
    const cents = pRaw ? parsePriceCents(pRaw) : 0;
    if (cents == null || cents < 0) { errors.push({ line, sku, message: `${sku}: precio inválido "${pRaw}".` }); continue; }
    if (!pRaw) warnings.push({ line, message: `${sku}: la presentación de ${liters} L no tiene precio (se carga en $0: no se podrá comparar costos).` });
    if (p.sizes.some((s) => s.liters === liters)) { errors.push({ line, sku, message: `${sku}: la presentación de ${liters} L está repetida.` }); continue; }
    p.sizes.push({ liters, price_cents: cents });
  }

  const products = [...bySku.values()];
  for (const p of products) p.sizes.sort((a, b) => a.liters - b.liters);
  return { products, errors, warnings, ignoredColumns };
}

/** Plantilla descargable: separador ; y BOM para que Excel en español la abra bien. Ejemplos ficticios. */
export const CSV_TEMPLATE = '﻿' + [
  'sku;nombre;categoria;descripcion;manos;rendimiento_m2_por_litro;litros;precio;activo;ficha_tecnica',
  'EJEMPLO-1;Látex interior mate (ejemplo);interior;Látex lavable para paredes interiores;2;11;4;48000;si;Aplicar sobre superficie limpia, seca y sellada.',
  'EJEMPLO-1;;;;;;10;110000;;',
  'EJEMPLO-1;;;;;;20;200000;;',
  'EJEMPLO-2;Esmalte sintético (ejemplo);esmalte;Para madera y metal;2;12;1;19000,50;si;Lijar y desengrasar antes de aplicar.',
  'EJEMPLO-2;;;;;;4;68000,00;;',
].join('\r\n') + '\r\n';
