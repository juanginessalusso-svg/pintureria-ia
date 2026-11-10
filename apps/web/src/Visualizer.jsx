import { useEffect, useRef, useState } from 'preact/hooks';
import { varita, LUZ_WB_STRENGTH, estimateWhiteBalance, whiteBalanceFor, featherMask, recolorWall, cleanMask, pxPerMeter, wallPixels, paintStroke, maskCount, encodeMask, cutObjectFromSurface } from '@pintureria/core';
import { SamClient } from './samClient.js';
import { workingSize } from './sam.js';
import { Calculator } from './Calculator.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { totalFraction, timeHint, yieldToUi, EMBED_PER_INIT } from './progress.js';

const tenantQ = () => {
  const t = new URLSearchParams(location.search).get('tenant');
  return t ? `?tenant=${encodeURIComponent(t)}` : '';
};
const getJson = (path) => fetch(`/api/public/${path}${tenantQ()}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
const mb = (n) => (n / 1048576).toFixed(0);

const ANOTAR = new URLSearchParams(location.search).get('anotar') === '1'; // modo de anotación (herramienta interna): ver eval/visualizador/medir.mjs
const MAX_ZOOM = 16;
const DATASET = typeof location !== 'undefined' && new URLSearchParams(location.search).get('dataset') === '1'; // modo recolección: tipo de cada superficie editable y botón de compartir
const MAX_SURF_UNDO = 8;
const DRAG_PX = 4; // cuánto hay que mover el dedo para que un toque pase a ser arrastre
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const viewTransform = (v) => `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;

// Pantalla de progreso por etapas (va dentro de .stage: queda a la vista aunque la foto esté fija arriba en el celular).
function AnalysisProgress({ prog, now, model }) {
  const t = now || Date.now();
  const stageElapsed = Math.max(0, t - prog.t0);
  const initMs = model.initMs || 0;
  const frac = totalFraction({ stage: prog.stage, embedElapsed: stageElapsed, embedEstimate: initMs * EMBED_PER_INIT, n: prog.n });
  const pctModel = model.total ? Math.round((model.loaded / model.total) * 100) : 0;
  const hint = prog.stage === 'wait' ? '' : timeHint({ stage: prog.stage, initMs, embedElapsed: stageElapsed, detectElapsed: stageElapsed, n: prog.n });
  const label = prog.stage === 'wait'
    ? (model.total ? `Cargando el modelo (solo la primera vez): ${mb(model.loaded)} de ${mb(model.total)} MB` : 'Cargando el modelo (solo la primera vez)…')
    : prog.stage === 'embed' ? 'Analizando la foto…' : `Buscando paredes y techo (paso ${prog.n + 1})…`;
  const steps = [['wait', 'Modelo'], ['embed', 'Foto'], ['detect', 'Paredes']];
  const idx = steps.findIndex(([k]) => k === prog.stage);
  return (
    <div class="analysis" role="status" aria-live="polite" data-stage={prog.stage}>
      <div class="steps">{steps.map(([k, n], i) => <span key={k} class={i < idx ? 'done' : i === idx ? 'now' : ''}>{i < idx ? '✓ ' : ''}{n}</span>)}</div>
      <strong>{label}</strong>
      <progress max="100" value={prog.stage === 'wait' ? pctModel : Math.round(frac * 100)} aria-label="Avance del análisis" />
      <span class="muted small">{prog.stage === 'wait' ? 'Si ya lo bajaste antes, esto es instantáneo.' : `Van ${fmtElapsed(t - prog.tAll)}. ${hint}`}</span>
      <span class="muted small">Podés esperar acá: la foto se procesa en tu teléfono.</span>
    </div>
  );
}
const fmtElapsed = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };

