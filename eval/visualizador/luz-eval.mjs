// Evalúa el MODELO DE LUZ del recoloreo contra el render de Sinteplast (solo referencia), usando la caché de máscaras de comparar-par.
// Mide DENTRO de la máscara que detectamos nosotros (erosionada), no en lo que Sinteplast "cambió".
// Por superficie y por variante: ΔE00 del color medio, y ΔL en los percentiles 10/50/90 (distribución de luz) contra el render.
// Uso: PARES_CACHE=... FOTOS_DIR=... node luz-eval.mjs <config.json> [variantes.json]   (sin SAM)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { featherMask, recolorWall, estimateWhiteBalance, rgbToLab, deltaE00 } from '@pintureria/core';
import { workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FOTOS = process.env.FOTOS_DIR ?? path.join(here, 'fotos');
const CACHE = process.env.PARES_CACHE;
const ERODE = Number(process.env.ERODE ?? 6);
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const hex = (s) => '#' + s.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('');
const VARIANTES = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {
  actual_wb: { mode: 'relative', wb: 1 }, actual_sinwb: { mode: 'relative', wb: 0 }, luz_sinwb: { mode: 'luz', wb: 0, refPct: 0.9 },
};

function resize(s, w, h, nw, nh) {
  if (w === nw && h === nh) return s;
  const o = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, ((y + 0.5) * h) / nh - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, ((x + 0.5) * w) / nw - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
      for (let c = 0; c < 4; c++) {
        const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c];
        o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return o;
}
function erode(mask, w, h, r) {
  if (r <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    const i = y * w + x;
    if (!mask[i] || !mask[i - r] || !mask[i + r] || !mask[i - r * w] || !mask[i + r * w] || !mask[i - r * w - r] || !mask[i + r * w + r] || !mask[i - r * w + r] || !mask[i + r * w - r]) continue;
    out[i] = 1;
  }
  return out;
}
const pctile = (arr, q) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

export const filas = [];
for (const c of cfg) {
  const raw = jpeg.decode(fs.readFileSync(path.join(FOTOS, c.foto)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height), N = width * height;
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const cap = jpeg.decode(fs.readFileSync(c.theirs), { useTArray: true, formatAsRGBA: true });
  const [x0, y0, cw, ch] = c.crop, crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) for (let k = 0; k < 4; k++) crop[(y * cw + x) * 4 + k] = cap.data[((y0 + y) * cap.width + x0 + x) * 4 + k];
  const theirs = resize(crop, cw, ch, width, height);
  const cacheFile = path.join(CACHE, `${c.foto}.masks.gz`);
  const found = JSON.parse(zlib.gunzipSync(fs.readFileSync(cacheFile)).toString('utf8')).map((f) => ({ ...f, mask: new Uint8Array(Buffer.from(f.mask, 'base64')) }));
  for (const s of c.superficies) {
    const px = Math.min(width - 1, Math.floor(s.en[0] * width)), py = Math.min(height - 1, Math.floor(s.en[1] * height));
    const f = found.find((q) => q.mask[py * width + px]);
    if (!f) { console.log(`${c.foto} ${s.nombre}: no detectada`); continue; }
    const inner = erode(f.mask, width, height, ERODE), idx = [];
    for (let i = 0; i < N; i++) if (inner[i]) idx.push(i);
    if (idx.length < 200) { console.log(`${c.foto} ${s.nombre}: interior vacío`); continue; }
    const labOf = (data, i) => rgbToLab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    const stat = (data) => {
      let r = 0, g = 0, b = 0; const Ls = [];
      for (const i of idx) { r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; Ls.push(labOf(data, i).L); }
      const n = idx.length;
      return { mean: [r / n, g / n, b / n], p10: pctile(Ls, 0.1), p50: pctile(Ls, 0.5), p90: pctile(Ls, 0.9) };
    };
    const st = stat(theirs), ph = stat(img.data), sw = s.swatch.split(',').map(Number);
    const fila = { swLab: rgbToLab(sw), foto: c.foto.replace(/\.jpg$/, ''), sup: s.nombre, swL: rgbToLab(sw).L, orig: ph, sint: st, v: {} };
    const mask = featherMask(Float32Array.from(f.mask), width, height, Math.max(1, Math.round(width / 500)));
    const wbCache = {};
    for (const [nombre, o] of Object.entries(VARIANTES)) {
      const key = `${o.wb ?? 0}|${o.maxGain ?? 1.35}`;
      wbCache[key] ??= (o.wb ?? 0) > 0 ? estimateWhiteBalance(img, { strength: o.wb, maxGain: o.maxGain ?? 1.35 }) : [1, 1, 1];
      const { wb, maxGain, ...ro } = o;
      const out = recolorWall(img, mask, hex(s.swatch), { ...ro, gains: wbCache[key] }).image;
      const mo = stat(out.data);
      let pix = 0; for (const i of idx) pix += Math.abs(labOf(out.data, i).L - labOf(theirs, i).L);
      fila.v[nombre] = { lab: rgbToLab(mo.mean), dE: deltaE00(rgbToLab(mo.mean), rgbToLab(st.mean)), L: rgbToLab(mo.mean).L, dL10: mo.p10 - st.p10, dL50: mo.p50 - st.p50, dL90: mo.p90 - st.p90, pixL: pix / idx.length };
    }
    filas.push(fila);
  }
}
const noms = Object.keys(VARIANTES);
if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(filas));
console.log(['superficie'.padEnd(26), 'swL', 'sintL', 'origL', ...noms.map((n) => n.slice(0, 14).padStart(14))].join(' '));
const sum = Object.fromEntries(noms.map((n) => [n, { dE: 0, aL50: 0, pix: 0 }]));
for (const r of filas) {
  console.log([`${r.foto} ${r.sup}`.padEnd(26), r.swL.toFixed(0).padStart(3), rgbToLab(r.sint.mean).L.toFixed(0).padStart(5), rgbToLab(r.orig.mean).L.toFixed(0).padStart(5),
    ...noms.map((n) => `${r.v[n].dE.toFixed(1)}/${r.v[n].L.toFixed(0)}/${r.v[n].pixL.toFixed(1)}`.padStart(14))].join(' '));
  for (const n of noms) { sum[n].dE += r.v[n].dE; sum[n].aL50 += Math.abs(r.v[n].dL50); sum[n].pix += r.v[n].pixL; }
}
if (process.env.LAB) { const n0 = process.env.LAB; for (const r of filas) { const f = (l) => `${l.L.toFixed(0)},${l.a.toFixed(0)},${l.b.toFixed(0)}`; console.log(`LAB ${(r.foto + ' ' + r.sup).padEnd(28)} swatch ${f(r.swLab)} | Sinteplast ${f(rgbToLab(r.sint.mean))} | ${n0} ${f(r.v[n0].lab)} | foto ${f(rgbToLab(r.orig.mean))} p10/50/90 ${r.orig.p10.toFixed(0)}/${r.orig.p50.toFixed(0)}/${r.orig.p90.toFixed(0)} sint ${r.sint.p10.toFixed(0)}/${r.sint.p50.toFixed(0)}/${r.sint.p90.toFixed(0)} nuestro ${(r.sint.p10 + r.v[n0].dL10).toFixed(0)}/${(r.sint.p50 + r.v[n0].dL50).toFixed(0)}/${(r.sint.p90 + r.v[n0].dL90).toFixed(0)}`); } }
console.log('(celda = ΔE00 media / L media nuestra / |ΔL| medio por píxel)');
// resumen: ajuste (entrenamiento) vs reservadas (HELD, por defecto 03-living-ventanal-tv y 02-living-puerta); y leave-one-out por foto
const HELD = (process.env.HELD ?? '03-living-ventanal-tv,02-living-puerta').split(',');
const grupos = { entren: filas.filter((r) => !HELD.includes(r.foto)), reserv: filas.filter((r) => HELD.includes(r.foto)) };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
for (const n of noms) {
  const f = (rs) => `ΔE00 medio ${avg(rs.map((r) => r.v[n].dE)).toFixed(2)} (mediana ${med(rs.map((r) => r.v[n].dE)).toFixed(1)}) · |ΔL p10| ${avg(rs.map((r) => Math.abs(r.v[n].dL10))).toFixed(1)} |ΔL p50| ${avg(rs.map((r) => Math.abs(r.v[n].dL50))).toFixed(1)} |ΔL p90| ${avg(rs.map((r) => Math.abs(r.v[n].dL90))).toFixed(1)} · ΔL medio firmado ${avg(rs.map((r) => r.v[n].L - rgbToLab(r.sint.mean).L)).toFixed(1)}`;
  console.log(`${n.padEnd(22)} ENTREN(n=${grupos.entren.length}) ${f(grupos.entren)}
${''.padEnd(22)} RESERV(n=${grupos.reserv.length}) ${f(grupos.reserv)}`);
}
