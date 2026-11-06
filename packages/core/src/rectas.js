// Enderezado de bordes entre superficies vecinas (techo/pared, pared/pared): la unión de dos planos de un ambiente es una RECTA, pero
// la máscara que sale de SAM + reglas queda "rasgada" donde el contraste es chico (blanco sobre blanco). Se ajusta una recta robusta (RANSAC)
// a la frontera compartida y se reasignan los píxeles de una franja angosta a un lado u otro de la recta. Solo toca píxeles de A ∪ B.
// Determinista (generador pseudoaleatorio con semilla fija). Opciones: minLen (largo mínimo de la frontera, fracción del lado mayor),
// inlier (tolerancia en fracción del ancho), band (semiancho de la franja a reasignar, fracción del ancho), minShare (fracción de la frontera
// que debe caer sobre la recta para aceptarla).

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Puntos de la frontera de A con B (píxeles de A con algún vecino 4 en B). */
export function sharedBoundary(A, B, w, h) {
  const pts = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!A[i]) continue;
      if ((x > 0 && B[i - 1]) || (x < w - 1 && B[i + 1]) || (y > 0 && B[i - w]) || (y < h - 1 && B[i + w])) pts.push(x, y);
    }
  }
  return pts; // [x0, y0, x1, y1, ...]
}

/** Recta robusta (RANSAC + mínimos cuadrados totales). Devuelve { nx, ny, c, inliers } con nx*x + ny*y = c, o null. */
export function fitLine(pts, tol, iters = 300) {
  const n = pts.length / 2;
  if (n < 20) return null;
  const rnd = lcg(12345);
  let best = null, bestCount = 0;
  for (let k = 0; k < iters; k++) {
    const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
    if (a === b) continue;
    const dx = pts[b * 2] - pts[a * 2], dy = pts[b * 2 + 1] - pts[a * 2 + 1], len = Math.hypot(dx, dy);
    if (len < 10) continue;
    const nx = -dy / len, ny = dx / len, c = nx * pts[a * 2] + ny * pts[a * 2 + 1];
    let count = 0;
    for (let i = 0; i < n; i++) if (Math.abs(nx * pts[i * 2] + ny * pts[i * 2 + 1] - c) <= tol) count++;
    if (count > bestCount) { bestCount = count; best = { nx, ny, c }; }
  }
  if (!best) return null;
  // refinamiento: mínimos cuadrados totales sobre los inliers
  const inl = [];
  for (let i = 0; i < n; i++) if (Math.abs(best.nx * pts[i * 2] + best.ny * pts[i * 2 + 1] - best.c) <= tol) inl.push(i);
  let mx = 0, my = 0;
  for (const i of inl) { mx += pts[i * 2]; my += pts[i * 2 + 1]; }
  mx /= inl.length; my /= inl.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const i of inl) { const ux = pts[i * 2] - mx, uy = pts[i * 2 + 1] - my; sxx += ux * ux; sxy += ux * uy; syy += uy * uy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // dirección principal
  const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
  return { nx, ny, c: nx * mx + ny * my, inliers: inl, dx, dy };
}

/**
 * Endereza la frontera entre A y B (máscaras Uint8Array w*h, se modifican en el lugar). Devuelve info o null si no hubo una recta clara.
 */
export function straightenPair(A, B, w, h, { minLen = 0.15, inlier = 0.006, band = 0.02, minShare = 0.5 } = {}) {
  const pts = sharedBoundary(A, B, w, h);
  const n = pts.length / 2, tol = Math.max(2, inlier * w), bw = Math.max(6, band * w);
  if (n < minLen * Math.max(w, h)) return null;
  const L = fitLine(pts, tol);
  if (!L || L.inliers.length < minShare * n || L.inliers.length < minLen * Math.max(w, h)) return null;
  // extensión de la recta que realmente comparten A y B (a lo largo de la dirección), con un margen
  let tmin = Infinity, tmax = -Infinity;
  for (const i of L.inliers) { const t = pts[i * 2] * L.dx + pts[i * 2 + 1] * L.dy; if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
  tmin -= bw; tmax += bw;
  // de qué lado de la recta está A: media firmada de sus píxeles a distancia entre bw y 4*bw
  let sA = 0, nA = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!A[y * w + x]) continue;
    const d = L.nx * x + L.ny * y - L.c, ad = Math.abs(d);
    if (ad > bw && ad < 4 * bw) { sA += d; nA++; }
  }
  if (!nA) return null;
  const signA = sA > 0 ? 1 : -1;
  let moved = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!A[i] && !B[i]) continue;
    const d = L.nx * x + L.ny * y - L.c;
    if (Math.abs(d) > bw) continue;
    const t = x * L.dx + y * L.dy;
    if (t < tmin || t > tmax) continue;
    const inA = d * signA > 0;
    if (inA && !A[i]) { A[i] = 1; B[i] = 0; moved++; } else if (!inA && !B[i]) { B[i] = 1; A[i] = 0; moved++; }
  }
  return { points: n, inliers: L.inliers.length, moved, angle: Math.atan2(L.dy, L.dx) };
}

/** Endereza todas las fronteras techo↔pared y pared↔pared entre las superficies detectadas (modifica sus máscaras). */
export function straightenBoundaries(surfaces, w, h, opts = {}) {
  const info = [];
  for (let a = 0; a < surfaces.length; a++) {
    for (let b = a + 1; b < surfaces.length; b++) {
      const A = surfaces[a], B = surfaces[b];
      if (A.kind === 'ladrillo' || B.kind === 'ladrillo') continue;
      const r = straightenPair(A.mask, B.mask, w, h, opts);
      if (r) info.push({ a: A.name, b: B.name, ...r });
    }
  }
  return info;
}