export function Visualizer() {
  const [tenant, setTenant] = useState(null);
  const [colors, setColors] = useState([]);
  const [model, setModel] = useState({ state: 'loading', loaded: 0, total: 0, info: '' });
  const [status, setStatus] = useState('');
  const [hasPhoto, setHasPhoto] = useState(false);
  const [aspect, setAspect] = useState(1); // ancho/alto de la foto: la foto fija en pantallas chicas se limita en alto sin deformarse
  const [points, setPoints] = useState([]);
  const [surfList, setSurfList] = useState([]); // superficies confirmadas (para la lista): {id, name, color}
  const [activeId, setActiveId] = useState(null); // superficie seleccionada en la lista: el próximo color es para ella
  const [mode, setMode] = useState('pos'); // 'pos' es pared · 'neg' no es pared · 'brush' pincel · 'erase' borrador · 'pan' mover
  const [radius, setRadius] = useState(16); // radio del pincel en píxeles de PANTALLA
  const [zoom, setZoom] = useState(1);
  const [tol, setTol] = useState(8); // tolerancia de la varita (diferencia de color)
  const [recta, setRecta] = useState(false); // pincel/borrador en línea recta (de donde apoyás a donde soltás)
  const [, setTick] = useState(0); // fuerza re-render cuando cambian refs que la interfaz lee (trazos, deshacer)
  const bump = () => setTick((t) => t + 1);
  const [color, setColor] = useState(null);
  const [lum, setLum] = useState('luz'); // 'luz': el sombreado de la foto se conserva (sombra queda sombra) y el balance de blancos va al 50 % (medido contra Sinteplast: ΔE00 8,5 → 6,0)
  const [intensity, setIntensity] = useState(1);
  const [wb, setWb] = useState(true);
  const [timing, setTiming] = useState({});
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [wallPx, setWallPx] = useState(0); // píxeles de pared marcados (confirmados + selección en curso)
  const [calib, setCalib] = useState({ tapping: false, pxPerM: null });
  const [cutMode, setCutMode] = useState(false); // "Sacar un objeto": el próximo toque recorta lo que quedó pintado y no es pared
  const [photoId, setPhotoId] = useState(0); // cambia con cada foto: reinicia la calculadora (m² a mano, sumar/restar) para que no arrastre datos de la anterior
  const [prog, setProg] = useState(null); // progreso del análisis: { stage: 'wait'|'embed'|'detect', n, t0 (inicio de la etapa), tAll } · null = no se está analizando
  const stageRef = useRef(null);
  const [now, setNow] = useState(0); // reloj que se actualiza mientras se analiza (tiempo transcurrido / estimado)
  const [manual, setManual] = useState(false); // herramientas manuales (clics de SAM, pincel, borrador): opcionales, la detección es automática

  const calibRef = useRef({ tapping: false, pts: [], pxPerM: null, meters: 0 }); // línea de referencia (coords de la foto)
  const canvasRef = useRef(null);
  const sam = useRef(null);
  const ready = useRef(null); // promesa de carga del modelo
  const photo = useRef(null); // { data, width, height } foto de trabajo
  const gains = useRef([1, 1, 1]);
  const current = useRef(null); // máscara de la selección en curso (Uint8Array)
  const surfaces = useRef([]); // superficies confirmadas: {id, name, mask, color}; cada una con su propio color
  const surfSeq = useRef(0);
  const activeRef = useRef(null); // espejo de activeId para render()
  const flash = useRef(null); // superficie que parpadea un instante al seleccionarla
  const [detMode, setDetMode] = useState('interior'); // qué detector produjo la lista: 'interior' | 'fachada'
  const autoCache = useRef([]); // superficies detectadas solas (para volver a empezar sin recalcular)
  const photoName = useRef('foto');
  const photoSeq = useRef(0); // identifica la foto en análisis: si cambia mientras tanto, se descarta el resultado
  const result = useRef(null); // imagen recoloreada
  const showBefore = useRef(false);
  const colorRef = useRef(null); // color elegido, legible desde render() sin quedar "viejo" en una clausura
  // pincel / borrador
  const samMask = useRef(null); // máscara de SAM (ya limpia) de la selección en curso; current = samMask + strokes
  const strokes = useRef([]); // trazos de la selección en curso: { erase, r (px de imagen), pts }
  const surfUndo = useRef([]); // snapshots de máscaras de superficies, para deshacer trazos sobre ellas
  const stroke = useRef(null); // trazo en vivo
  const rafId = useRef(0);
  // zoom / desplazamiento
  const viewportRef = useRef(null);
  const ringRef = useRef(null);
  const view = useRef({ s: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map()); // pointerId -> {x, y} en coordenadas de pantalla
  const gesture = useRef(null);
  const suppressClick = useRef(false); // ignora el click que el navegador manda después de un arrastre/trazo/pellizco

  // ---- carga inicial: datos de la pinturería y modelo ----
  useEffect(() => {
    getJson('tenant').then(setTenant).catch(() => {});
    getJson('colors').then(setColors).catch(() => {});
    getJson('products').then(setProducts).catch(() => {});
    getJson('branches').then(setBranches).catch(() => {});
    sam.current = new SamClient(({ loaded, total }) => setModel((m) => ({ ...m, loaded, total })));
    ready.current = sam.current.init().then((r) => {
      setModel((m) => ({ ...m, state: 'ready', initMs: r.initMs, info: `${r.threads} hilo(s), init ${r.initMs} ms` }));
    }).catch((e) => setModel({ state: 'error', loaded: 0, total: 0, info: e.message }));
    return () => sam.current?.terminate();
  }, []);

  // Mientras se analiza, el reloj de la pantalla de progreso avanza solo (no depende de que el análisis avise).
  useEffect(() => {
    if (!prog) return undefined;
    setNow(Date.now());
    stageRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); // la foto y la barra quedan a la vista (en el celular la foto es fija arriba)
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [!!prog]);

  // La superficie seleccionada parpadea un instante (y se queda resaltada mientras no tenga color) para ver cuál es.
  useEffect(() => {
    activeRef.current = activeId;
    if (!activeId) { render(); return undefined; }
    flash.current = activeId; render();
    const t = setTimeout(() => { if (flash.current === activeId) { flash.current = null; render(); } }, 900);
    return () => clearTimeout(t);
  }, [activeId]);

  // Si cambia el ancho (girar el celular, redimensionar la ventana), el desplazamiento se vuelve a acomodar para no dejar bordes vacíos.
  useEffect(() => {
    const onResize = () => applyView();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---- dibujo ----
  const render = () => {
    const c = canvasRef.current, p = photo.current;
    if (!c || !p) return;
    if (c.width !== p.width) { c.width = p.width; c.height = p.height; }
    // Mientras se arrastra un trazo se muestra la foto original con velo azul sobre la máscara que se edita
    // (selección en curso o superficie), así se ve al instante qué se agrega o se saca. Al soltar se recolorea.
    const live = stroke.current?.target ?? null;
    const base = !live && !showBefore.current && result.current ? result.current : p;
    let data = base.data;
    const act = activeRef.current ? surfaces.current.find((x) => x.id === activeRef.current) : null;
    const actVeil = act && !showBefore.current && (!act.color || flash.current === act.id) ? act.mask : null;
    const veil = live ?? actVeil ?? (current.current && !(result.current && !showBefore.current && colorRef.current) ? current.current : null);
    if (veil) {
      // resalta la selección en curso con un velo azul
      data = new Uint8ClampedArray(base.data);
      const m = veil;
      for (let i = 0; i < m.length; i++) if (m[i]) {
        const q = i * 4;
        data[q] = data[q] * 0.55 + 31 * 0.45; data[q + 1] = data[q + 1] * 0.55 + 111 * 0.45; data[q + 2] = data[q + 2] * 0.55 + 235 * 0.45;
      }
    }
    c.getContext('2d').putImageData(new ImageData(data, p.width, p.height), 0, 0);
    // puntos
    const ctx = c.getContext('2d');
    for (const pt of pointsRef.current) {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, Math.max(5, p.width / 120), 0, 7);
      ctx.fillStyle = pt.label ? '#16a34a' : '#dc2626'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    // polígono en curso: línea y vértices (verde = suma, rojo = quita)
    const pp = polyRef.current;
    if (pp.length) {
      const col = mode === 'polyx' ? '#dc2626' : '#16a34a', r = Math.max(4, p.width / 160);
      ctx.beginPath(); pp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      if (pp.length > 2) ctx.closePath();
      ctx.lineWidth = Math.max(2, p.width / 450); ctx.strokeStyle = col; ctx.stroke();
      for (const q of pp) { ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    }
    // línea de referencia de la calibración (ámbar)
    const cp = calibRef.current.pts;
    if (cp.length) {
      const r = Math.max(6, p.width / 110);
      if (cp.length === 2) {
        ctx.beginPath(); ctx.moveTo(cp[0].x, cp[0].y); ctx.lineTo(cp[1].x, cp[1].y);
        ctx.lineWidth = Math.max(3, p.width / 300); ctx.strokeStyle = '#f59e0b'; ctx.stroke();
      }
      for (const pt of cp) {
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, 7);
        ctx.fillStyle = '#f59e0b'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
    }
  };
  const pointsRef = useRef([]);
  const polyRef = useRef([]); // vértices del polígono en curso (coordenadas de la foto)

  const repaint = (col = color, opts = {}) => {
    const p = photo.current;
    if (!p) return;
    const cur = current.current;
    setWallPx(wallPixels([...surfaces.current.filter((s) => s.color || !s.auto).map((s) => s.mask), ...(cur ? [cur] : [])])); // las detectadas solas cuentan recién cuando tienen color
    // Capas a pintar, en orden: cada superficie confirmada con SU color + la selección en curso con el color elegido.
    const layers = surfaces.current.filter((s) => s.color).map((s) => ({ mask: s.mask, hex: s.color.hex }));
    if (cur && colorRef.current) layers.push({ mask: cur, hex: colorRef.current.hex });
    if (!layers.length) { result.current = null; render(); return; }
    const t0 = performance.now();
    let image = p;
    for (const L of layers) {
      const soft = featherMask(Float32Array.from(L.mask), p.width, p.height, Math.max(1, Math.round(p.width / 500)));
      image = recolorWall(image, soft, L.hex, {
        mode: opts.lum ?? lum, intensity: opts.intensity ?? intensity, gains: (opts.wb ?? wb) ? ((opts.lum ?? lum) === 'luz' ? gains.current.map((g) => 1 + (g - 1) * LUZ_WB_STRENGTH) : gains.current) : [1, 1, 1],
      }).image;
    }
    result.current = image;
    setTiming((t) => ({ ...t, recolorMs: Math.round(performance.now() - t0) }));
    render();
  };

  // ---- foto ----
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    photoName.current = file.name.replace(/\.\w+$/, '');
    try {
      setStatus('Leyendo la foto…');
      const bmp = await createImageBitmap(file); // respeta la orientación EXIF
      const { width, height } = workingSize(bmp.width, bmp.height);
      const cv = new OffscreenCanvas(width, height);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, width, height);
      bmp.close?.();
      const img = ctx.getImageData(0, 0, width, height);
      photo.current = { data: img.data, width, height };
      setAspect(width / height);
      gains.current = estimateWhiteBalance(photo.current);
      const mySeq = ++photoSeq.current;
      sam.current?.cancelDetect(); // si la foto anterior todavía se estaba analizando, se corta
      current.current = null; surfaces.current = []; surfSeq.current = 0; result.current = null; pointsRef.current = []; autoCache.current = []; activeRef.current = null; flash.current = null; setManual(false); setCutMode(false);
      samMask.current = null; strokes.current = []; surfUndo.current = []; stroke.current = null; gesture.current = null; pointers.current.clear();
      view.current = { s: 1, tx: 0, ty: 0 }; applyView();
      calibRef.current = { tapping: false, pts: [], pxPerM: null, meters: 0 }; setCalib({ tapping: false, pxPerM: null }); setWallPx(0);
      colorRef.current = null; setColor(null); setPhotoId(mySeq); // el color de la foto anterior no se arrastra (habilitaba Descargar sin nada pintado)
      setPoints([]); setSurfList([]); setActiveId(null); setHasPhoto(true); render();

      setStatus(model.state === 'ready' ? 'Analizando la foto…' : 'Esperando que cargue el modelo…');
      const tAll = Date.now();
      setProg({ stage: model.state === 'ready' ? 'embed' : 'wait', n: 0, t0: tAll, tAll });
      await ready.current;
      if (mySeq !== photoSeq.current) return;
      setStatus('Analizando la foto…');
      setProg({ stage: 'embed', n: 0, t0: Date.now(), tAll });
      await yieldToUi(); // que se pinte la etapa antes de empezar el cálculo pesado
      const r = await sam.current.embed(img.data.slice().buffer, width, height);
      setTiming((t) => ({ ...t, embedMs: r.embedMs }));
      if (mySeq !== photoSeq.current) return;
      setStatus('Buscando paredes y techo…');
      const t1 = performance.now();
      setProg({ stage: 'detect', n: 0, t0: Date.now(), tAll });
      // La detección corre en el Worker de SAM: la pantalla sigue respondiendo (antes se congelaba ~1 min). Solo llega el progreso y el resultado.
      sam.current.onDetectProgress = (n) => { if (mySeq === photoSeq.current) setProg((q) => (q && q.stage === 'detect' ? { ...q, n } : q)); };
      const { found, mode: usedMode } = await sam.current.detect(); // 'auto': interior y, si no encuentra nada, fachada
      if (mySeq !== photoSeq.current) return; // mientras tanto eligió otra foto
      setProg(null); setDetMode(usedMode ?? 'interior');
      setTiming((t) => ({ ...t, detectMs: Math.round(performance.now() - t1) }));
      autoCache.current = found.map((f) => ({ name: f.name, kind: f.kind, area: f.area, mask: f.mask }));
      applyAuto(null, '', usedMode);
    } catch (err) {
      if (mySeqOf(err)) return; // la foto fue reemplazada por otra: la pantalla ya muestra el análisis nuevo
      setProg(null);
      setStatus(`No se pudo procesar la foto: ${err.message}`);
    }
  };
  const mySeqOf = (err) => err?.message === 'foto reemplazada' || err?.message === 'cancelado'; // 'cancelado' = el Worker cortó la detección de una foto anterior

  // Carga en la lista las superficies detectadas solas; la pared más grande queda seleccionada: elegir un color ya la pinta.
  // `keep`: colores a conservar por índice de la detección (al "Volver a lo detectado" no se pierde lo ya pintado).
  const applyAuto = (keep = null, note = '', mode = detMode) => {
    const found = autoCache.current;
    surfaces.current = found.map((f, i) => ({ id: ++surfSeq.current, name: f.name, kind: f.kind, auto: true, autoIdx: i, mask: f.mask.slice(), color: keep?.get(i) ?? null }));
    syncSurfaces();
    // Balance de blancos con política: si la pared detectada ya tiene color (se separa del resto de la foto), no se la usa para estimar la luz.
    const paredes = found.filter((f) => f.kind === 'pared').map((f) => f.mask);
    if (paredes.length) { const wbp = whiteBalanceFor(photo.current, paredes); gains.current = wbp.gains; console.debug("[wb]", JSON.stringify({ excluido: wbp.excluded, gains: wbp.gains.map((g) => +g.toFixed(2)), dist: wbp.stats?.dist, croma: wbp.stats?.wall.C })); }
    const first = surfaces.current.filter((x) => x.kind === 'pared').sort((a, b) => maskCount(b.mask) - maskCount(a.mask))[0] ?? null; // el ladrillo/rugoso nunca queda elegido solo
    if (first && !first.color && colorRef.current) { first.color = colorRef.current; colorRef.current = null; syncSurfaces(); } // ya había elegido un color mientras se analizaba
    setActiveId(first?.id ?? null);
    const fach = mode === 'fachada', n = found.length;
    setStatus(note || (!n
      ? (fach ? 'No pude separar paños de pared en la fachada. Tocá "Ajustar a mano" y marcá la pared.' : 'No pude detectar paredes solas. Tocá "Ajustar a mano" y marcá una pared.')
      : first
        ? `Listo: detecté ${n} ${n === 1 ? 'superficie' : 'superficies'}${fach ? ' en la fachada (sin cielo, piso ni aberturas)' : ''}. Elegí un color para "${first.name}"; para pintar otra, tocala en la foto o en la lista.${found.some((f) => f.kind === 'ladrillo') ? ' El ladrillo o revoque rugoso queda sin color: tocalo si querés pintarlo.' : ''}`
        : 'Detecté solo superficies rugosas (ladrillo o similar), que quedan sin color. Tocá la que quieras pintar en la foto o en la lista.'));
    repaint();
  };

  // Vuelve a detectar con el otro detector (fachada <-> interior) sobre la misma foto ya analizada: no repite el análisis de SAM, solo la detección.
  // Modo de recolección (solo con ?dataset=1): descarga a ESTA computadora la foto y las máscaras tal como quedaron después de corregir (0 otro, 1 pared, 2 techo, 255 ignorar).
  // Nada se sube a ningún servidor: sirve para armar ejemplos de entrenamiento con fotos propias o de gente que lo autorizó.
  const exportDataset = async () => {
    const p = photo.current;
    if (!p) return;
    const base = 'foto-' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const draw = (rgba) => { const c = document.createElement('canvas'); c.width = p.width; c.height = p.height; c.getContext('2d').putImageData(new ImageData(rgba, p.width, p.height), 0, 0); return c; };
    const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
    // Niveles bien separados (0 otro, 80 pared, 160 techo, 240 ignorar): sobreviven a una recompresión (WhatsApp, etc.); agregar_propias.py usa el nivel más cercano.
    const lab = new Uint8ClampedArray(p.width * p.height * 4);
    for (let i = 0; i < p.width * p.height; i++) lab[i * 4 + 3] = 255;
    const tipo = (sf) => sf.kind ?? (/^techo/i.test(sf.name) ? 'techo' : 'pared');
    const pint = (mask, v) => { for (let i = 0; i < mask.length; i++) if (mask[i]) { lab[i * 4] = lab[i * 4 + 1] = lab[i * 4 + 2] = v; } };
    if (current.current) pint(current.current, 80); // selección todavía sin confirmar: cuenta como pared
    for (const sf of surfaces.current) if (tipo(sf) !== 'objeto') pint(sf.mask, tipo(sf) === 'techo' ? 160 : tipo(sf) === 'ladrillo' ? 240 : 80);
    for (const sf of surfaces.current) if (tipo(sf) === 'objeto') pint(sf.mask, 0); // "No pintar": quedan como otro aunque se solapen con una pared
    const files = [
      new File([await toBlob(draw(new Uint8ClampedArray(p.data)), 'image/jpeg', 0.93)], base + '.jpg', { type: 'image/jpeg' }),
      new File([await toBlob(draw(lab), 'image/png')], base + '.labels.png', { type: 'image/png' }),
    ];
    // En el celular: menú Compartir con los DOS archivos (elegí Drive y la carpeta). Si el navegador no puede, se descargan los dos.
    if (navigator.canShare?.({ files })) {
      try { await navigator.share({ files, title: 'Foto y máscaras para entrenamiento' }); setStatus('Compartido: ' + base); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    files.forEach((f, k) => setTimeout(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, k * 400));
    setStatus('Guardé ' + base + '.jpg y ' + base + '.labels.png en la carpeta de descargas.');
  };
  const redetect = async (m) => {
    if (!sam.current || !photo.current || prog) return;
    if (surfaces.current.some((x) => x.color) && typeof confirm === 'function' && !confirm('Detectar de nuevo descarta lo que ya pintaste. ¿Seguimos?')) return;
    const mySeq = photoSeq.current, t1 = performance.now(), tAll = Date.now();
    setStatus(m === 'fachada' ? 'Buscando paños de la fachada…' : 'Buscando paredes y techo…');
    setProg({ stage: 'detect', n: 0, t0: tAll, tAll });
    sam.current.onDetectProgress = (n) => { if (mySeq === photoSeq.current) setProg((q) => (q && q.stage === 'detect' ? { ...q, n } : q)); };
    try {
      await yieldToUi();
      const { found, mode: used } = await sam.current.detect(m);
      if (mySeq !== photoSeq.current) return;
      setProg(null); setDetMode(used);
      setTiming((t) => ({ ...t, detectMs: Math.round(performance.now() - t1) }));
      autoCache.current = found.map((f) => ({ name: f.name, kind: f.kind, area: f.area, mask: f.mask }));
      applyAuto(null, '', used);
    } catch (err) {
      if (mySeqOf(err)) return;
      setProg(null); setStatus(`No se pudo detectar: ${err.message}`);
    }
  };

  // "Sacar un objeto" (un solo toque, solo cuando hay un error): SAM recorta bien un objeto cuando se le da un punto sobre él, aunque sea del color de
  // la pared (una tabla blanca, un mueble claro). La detección automática no puede adivinarlo; el cliente lo señala con un toque.
  const cutObject = async (pt) => {
    const p = photo.current;
    const i = Math.floor(pt.y) * p.width + Math.floor(pt.x);
    const hit = surfaces.current.find((x) => x.mask[i]);
    if (!hit) { setStatus('Tocá algo que esté pintado (o resaltado) y no sea pared.'); return; }
    if (model.state !== 'ready') return;
    setStatus('Separando el objeto…');
    try {
      const r = await sam.current.segment([{ x: pt.x, y: pt.y, label: 1 }], true);
      await sam.current.call('reset');
      const m = cleanMask(r.mask, p.width, p.height);
      const cut = cutObjectFromSurface(hit.mask, m);
      if (!cut.ok) {
        setStatus(cut.reason === 'too-big'
          ? `No pude separarlo de "${hit.name}": la selección salió demasiado grande. Probá en "Ajustar a mano" con el borrador.`
          : 'No pude separar ese objeto. Probá en "Ajustar a mano" con el borrador.');
        return;
      }
      surfUndo.current.push({ id: hit.id, mask: hit.mask.slice() });
      if (surfUndo.current.length > MAX_SURF_UNDO) surfUndo.current.shift();
      hit.mask = cut.mask;
      setCutMode(false);
      // Sin color no se ve ningún cambio: se resalta la superficie (queda con el velo azul) y se avisa que el efecto se ve al pintarla.
      if (!hit.color) setActiveId(hit.id);
      repaint(); bump();
      setStatus(hit.color
        ? `Listo: saqué ese objeto de "${hit.name}". Si no era eso, tocá Deshacer.`
        : `Saqué ese objeto de "${hit.name}": en azul ves lo que quedó como superficie (el objeto ya no está). Todavía no tiene color, así que elegí uno para ver el resultado. Si no era eso, tocá Deshacer.`);
    } catch (err) { setStatus(`Error: ${err.message}`); }
  };
  const undoCut = () => {
    const u = surfUndo.current.pop();
    if (!u) return;
    const sf = surfaces.current.find((x) => x.id === u.id);
    if (sf) sf.mask = u.mask;
    repaint(); bump(); setStatus('Deshecho.');
  };

  // ---- selección ----
  // Máscara de la selección en curso = copia de la de SAM (o vacía) + los trazos repetidos en orden.
  const compose = () => {
    const p = photo.current;
    const m = samMask.current ? samMask.current.slice() : new Uint8Array(p.width * p.height);
    for (const s of strokes.current) {
      if (s.mask) { for (let i = 0; i < m.length; i++) if (s.mask[i]) m[i] = s.erase ? 0 : 1; } // toque de la varita
      else paintStroke(m, p.width, p.height, s.pts, s.r, s.erase ? 0 : 1);
    }
    return m;
  };
  const recompose = () => (samMask.current || strokes.current.length ? compose() : null);
  const runSegment = async (pts, fresh) => {
    setStatus('Detectando pared…');
    const r = await sam.current.segment(pts, fresh);
    const p = photo.current;
    samMask.current = cleanMask(r.mask, p.width, p.height);
    current.current = compose(); // los trazos de pincel/borrador se vuelven a aplicar encima del resultado nuevo de SAM
    pointsRef.current = pts; setPoints(pts);
    setTiming((t) => ({ ...t, segMs: r.ms }));
    setStatus('Si falta o sobra algo, tocá de nuevo (verde = es pared, rojo = no es pared).');
    repaint();
  };
  // ---- calibración de escala ----
  const startCalib = (meters) => {
    calibRef.current = { tapping: true, pts: [], pxPerM: null, meters };
    setCalib({ tapping: true, pxPerM: null });
    setStatus('Calibrando: tocá los dos extremos de la medida (ej: arriba y abajo del marco de la puerta).');
    render();
  };
  const resetCalib = () => {
    calibRef.current = { tapping: false, pts: [], pxPerM: null, meters: 0 };
    setCalib({ tapping: false, pxPerM: null });
    render();
  };
  const calibClick = (pt) => {
    const c = calibRef.current;
    c.pts.push({ x: pt.x, y: pt.y });
    if (c.pts.length === 2) {
      try {
        c.pxPerM = pxPerMeter(c.pts[0], c.pts[1], c.meters);
        c.tapping = false;
        setCalib({ tapping: false, pxPerM: c.pxPerM });
        setStatus('Escala lista. Si la foto está muy de costado, la estimación pierde precisión.');
      } catch (err) {
        c.pts = [];
        setStatus(`${err.message}. Probá de nuevo.`);
      }
    }
    render();
  };

  // Pasa un punto de pantalla (clientX/Y) a coordenadas de la foto. getBoundingClientRect() ya incluye el zoom y el desplazamiento
  // (el CSS transform), así que el mapeo sigue valiendo con la foto ampliada: el toque cae donde se toca.
  const toImg = (clientX, clientY) => {
    const p = photo.current, rect = canvasRef.current.getBoundingClientRect();
    return { x: ((clientX - rect.left) * p.width) / rect.width, y: ((clientY - rect.top) * p.height) / rect.height };
  };

  // Aplica una máscara (de la varita o de un polígono) a la superficie elegida o a la selección nueva: suma o quita. Se puede deshacer.
  const aplicarMascara = (m, quitar, que) => {
    let n = 0; for (let i = 0; i < m.length; i++) n += m[i];
    const surf = activeId ? surfaces.current.find((x) => x.id === activeId) : null;
    if (surf) {
      surfUndo.current.push({ id: surf.id, mask: surf.mask.slice() });
      if (surfUndo.current.length > MAX_SURF_UNDO) surfUndo.current.shift();
      for (let i = 0; i < m.length; i++) if (m[i]) surf.mask[i] = quitar ? 0 : 1;
    } else {
      strokes.current.push({ mask: m, erase: quitar });
      current.current = compose();
    }
    repaint(); bump();
    setStatus(`${que}: ${quitar ? 'quité' : 'sumé'} ${(100 * n / m.length).toFixed(1)} % de la foto. Si no era eso, tocá Deshacer.`);
  };
  // Varita: un toque toma toda la zona de color parecido (tolerando el degradado de la luz).
  const aplicarVarita = (pt) => {
    aplicarMascara(varita(photo.current, pt.x, pt.y, { tol }), mode === 'wandx', 'Varita');
  };
  // Polígono: se tocan los vértices (con zoom, en las esquinas) y se cierra; sirve para marcos, ventanas y bordes rectos.
  const aplicarPoligono = () => {
    const pts = polyRef.current, p = photo.current;
    if (pts.length < 3) { setStatus('Marcá al menos 3 puntos para cerrar el polígono.'); return; }
    const cv = document.createElement('canvas'); cv.width = p.width; cv.height = p.height;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.beginPath();
    pts.forEach((q, i) => (i ? cx.lineTo(q.x, q.y) : cx.moveTo(q.x, q.y)));
    cx.closePath(); cx.fill();
    const al = cx.getImageData(0, 0, p.width, p.height).data, m = new Uint8Array(p.width * p.height);
    for (let i = 0; i < m.length; i++) m[i] = al[i * 4 + 3] > 127 ? 1 : 0;
    polyRef.current = [];
    aplicarMascara(m, mode === 'polyx', 'Polígono');
  };
  const cancelarPoligono = () => { polyRef.current = []; render(); bump(); setStatus('Polígono cancelado.'); };
  const quitarPuntoPoligono = () => { polyRef.current.pop(); render(); bump(); };

  const onCanvasClick = async (e) => {
    if (suppressClick.current) { suppressClick.current = false; return; } // era el final de un arrastre, trazo o pellizco
    const p = photo.current;
    if (!p) return;
    const pt = { ...toImg(e.clientX, e.clientY), label: mode === 'neg' ? 0 : 1 };
    if (calibRef.current.tapping) return calibClick(pt);
    if (cutMode && !manual) return cutObject(pt);
    if (!manual) { // modo automático: un toque elige la superficie detectada que está debajo (sin volver a segmentar)
      const x = Math.floor(pt.x), y = Math.floor(pt.y), i = y * p.width + x;
      const hit = surfaces.current.find((s) => s.mask[i]);
      if (hit) { setActiveId(hit.id); setStatus(`"${hit.name}" seleccionada: elegí su color.`); }
      else setStatus('Ahí no detecté una superficie. Si falta una pared, usá "Ajustar a mano".');
      return;
    }
    if (mode === 'wand' || mode === 'wandx') return aplicarVarita(pt);
    if (mode === 'poly' || mode === 'polyx') { polyRef.current.push({ x: pt.x, y: pt.y }); render(); bump(); setStatus(`Polígono: ${polyRef.current.length} ${polyRef.current.length === 1 ? 'punto' : 'puntos'}. Seguí tocando las esquinas y después tocá "Cerrar y aplicar".`); return; }
    if (mode !== 'pos' && mode !== 'neg') return; // pincel, borrador y mover no marcan puntos de SAM
    if (model.state !== 'ready') return;
    try { await runSegment([...pointsRef.current, pt], pointsRef.current.length === 0); }
    catch (err) { setStatus(`Error: ${err.message}`); }
  };

  // Deshacer unificado: con una superficie seleccionada en la lista deshace sus trazos; si no, el último trazo de la
  // selección en curso; si no, el último punto de SAM.
  const canUndo = polyRef.current.length > 0 || (activeId ? surfUndo.current.some((u) => u.id === activeId) : strokes.current.length > 0 || points.length > 0);
  const undo = async () => {
    if (polyRef.current.length) { quitarPuntoPoligono(); return; }
    if (activeId) {
      const i = surfUndo.current.map((u) => u.id).lastIndexOf(activeId);
      if (i < 0) return;
      const [snap] = surfUndo.current.splice(i, 1);
      const s = surfaces.current.find((x) => x.id === activeId);
      if (s) s.mask = snap.mask;
      repaint(); bump();
      return;
    }
    if (strokes.current.length) {
      strokes.current.pop();
      current.current = recompose();
      repaint(); bump();
      return;
    }
    const pts = pointsRef.current.slice(0, -1);
    if (!pts.length) { current.current = null; samMask.current = null; pointsRef.current = []; setPoints([]); await sam.current.call('reset'); repaint(); return; }
    await runSegment(pts, true);
  };

  // ---- pincel y borrador ----
  const startStroke = (e) => {
    const p = photo.current, rect = canvasRef.current.getBoundingClientRect();
    const rImg = radius * (p.width / rect.width); // radio en pantalla -> en píxeles de la foto: con más zoom, más preciso
    const surf = activeId ? surfaces.current.find((s) => s.id === activeId) : null;
    let target;
    if (surf) {
      target = surf.mask;
      surfUndo.current.push({ id: surf.id, mask: target.slice() });
      if (surfUndo.current.length > MAX_SURF_UNDO) surfUndo.current.shift();
    } else {
      if (!current.current) current.current = new Uint8Array(p.width * p.height);
      target = current.current;
    }
    const pt = toImg(e.clientX, e.clientY);
    stroke.current = { erase: mode === 'erase', r: rImg, pts: [pt], target, surfId: surf?.id ?? null, base: target.slice(), straight: recta };
    paintStroke(target, p.width, p.height, [pt], rImg, stroke.current.erase ? 0 : 1);
    scheduleRender();
  };
  const extendStroke = (e) => {
    const s = stroke.current, p = photo.current;
    if (!s) return;
    if (s.straight) { // recta: se vuelve a la base y se dibuja una línea del punto donde apoyaste al punto actual
      const pt = toImg(e.clientX, e.clientY);
      s.target.set(s.base);
      s.pts = [s.pts[0], pt];
      paintStroke(s.target, p.width, p.height, s.pts, s.r, s.erase ? 0 : 1);
      scheduleRender();
      return;
    }
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const pt = toImg(ev.clientX, ev.clientY), last = s.pts[s.pts.length - 1];
      s.pts.push(pt);
      paintStroke(s.target, p.width, p.height, [last, pt], s.r, s.erase ? 0 : 1);
    }
    scheduleRender();
  };
  const endStroke = () => {
    const s = stroke.current;
    stroke.current = null;
    if (!s) return;
    if (!s.surfId) strokes.current.push({ erase: s.erase, r: s.r, pts: s.pts }); // ya está pintado en current: no hace falta recomponer
    repaint(); bump();
  };
  const discardStroke = () => { // un segundo dedo apoyado: era un pellizco, no un trazo
    const s = stroke.current;
    stroke.current = null;
    if (!s) return;
    if (s.surfId) { s.target.set(s.base); surfUndo.current.pop(); } else current.current = recompose();
    render();
  };
  const scheduleRender = () => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => { rafId.current = 0; render(); });
  };

  // ---- zoom y desplazamiento ----
  const applyView = () => {
    const v = view.current, vp = viewportRef.current, c = canvasRef.current;
    const box = vp?.getBoundingClientRect(); // el viewport no se transforma; getBoundingClientRect da el alto fraccionario (clientHeight redondea)
    const w = box?.width ?? 0, h = box?.height ?? 0;
    v.s = clamp(v.s, 1, MAX_ZOOM);
    v.tx = clamp(v.tx, w - w * v.s, 0); // el canvas (w×h sin transformar) siempre tapa el viewport
    v.ty = clamp(v.ty, h - h * v.s, 0);
    if (c) c.style.transform = viewTransform(v);
    setZoom(v.s);
  };
  const zoomAt = (factor, cx, cy) => { // (cx, cy) en coordenadas del viewport: ese punto de la foto queda quieto
    const v = view.current, s2 = clamp(v.s * factor, 1, MAX_ZOOM), k = s2 / v.s;
    v.tx = cx - (cx - v.tx) * k; v.ty = cy - (cy - v.ty) * k; v.s = s2;
    applyView();
  };
  const zoomCenter = (factor) => { const r = viewportRef.current.getBoundingClientRect(); zoomAt(factor, r.width / 2, r.height / 2); };
  const fitView = () => { view.current = { s: 1, tx: 0, ty: 0 }; applyView(); };
  const vpPoint = (clientX, clientY) => { const r = viewportRef.current.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top }; };

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // sin ctrl/⌘ la rueda sigue scrolleando la página (el pellizco del trackpad llega como ctrl+rueda)
    e.preventDefault();
    const { x, y } = vpPoint(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * 0.0025), x, y);
  };

  const holdPointer = (e) => { try { canvasRef.current.setPointerCapture(e.pointerId); } catch { /* ya no está activo */ } };
  const onPointerDown = (e) => {
    if (!photo.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const ps = pointers.current;
    if (ps.size === 0) { suppressClick.current = false; gesture.current = null; }
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ps.size === 2) { // pellizco: zoom alrededor del punto medio + desplazamiento
      if (stroke.current) discardStroke();
      const [a, b] = [...ps.values()], v = view.current;
      const mid = vpPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: v.s, ax: (mid.x - v.tx) / v.s, ay: (mid.y - v.ty) / v.s };
      for (const id of ps.keys()) try { canvasRef.current.setPointerCapture(id); } catch { /* ignorar */ }
      suppressClick.current = true;
    } else if (ps.size === 1) {
      if ((mode === 'brush' || mode === 'erase') && !calibRef.current.tapping) {
        holdPointer(e); suppressClick.current = true;
        gesture.current = { type: 'stroke' };
        startStroke(e);
      } else if (mode === 'pan' || view.current.s > 1) {
        // Todavía puede ser un toque (click): recién es arrastre cuando se movió DRAG_PX. Sin captura hasta entonces.
        gesture.current = { type: 'panwait', x: e.clientX, y: e.clientY, tx0: view.current.tx, ty0: view.current.ty };
      }
    }
  };
  const onPointerMove = (e) => {
    if (ringRef.current && e.pointerType !== 'touch') { // aro del pincel que sigue al mouse
      const { x, y } = vpPoint(e.clientX, e.clientY);
      ringRef.current.style.transform = `translate(${x - radius}px, ${y - radius}px)`;
      ringRef.current.style.opacity = '1';
    }
    const ps = pointers.current, g = gesture.current;
    if (!ps.has(e.pointerId) || !g) return;
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = view.current;
    if (g.type === 'stroke') extendStroke(e);
    else if (g.type === 'pinch' && ps.size === 2) {
      const [a, b] = [...ps.values()];
      const mid = vpPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      v.s = clamp(g.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0), 1, MAX_ZOOM);
      v.tx = mid.x - g.ax * v.s; v.ty = mid.y - g.ay * v.s; // el punto de la foto que estaba bajo los dedos los sigue
      applyView();
    } else if (g.type === 'panwait' || g.type === 'pan') {
      if (g.type === 'panwait') {
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return;
        g.type = 'pan'; holdPointer(e); suppressClick.current = true;
      }
      v.tx = g.tx0 + (e.clientX - g.x); v.ty = g.ty0 + (e.clientY - g.y);
      applyView();
    }
  };
  const onPointerUp = (e) => {
    const ps = pointers.current, g = gesture.current;
    if (!ps.delete(e.pointerId)) return;
    if (g?.type === 'stroke') { endStroke(); gesture.current = null; }
    else if (g?.type === 'pinch' && ps.size === 1) { // queda un dedo: sigue como desplazamiento
      const [r] = [...ps.values()];
      gesture.current = { type: 'pan', x: r.x, y: r.y, tx0: view.current.tx, ty0: view.current.ty };
    } else if (ps.size === 0) gesture.current = null;
  };
  const onPointerLeave = (e) => { if (ringRef.current && e.pointerType !== 'touch') ringRef.current.style.opacity = '0'; };

  const chooseMode = (m) => {
    if (m !== 'poly' && m !== 'polyx' && polyRef.current.length) { polyRef.current = []; setTimeout(() => render(), 0); }
    setMode(m);
    if (m === 'brush') setStatus('Pincel: pintá lo que falta de la pared. Con dos dedos hacés zoom para más precisión.');
    else if (m === 'erase') setStatus('Borrador: pasalo por lo que sobra de la selección.');
    else if (m === 'wand') setStatus('Varita: tocá una pared y se suma toda la zona de color parecido. Si se pasa o se queda corta, cambiá la tolerancia.');
    else if (m === 'poly' || m === 'polyx') setStatus('Polígono: tocá las esquinas de la zona (conviene ampliar con zoom) y después "Cerrar y aplicar". Con "Último punto" o Deshacer corregís un vértice.');
    else if (m === 'wandx') setStatus('Varita (quitar): tocá algo que sobra y se quita toda la zona de color parecido.');
    else if (m === 'pan') setStatus('Mover: arrastrá la foto. También podés ampliar con − / + o pellizcando.');
  };
  const touchAction = zoom > 1 || mode === 'brush' || mode === 'erase' || mode === 'pan' ? 'none' : 'pan-y'; // pan-y: se puede scrollear la página
  const syncSurfaces = () => setSurfList(surfaces.current.map(({ id, name, kind, color: c }) => ({ id, name, kind, color: c })));
  const setKind = (id, kind) => { const x = surfaces.current.find((q) => q.id === id); if (x) { x.kind = kind; syncSurfaces(); } };
  const commit = async () => {
    const m = current.current, p = photo.current;
    if (!m) return;
    if (!maskCount(m)) { setStatus('La selección quedó vacía: marcá una pared antes de confirmar.'); return; }
    // Nombre sugerido: si la mayor parte de la selección está en el 20 % de arriba de la foto, es el techo.
    let sumY = 0, n = 0;
    for (let i = 0; i < m.length; i += 7) if (m[i]) { sumY += Math.floor(i / p.width); n++; }
    const isCeiling = n > 0 && sumY / n / p.height < 0.2 && !surfaces.current.some((s) => s.name === 'Techo');
    const name = isCeiling ? 'Techo' : `Pared ${surfaces.current.filter((s) => /^Pared/.test(s.name)).length + 1}`;
    surfaces.current.push({ id: ++surfSeq.current, name, kind: isCeiling ? 'techo' : 'pared', mask: m, color: colorRef.current });
    current.current = null; samMask.current = null; strokes.current = []; pointsRef.current = []; setPoints([]); setActiveId(null); syncSurfaces();
    await sam.current.call('reset');
    setStatus(`${name} confirmada. Tocá otra superficie y elegí su color, o tocá una de la lista para cambiarle el color.`);
    repaint();
  };
  const clearAll = async () => {
    // Los colores ya aplicados a superficies detectadas solas se conservan; si hay superficies marcadas a mano con color (esas se pierden), se pide confirmación.
    const painted = surfaces.current.filter((x) => x.color);
    const lost = painted.filter((x) => x.autoIdx == null);
    if (lost.length && typeof confirm === 'function' && !confirm(`Volver a lo detectado descarta ${lost.length === 1 ? 'la superficie que marcaste a mano' : `las ${lost.length} superficies que marcaste a mano`} (${lost.map((x) => x.name).join(', ')}). ¿Seguimos?`)) return;
    const keep = new Map(painted.filter((x) => x.autoIdx != null).map((x) => [x.autoIdx, x.color]));
    current.current = null; samMask.current = null; strokes.current = []; surfUndo.current = [];
    surfaces.current = []; surfSeq.current = 0; result.current = null; pointsRef.current = [];
    setPoints([]); setSurfList([]); setActiveId(null); setWallPx(0); await sam.current.call('reset');
    if (autoCache.current.length) applyAuto(keep, keep.size ? `Volví a lo detectado y conservé el color de ${keep.size === 1 ? '1 superficie' : `${keep.size} superficies`}.` : ''); else render(); // vuelve a las superficies detectadas solas, sin recalcular
  };
  const selectSurface = (id) => {
    setActiveId(activeId === id ? null : id);
    if (activeId !== id) setStatus('Elegí un color: se aplica a la superficie seleccionada.');
  };
  const removeSurface = (id) => {
    surfaces.current = surfaces.current.filter((s) => s.id !== id);
    surfUndo.current = surfUndo.current.filter((u) => u.id !== id);
    if (activeId === id) setActiveId(null);
    syncSurfaces(); setTimeout(() => repaint(), 0);
  };
  const renameSurface = (id, name) => {
    const s = surfaces.current.find((x) => x.id === id);
    if (s) { s.name = name.slice(0, 30); syncSurfaces(); }
  };

  // El color elegido va a la superficie seleccionada en la lista; si no hay, a la selección en curso.
  const pick = (c) => {
    const s = surfaces.current.find((x) => x.id === activeId);
    if (s) { s.color = c; syncSurfaces(); } else colorRef.current = c;
    setColor(c);
    setTimeout(() => repaint(), 0);
  };
  const activeSurface = surfList.find((s) => s.id === activeId) ?? null;
  const hasColor = !!color || surfList.some((s) => s.color);
  // Imagen LIMPIA (sin puntos de selección ni línea de calibración): la recoloreada, o la original si no hay resultado.
  const getImageBlob = () => {
    const img = result.current ?? photo.current;
    const cv = new OffscreenCanvas(img.width, img.height);
    cv.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  };
  const download = async () => {
    const b = await getImageBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'mi-ambiente.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const hold = (v) => () => { showBefore.current = v; render(); };
  // Herramienta interna (?anotar=1): baja las superficies actuales como anotación "revisada" para medir la detección (eval/visualizador/medir.mjs).
  const downloadAnnotation = () => {
    const p = photo.current;
    const out = {
      foto: photoName.current, width: p.width, height: p.height, estado: 'revisada',
      superficies: surfaces.current.map((x) => ({ nombre: x.name, tipo: x.kind ?? (/^techo/i.test(x.name) ? 'techo' : 'pared'), rle: encodeMask(x.mask) })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = `${photoName.current}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const brand = tenant?.primary_color ?? '#1f6feb';
  const pct = model.total ? Math.round((model.loaded / model.total) * 100) : 0;

  return (
    <main class="wrap vis" style={{ '--brand': brand }}>
      <header class="bar">
        <div class="brand">
          {tenant?.logo_url && <img class="logo" src={tenant.logo_url} alt={`Logo de ${tenant.name}`} width="48" height="48" />}
          <h1>{tenant ? tenant.name : 'Visualizador de color'}</h1>
        </div>
      </header>

      {model.state === 'loading' && (
        <div class="card"><strong>Preparando el visualizador…</strong>
          <progress max="100" value={pct} />
          <span class="muted">{model.total ? `${mb(model.loaded)} de ${mb(model.total)} MB (solo la primera vez)` : 'Conectando…'}</span>
        </div>
      )}
      {model.state === 'error' && <p class="err">No se pudo cargar el modelo: {model.info}</p>}

      <div class="card">
        <div class="row">
          <label class="btn primary">📷 Sacar foto<input type="file" accept="image/*" capture="environment" onChange={onFile} hidden /></label>
          <label class="btn">🖼️ Elegir de la galería<input type="file" accept="image/*" onChange={onFile} hidden /></label>
        </div>
        <p class="muted small">🔒 Tu foto se procesa en tu dispositivo y no se sube ni se guarda.</p>
      </div>

      <div class={hasPhoto ? '' : 'hide'}>
        {/* En pantallas chicas la foto queda fija arriba mientras se elige el color (ver .stage en styles.css): sin esto la carta quedaba ~1000 px más abajo y no se veía el resultado. */}
        <div class="pickzone">
        <div ref={stageRef} class={`stage ${prog ? 'busy' : ''}`} style={{ '--aspect': aspect }}>
        <div ref={viewportRef} class="viewport" onWheel={onWheel}>
          <canvas ref={canvasRef} class="photo" style={{ touchAction, transform: viewTransform(view.current), cursor: !manual ? (cutMode ? 'crosshair' : 'pointer') : mode === 'pan' || zoom > 1 && mode !== 'brush' && mode !== 'erase' ? 'grab' : 'crosshair' }}
            onClick={onCanvasClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={onPointerLeave} />
          {manual && (mode === 'brush' || mode === 'erase') && <div ref={ringRef} class="ring" style={{ width: `${radius * 2}px`, height: `${radius * 2}px` }} />}
        </div>
        {prog && <AnalysisProgress prog={prog} now={now} model={model} />}
        </div>
        <div class="row zoombar">
          <button onClick={() => zoomCenter(1 / 1.5)} disabled={zoom <= 1} aria-label="Alejar">−</button>
          <button onClick={() => zoomCenter(1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Acercar">+</button>
          <button onClick={fitView} disabled={zoom === 1}>Ajustar</button>
          <span class="muted small">Zoom {zoom.toFixed(1)}×{zoom === 1 ? ' · pellizcá o ctrl + rueda para ampliar' : ''}</span>
        </div>
        {status && !prog && <p class="muted" role="status">{status}</p>}

        {!manual && surfList.length > 0 && (
          <div class="row">
            <button class={cutMode ? 'on' : ''} onClick={() => { setCutMode(!cutMode); setStatus(cutMode ? 'Tocá una superficie en la foto o en la lista y elegí su color.' : 'Tocá lo que quedó pintado y no es pared (una tabla, un mueble, una puerta).'); }}>✂️ Sacar un objeto</button>
            <button onClick={undoCut} disabled={!surfUndo.current.length}>↩︎ Deshacer</button>
          </div>
        )}
        <div class="row">
          <button class={manual ? 'on' : ''} onClick={() => { setCutMode(false); setManual(!manual); if (!manual) { setMode('pos'); setStatus('Ajuste manual: tocá la foto para marcar una pared (verde = es pared, rojo = no es pared) o usá el pincel y el borrador.'); } else { setMode('pos'); setStatus('Tocá una superficie en la foto o en la lista y elegí su color.'); } }}>
            🛠️ {manual ? 'Listo, volver al modo automático' : 'Ajustar a mano'}
          </button>
        </div>
        {manual && (
          <div class="card manual">
            <div class="row">
              <button class={mode === 'pos' ? 'on' : ''} onClick={() => chooseMode('pos')}>🟢 Es pared</button>
              <button class={mode === 'neg' ? 'on' : ''} onClick={() => chooseMode('neg')}>🔴 No es pared</button>
              <button class={mode === 'brush' ? 'on' : ''} onClick={() => chooseMode('brush')}>🖌️ Pincel</button>
              <button class={mode === 'erase' ? 'on' : ''} onClick={() => chooseMode('erase')}>🧽 Borrador</button>
              <button class={mode === 'wand' ? 'on' : ''} onClick={() => chooseMode('wand')}>🪄 Varita +</button>
              <button class={mode === 'wandx' ? 'on' : ''} onClick={() => chooseMode('wandx')}>🪄 Varita −</button>
              <button class={mode === 'poly' ? 'on' : ''} onClick={() => chooseMode('poly')}>▱ Polígono +</button>
              <button class={mode === 'polyx' ? 'on' : ''} onClick={() => chooseMode('polyx')}>▱ Polígono −</button>
              <button class={mode === 'pan' ? 'on' : ''} onClick={() => chooseMode('pan')}>✋ Mover</button>
            </div>
            {(mode === 'poly' || mode === 'polyx') && (
              <div class="row">
                <button onClick={aplicarPoligono} disabled={polyRef.current.length < 3}>✔︎ Cerrar y aplicar</button>
                <button onClick={quitarPuntoPoligono} disabled={!polyRef.current.length}>↶ Último punto</button>
                <button onClick={cancelarPoligono} disabled={!polyRef.current.length}>✕ Cancelar</button>
              </div>
            )}
            {(mode === 'wand' || mode === 'wandx') && (
              <label class="brushsize">Tolerancia {tol}
                <input type="range" min="3" max="30" step="1" value={tol} onInput={(e) => setTol(Number(e.target.value))} />
              </label>
            )}
            {(mode === 'brush' || mode === 'erase') && (
              <label class="check"><input type="checkbox" checked={recta} onChange={(e) => setRecta(e.target.checked)} /> 📏 Línea recta (apoyá, arrastrá y soltá)</label>
            )}
            {(mode === 'brush' || mode === 'erase') && (
              <label class="brushsize">Tamaño {radius} px
                <input type="range" min="6" max="60" step="1" value={radius} onInput={(e) => setRadius(Number(e.target.value))} />
              </label>
            )}
            <p class="muted small">El pincel y el borrador editan la superficie seleccionada en la lista (o la selección nueva si no hay ninguna).</p>
            <div class="row">
              <button onClick={undo} disabled={!canUndo}>↩︎ Deshacer</button>
              <button onClick={commit} disabled={!current.current}>✔︎ Confirmar superficie nueva</button>
              <button onClick={clearAll}>Volver a lo detectado</button>
            </div>
          </div>
        )}

        {hasPhoto && !prog && (
          <p class="muted small redetect">
            {detMode === 'fachada' ? 'Detecté la foto como fachada.' : '¿La foto es una fachada o el exterior de una casa?'}{' '}
            <button onClick={() => redetect(detMode === 'fachada' ? 'interior' : 'fachada')}>{detMode === 'fachada' ? 'Detectar como interior' : 'Detectar como fachada'}</button>
          </p>
        )}

        {hasPhoto && !prog && new URLSearchParams(location.search).get('dataset') === '1' && (
          <p class="muted small">
            Modo recolección: corregí las superficies con el pincel o el borrador y después{' '}
            <button onClick={exportDataset}>Compartir foto y máscaras (para entrenamiento)</button>
          </p>
        )}

        {surfList.length > 0 && (
          <div class="card surfaces">
            <strong>Superficies</strong>
            {surfList.map((s) => (
              <div key={s.id} class={`surf ${activeId === s.id ? 'on' : ''}`} onClick={() => selectSurface(s.id)}>
                {DATASET && (
                  <select value={s.kind ?? (/^techo/i.test(s.name) ? 'techo' : 'pared')} onClick={(e) => e.stopPropagation()} onChange={(e) => setKind(s.id, e.target.value)} aria-label="Tipo de superficie">
                    <option value="pared">Pared</option>
                    <option value="techo">Techo</option>
                    <option value="objeto">No pintar (objeto)</option>
                    <option value="ladrillo">Rugosa / ladrillo (ignorar)</option>
                  </select>
                )}
                <input class="surfname" value={s.name} onClick={(e) => e.stopPropagation()} onInput={(e) => renameSurface(s.id, e.target.value)} aria-label="Nombre de la superficie" />
                <span class="sw" style={{ background: s.color?.hex ?? '#fff' }} />
                <span class="muted small">{s.color ? s.color.name : 'sin color'}</span>
                <button onClick={(e) => { e.stopPropagation(); removeSurface(s.id); }} aria-label={`Quitar ${s.name}`}>✕</button>
              </div>
            ))}
            <p class="muted small">{activeSurface ? `Elegí un color para "${activeSurface.name}".` : 'Tocá una superficie (en la foto o acá) para elegir su color.'}</p>
          </div>
        )}

        <h3>{activeSurface ? `Color para "${activeSurface.name}"` : 'Elegí un color'}</h3>
        <ColorPicker colors={colors} selected={activeSurface ? activeSurface.color : color} onPick={pick} />
        </div>

        <div class="card grid">
          <label>Luminancia
            <select value={lum} onChange={(e) => { setLum(e.target.value); repaint(color, { lum: e.target.value }); }}>
              <option value="luz">Conserva luz y sombras (recomendada)</option>
              <option value="relative">Relativa</option>
              <option value="pure">Pura (L original)</option>
            </select>
          </label>
          <label>Intensidad {Math.round(intensity * 100)}%
            <input type="range" min="0.2" max="1" step="0.05" value={intensity}
              onInput={(e) => setIntensity(Number(e.target.value))} onChange={(e) => repaint(color, { intensity: Number(e.target.value) })} />
          </label>
          <label class="check"><input type="checkbox" checked={wb} onChange={(e) => { setWb(e.target.checked); repaint(color, { wb: e.target.checked }); }} /> Corregir balance de blancos</label>
          <div class="row">
            <button onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerLeave={hold(false)} disabled={!hasColor}>Mantené para ver el antes</button>
            <button onClick={download} disabled={!hasColor}>⬇︎ Descargar</button>
          </div>
          {ANOTAR && <div class="row"><button onClick={downloadAnnotation} disabled={!surfList.length}>🧪 Descargar anotación (JSON)</button></div>}
        </div>

        <Calculator key={photoId} wallPx={wallPx} calib={calib} products={products} branches={branches} tenant={tenant} color={color} getImageBlob={getImageBlob}
          surfaceColors={surfList.filter((s) => s.color).map((s) => ({ surface: s.name, name: s.color.name, code: s.color.code }))}
          onStartCalib={startCalib} onResetCalib={resetCalib} />

        <p class="warn">⚠️ El color en pantalla puede diferir del color real de la pintura (depende de tu pantalla, la luz de la foto y la textura de la pared). Pedí una muestra antes de comprar.</p>
        <p class="muted small">
          Modelo: {model.info || '—'}{timing.embedMs ? ` · análisis ${timing.embedMs} ms` : ''}{timing.detectMs ? ` · detección ${timing.detectMs} ms` : ''}{timing.segMs ? ` · segmentación ${timing.segMs} ms` : ''}{timing.recolorMs ? ` · recoloreo ${timing.recolorMs} ms` : ''}
        </p>
      </div>
    </main>
  );
}
