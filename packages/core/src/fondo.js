// Pared del fondo (regla de Ginés 2026-11-13): la pared que se ve más allá de la habitación (por una abertura, detrás de una columna,
// la cocina de al lado) no es la que el cliente quiere pintar y además es la más difícil de detectar bien. Con un mapa de profundidad
// (Depth Anything V2 Small: disparidad relativa, más alto = más cerca) cada pared se compara con la principal (la más grande): si su
// cercanía típica es menor que `ratio` de la de la principal, queda como superficie sin color "Pared del fondo" (kind 'ladrillo': el
// cliente la pinta solo si la toca). Lejos sola no alcanza (la otra pared de una esquina también se aleja): además, en su borde con las
// otras superficies tiene que haber un SALTO de profundidad (lo de adelante bastante más cerca), como detrás de una columna o por una puerta.
// prof: { data: Float32Array, width, height } (puede tener otro tamaño que la foto).

function mediana(v) { if (!v.length) return 0; v.sort((a, b) => a - b); return v[v.length >> 1]; }

export function marcarFondo(found, w, h, prof, { ratio = 0.6, minArea = 0.002, minSalto = 0.4 } = {}) {
  if (!prof) return found;
  const { data, width: pw, height: ph } = prof;
  const cerc = (f) => { const v = []; for (let i = 0; i < f.mask.length; i += 7) if (f.mask[i]) { const x = i % w, y = (i - x) / w; v.push(data[Math.min(ph - 1, Math.floor(y * ph / h)) * pw + Math.min(pw - 1, Math.floor(x * pw / w))]); } return mediana(v); };
  const paredes = found.filter((f) => f.kind === 'pared' && f.area >= minArea);
  if (paredes.length < 2) return found;
  const principal = paredes.reduce((a, b) => (b.area > a.area ? b : a));
  let lo = Infinity; for (let i = 0; i < data.length; i++) if (data[i] < lo) lo = data[i]; // la disparidad no tiene cero real: se mide desde lo más lejano de la foto
  const cp = cerc(principal) - lo, info = [];
  const dAt = (x, y) => data[Math.min(ph - 1, Math.max(0, Math.floor(y * ph / h))) * pw + Math.min(pw - 1, Math.max(0, Math.floor(x * pw / w)))] - lo;
  // dueño de cada píxel (para saber con qué superficie limita cada borde)
  const dueno = new Int32Array(w * h); found.forEach((f, k) => { for (let i = 0; i < f.mask.length; i++) if (f.mask[i] && !dueno[i]) dueno[i] = k + 1; });
  const paso = Math.max(3, Math.round(0.0025 * Math.max(w, h))); // pegado al borde: en una esquina la profundidad es continua justo ahí
  const cruce = Math.max(4, Math.round(0.01 * Math.max(w, h)));
  // salto: en el borde de f con OTRA superficie (pared o techo), lo de afuera está bastante más cerca que lo de adentro
  const salto = (f, k) => {
    let n = 0, s = 0;
    for (let y = paso; y < h - paso; y += 3) for (let x = paso; x < w - paso; x += 3) {
      const i = y * w + x; if (dueno[i] !== k + 1) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (dueno[(y + dy) * w + x + dx] === k + 1) continue;
        // la superficie vecina puede estar del otro lado de una franja sin asignar (el canto de una columna): se la busca hasta `cruce` px
        let t = 1, o = 0;
        for (; t <= cruce; t++) { const xx = x + dx * t, yy = y + dy * t; if (xx < 0 || yy < 0 || xx >= w || yy >= h) break; o = dueno[yy * w + xx]; if (o) break; }
        if (!o || o === k + 1) continue;
        const g = found[o - 1]; if (g.kind !== 'pared') continue; // solo contra paredes: subir al techo siempre "acerca" (el techo viene hacia la cámara)
        const din = dAt(x - dx * paso, y - dy * paso), dout = dAt(x + dx * (t + paso), y + dy * (t + paso));
        n++; if (dout > 1.3 * din + 0.02 * cp) s++;
      }
    }
    return n ? s / n : 0;
  };
  const out = found.map((f, k) => {
    if (f.kind !== 'pared' || f === principal || f.area < minArea) return f;
    const c = cerc(f) - lo, sj = salto(f, k); info.push({ name: f.name, area: +f.area.toFixed(3), rel: +(c / cp).toFixed(2), salto: +sj.toFixed(2) });
    return c < ratio * cp && sj >= minSalto ? { ...f, kind: 'ladrillo', name: 'Pared del fondo' } : f;
  });
  if (globalThis.process?.env?.DEBUG_RECTAS) console.error('fondo', JSON.stringify({ principal: principal.name, info }));
  return out;
}
