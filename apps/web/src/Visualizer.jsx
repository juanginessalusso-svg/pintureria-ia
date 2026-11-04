import { useEffect, useRef, useState } from 'preact/hooks';
import { estimateWhiteBalance, featherMask, recolorWall, cleanMask, unionMasks, pxPerMeter, wallPixels } from '@pintureria/core';
import { SamClient } from './samClient.js';
import { workingSize } from './sam.js';
import { Calculator } from './Calculator.jsx';
import { ColorPicker } from './ColorPicker.jsx';

const tenantQ = () => {
  const t = new URLSearchParams(location.search).get('tenant');
  return t ? `?tenant=${encodeURIComponent(t)}` : '';
};
const getJson = (path) => fetch(`/api/public/${path}${tenantQ()}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
const mb = (n) => (n / 1048576).toFixed(0);

export function Visualizer() {
  const [tenant, setTenant] = useState(null);
  const [colors, setColors] = useState([]);
  const [model, setModel] = useState({ state: 'loading', loaded: 0, total: 0, info: '' });
  const [status, setStatus] = useState('');
  const [hasPhoto, setHasPhoto] = useState(false);
  const [points, setPoints] = useState([]);
  const [walls, setWalls] = useState(0);
  const [mode, setMode] = useState(1); // 1 = "es pared", 0 = "no es pared"
  const [color, setColor] = useState(null);
  const [lum, setLum] = useState('relative');
  const [intensity, setIntensity] = useState(1);
  const [wb, setWb] = useState(true);
  const [timing, setTiming] = useState({});
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [wallPx, setWallPx] = useState(0); // píxeles de pared marcados (confirmados + selección en curso)
  const [calib, setCalib] = useState({ tapping: false, pxPerM: null });

  const calibRef = useRef({ tapping: false, pts: [], pxPerM: null, meters: 0 }); // línea de referencia (coords de la foto)
  const canvasRef = useRef(null);
  const sam = useRef(null);
  const ready = useRef(null); // promesa de carga del modelo
  const photo = useRef(null); // { data, width, height } foto de trabajo
  const gains = useRef([1, 1, 1]);
  const current = useRef(null); // máscara de la selección en curso (Uint8Array)
  const committed = useRef([]); // máscaras de paños ya confirmados
  const result = useRef(null); // imagen recoloreada
  const showBefore = useRef(false);
  const colorRef = useRef(null); // color elegido, legible desde render() sin quedar "viejo" en una clausura

  // ---- carga inicial: datos de la pinturería y modelo ----
  useEffect(() => {
    getJson('tenant').then(setTenant).catch(() => {});
    getJson('colors').then(setColors).catch(() => {});
    getJson('products').then(setProducts).catch(() => {});
    getJson('branches').then(setBranches).catch(() => {});
    sam.current = new SamClient(({ loaded, total }) => setModel((m) => ({ ...m, loaded, total })));
    ready.current = sam.current.init().then((r) => {
      setModel((m) => ({ ...m, state: 'ready', info: `${r.threads} hilo(s), init ${r.initMs} ms` }));
    }).catch((e) => setModel({ state: 'error', loaded: 0, total: 0, info: e.message }));
    return () => sam.current?.terminate();
  }, []);

  // ---- dibujo ----
  const render = () => {
    const c = canvasRef.current, p = photo.current;
    if (!c || !p) return;
    if (c.width !== p.width) { c.width = p.width; c.height = p.height; }
    const base = !showBefore.current && result.current ? result.current : p;
    let data = base.data;
    if (current.current && !(result.current && !showBefore.current && colorRef.current)) {
      // resalta la selección en curso con un velo azul
      data = new Uint8ClampedArray(base.data);
      const m = current.current;
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

  const repaint = (col = color, opts = {}) => {
    const p = photo.current;
    if (!p) return;
    const masks = [...committed.current, ...(current.current ? [current.current] : [])];
    setWallPx(wallPixels(masks));
    if (!col || !masks.length) { result.current = null; render(); return; }
    const t0 = performance.now();
    const size = p.width * p.height;
    const union = unionMasks(masks.map((m) => Float32Array.from(m)), size);
    const soft = featherMask(union, p.width, p.height, Math.max(1, Math.round(p.width / 500)));
    const { image } = recolorWall(p, soft, col.hex, {
      mode: opts.lum ?? lum, intensity: opts.intensity ?? intensity, gains: (opts.wb ?? wb) ? gains.current : [1, 1, 1],
    });
    result.current = image;
    setTiming((t) => ({ ...t, recolorMs: Math.round(performance.now() - t0) }));
    render();
  };

  // ---- foto ----
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
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
      gains.current = estimateWhiteBalance(photo.current);
      current.current = null; committed.current = []; result.current = null; pointsRef.current = [];
      calibRef.current = { tapping: false, pts: [], pxPerM: null, meters: 0 }; setCalib({ tapping: false, pxPerM: null }); setWallPx(0);
      setPoints([]); setWalls(0); setHasPhoto(true); render();

      setStatus(model.state === 'ready' ? 'Analizando la foto…' : 'Esperando que cargue el modelo…');
      await ready.current;
      setStatus('Analizando la foto…');
      const r = await sam.current.embed(img.data.slice().buffer, width, height);
      setTiming((t) => ({ ...t, embedMs: r.embedMs }));
      setStatus('Listo: tocá una pared.');
    } catch (err) {
      setStatus(`No se pudo procesar la foto: ${err.message}`);
    }
  };

  // ---- selección ----
  const runSegment = async (pts, fresh) => {
    setStatus('Detectando pared…');
    const r = await sam.current.segment(pts, fresh);
    const p = photo.current;
    current.current = cleanMask(new Uint8Array(r.mask), p.width, p.height);
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

  const onCanvasClick = async (e) => {
    const p = photo.current;
    if (!p) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pt = { x: ((e.clientX - rect.left) * p.width) / rect.width, y: ((e.clientY - rect.top) * p.height) / rect.height, label: mode };
    if (calibRef.current.tapping) return calibClick(pt);
    if (model.state !== 'ready') return;
    try { await runSegment([...pointsRef.current, pt], pointsRef.current.length === 0); }
    catch (err) { setStatus(`Error: ${err.message}`); }
  };
  const undo = async () => {
    const pts = pointsRef.current.slice(0, -1);
    if (!pts.length) { current.current = null; pointsRef.current = []; setPoints([]); await sam.current.call('reset'); repaint(); return; }
    await runSegment(pts, true);
  };
  const commit = async () => {
    if (!current.current) return;
    committed.current.push(current.current);
    current.current = null; pointsRef.current = []; setPoints([]); setWalls(committed.current.length);
    await sam.current.call('reset');
    setStatus('Pared confirmada. Tocá otra pared o elegí un color.');
    repaint();
  };
  const clearAll = async () => {
    current.current = null; committed.current = []; result.current = null; pointsRef.current = [];
    setPoints([]); setWalls(0); await sam.current.call('reset'); render();
  };

  const pick = (c) => { colorRef.current = c; setColor(c); setTimeout(() => repaint(c), 0); };
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

  const brand = tenant?.primary_color ?? '#1f6feb';
  const pct = model.total ? Math.round((model.loaded / model.total) * 100) : 0;

  return (
    <main class="wrap vis" style={{ '--brand': brand }}>
      <header class="bar">
        <div class="brand">
          {tenant?.logo_url && <img class="logo" src={tenant.logo_url} alt={`Logo de ${tenant.name}`} width="48" height="48" />}
          <h1>{tenant ? tenant.name : 'Visualizador de color'}</h1>
        </div>
        <a class="muted" href="/admin">Admin</a>
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
        <canvas ref={canvasRef} class="photo" onClick={onCanvasClick} />
        {status && <p class="muted">{status}</p>}

        <div class="row">
          <button class={mode === 1 ? 'on' : ''} onClick={() => setMode(1)}>🟢 Es pared</button>
          <button class={mode === 0 ? 'on' : ''} onClick={() => setMode(0)}>🔴 No es pared</button>
          <button onClick={undo} disabled={!points.length}>↩︎ Deshacer</button>
          <button onClick={commit} disabled={!points.length}>✔︎ Confirmar pared</button>
          <button onClick={clearAll}>Empezar de nuevo</button>
        </div>
        {walls > 0 && <p class="muted small">Paredes confirmadas: {walls}</p>}

        <h3>Elegí un color</h3>
        <ColorPicker colors={colors} selected={color} onPick={pick} />

        <div class="card grid">
          <label>Luminancia
            <select value={lum} onChange={(e) => { setLum(e.target.value); repaint(color, { lum: e.target.value }); }}>
              <option value="relative">Relativa (recomendada)</option>
              <option value="pure">Pura (L original)</option>
            </select>
          </label>
          <label>Intensidad {Math.round(intensity * 100)}%
            <input type="range" min="0.2" max="1" step="0.05" value={intensity}
              onInput={(e) => setIntensity(Number(e.target.value))} onChange={(e) => repaint(color, { intensity: Number(e.target.value) })} />
          </label>
          <label class="check"><input type="checkbox" checked={wb} onChange={(e) => { setWb(e.target.checked); repaint(color, { wb: e.target.checked }); }} /> Corregir balance de blancos</label>
          <div class="row">
            <button onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerLeave={hold(false)} disabled={!color}>Mantené para ver el antes</button>
            <button onClick={download} disabled={!color}>⬇︎ Descargar</button>
          </div>
        </div>

        <Calculator wallPx={wallPx} calib={calib} products={products} branches={branches} tenant={tenant} color={color} getImageBlob={getImageBlob}
          onStartCalib={startCalib} onResetCalib={resetCalib} />

        <p class="warn">⚠️ El color en pantalla puede diferir del color real de la pintura (depende de tu pantalla, la luz de la foto y la textura de la pared). Pedí una muestra antes de comprar.</p>
        <p class="muted small">
          Modelo: {model.info || '—'}{timing.embedMs ? ` · análisis ${timing.embedMs} ms` : ''}{timing.segMs ? ` · segmentación ${timing.segMs} ms` : ''}{timing.recolorMs ? ` · recoloreo ${timing.recolorMs} ms` : ''}
        </p>
      </div>
    </main>
  );
}
