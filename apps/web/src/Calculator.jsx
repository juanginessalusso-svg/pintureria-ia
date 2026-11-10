import { useEffect, useMemo, useState } from 'preact/hooks';
import { areaM2, litersNeeded, suggestCans, DEFAULT_MARGIN, buildBudgetMessage, whatsappUrl, cleanWhatsapp, pesos } from '@pintureria/core';
import { useCart } from './cartState.js';
import { tenantHref } from './tenant.js';

const ars = pesos; // formato argentino; muestra centavos solo si los hay
const fmt = (n, d = 1) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

const PRESETS = [
  { id: 'puerta', label: 'Altura de una puerta (2,05 m)', meters: 2.05 },
  { id: 'techo', label: 'Piso a techo (2,60 m)', meters: 2.6 },
  { id: 'otra', label: 'Otra medida que conozco…', meters: null },
];

/**
 * Calculadora de pintura. Todo es ESTIMACIÓN y editable:
 *  - m² a partir de la pared marcada (visible) y la escala calibrada, o ingresados a mano;
 *  - litros = m² × manos ÷ rendimiento × 1,10;  latas: menor costo que cubra los litros.
 */
export function Calculator({ wallPx, calib, products, branches = [], tenant, color, surfaceColors = [], getImageBlob, onStartCalib, onResetCalib }) {
  const { add } = useCart();
  const [addedNotice, setAddedNotice] = useState(false);
  const [branchId, setBranchId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [shareMsg, setShareMsg] = useState('');
  // Referencia corta del presupuesto: ayuda a la pinturería a encontrarlo en el chat. No se guarda en ningún lado.
  const ref = useMemo(() => `PA-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, []);
  const [preset, setPreset] = useState('puerta');
  const [custom, setCustom] = useState('');
  const [extra, setExtra] = useState('');
  const [manual, setManual] = useState(''); // m² escritos a mano: pisan al calculado
  const [productId, setProductId] = useState(null);
  const [coats, setCoats] = useState(2);

  const product = products.find((p) => p.id === productId) ?? null;
  // No se preselecciona ningún producto: el cliente elige explícitamente (el primero de la lista puede no servir para paredes).
  useEffect(() => { if (product) setCoats(product.coats); }, [productId]);

  const meters = preset === 'otra' ? Number(String(custom).replace(',', '.')) : PRESETS.find((p) => p.id === preset).meters;
  const auto = calib.pxPerM && wallPx > 0 ? areaM2(wallPx, calib.pxPerM) : null;
  const extraM2 = Number(String(extra).replace(',', '.')) || 0;
  const manualM2 = manual === '' ? null : Number(String(manual).replace(',', '.'));
  const m2 = manualM2 != null && manualM2 >= 0 ? manualM2 : auto != null ? Math.max(0, auto + extraM2) : null;

  const calc = useMemo(() => {
    if (m2 == null || !product || !(coats >= 1)) return null;
    const liters = litersNeeded({ m2, coats, yieldM2PerL: product.yield_m2_per_l });
    return { liters, cans: suggestCans(liters, product.sizes) };
  }, [m2, product, coats]);

  // Sucursal: con 1 sola se usa directo; con 2 o más el cliente elige (sin preselección, para no mandar el presupuesto a la equivocada).
  const branch = branches.length === 1 ? branches[0] : branches.find((b) => b.id === branchId) ?? null;
  const needsBranch = branches.length >= 2 && !branch;
  const number = branch?.whatsapp || tenant?.whatsapp; // la sucursal puede no tener número propio

  const message = useMemo(() => (calc ? buildBudgetMessage({
    shop: tenant?.name, branch: branch?.name, color, colors: surfaceColors, product, coats, m2, liters: calc.liters, cans: calc.cans, margin: DEFAULT_MARGIN, ref,
    date: new Date().toLocaleDateString('es-AR'),
  }) : ''), [calc, tenant, branch, color, surfaceColors, product, coats, m2]);
  const hasNumber = !!cleanWhatsapp(number);
  const canShareImage = typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [new File([], 'a.png', { type: 'image/png' })] });

  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setShareMsg('No se pudo copiar. Seleccioná el texto a mano.'); }
  };
  const shareImage = async () => {
    try {
      const blob = await getImageBlob();
      const file = new File([blob], 'mi-ambiente.png', { type: 'image/png' });
      await navigator.share({ files: [file], text: message });
      setShareMsg('');
    } catch (e) { if (e?.name !== 'AbortError') setShareMsg('No se pudo compartir la imagen.'); }
  };

  const handleAddCansToCart = () => {
    if (!calc?.cans?.items?.length || !product) return;
    for (const item of calc.cans.items) {
      add({
        sku: product.sku,
        name: product.name,
        liters: item.liters,
        unit_price_cents: item.unit_price_cents,
        qty: item.qty,
        color: color ? { name: color.name, code: color.code, hex: color.hex } : null,
      });
    }
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 3500);
  };

  return (
    <section class="card calc">
      <h3>¿Cuánta pintura necesito?</h3>

      <div class="calib">
        <strong>1. Escala de la foto</strong>
        <p class="muted small">Para pasar la foto a metros necesito una medida conocida <u>sobre la misma pared</u> (el marco de una puerta, por ejemplo).</p>
        <div class="row">
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => <option value={p.id}>{p.label}</option>)}
          </select>
          {preset === 'otra' && <input class="num" inputmode="decimal" placeholder="metros" value={custom} onInput={(e) => setCustom(e.target.value)} />}
          <button disabled={!(meters > 0) || !wallPx} onClick={() => onStartCalib(meters)}>
            {calib.tapping ? 'Tocá los 2 extremos en la foto…' : calib.pxPerM ? 'Volver a marcar' : '📏 Marcar en la foto'}
          </button>
          {calib.pxPerM && <button onClick={onResetCalib}>Quitar escala</button>}
        </div>
        {!wallPx && <p class="muted small">Primero elegí un color para una superficie: la escala se mide sobre la pared que pintaste.</p>}
        {calib.pxPerM && <p class="ok small">Escala lista ({Math.round(calib.pxPerM)} px por metro).</p>}
      </div>

      <div>
        <strong>2. Superficie a pintar</strong>
        <div class="grid">
          <label>Calculada desde la foto
            <input value={auto != null ? `${fmt(auto)} m²` : '—'} readOnly />
          </label>
          <label>Sumar / restar m² (pared tapada por muebles, etc.)
            <input inputmode="decimal" placeholder="0" value={extra} onInput={(e) => setExtra(e.target.value)} disabled={manual !== ''} />
          </label>
          <label>O escribí los m² vos
            <input inputmode="decimal" placeholder="ej: 18" value={manual} onInput={(e) => setManual(e.target.value)} />
          </label>
        </div>
        <p class="muted small">La pared que se ve ya descuenta puertas, ventanas y lo que tapan los muebles. Si vas a mover un mueble, sumá esos m².</p>
      </div>

      <div>
        <strong>3. Producto</strong>
        {!products.length && <p class="muted small">Esta pinturería todavía no cargó productos.</p>}
        {products.length > 0 && (
          <div class="grid">
            <label>Producto
              <select value={productId ?? ''} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Elegí un producto…</option>
                {products.map((p) => <option value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Manos
              <input type="number" min="1" max="4" value={coats} onInput={(e) => setCoats(Number(e.target.value))} />
            </label>
            {product && <label>Rendimiento
              <input value={`${product.yield_m2_per_l} m²/L por mano`} readOnly />
            </label>}
          </div>
        )}
      </div>

      {calc && (
        <div class="result">
          <p>
            <strong>{fmt(m2)} m²</strong> × {coats} {coats === 1 ? 'mano' : 'manos'} ÷ {product.yield_m2_per_l} m²/L + {Math.round(DEFAULT_MARGIN * 100)} % de margen
            {' = '}<strong>{fmt(calc.liters)} litros</strong>
          </p>
          {calc.cans ? (
            <>
              <ul class="cans">
                {calc.cans.items.map((i) => (
                  <li>{i.qty} × lata de {fmt(i.liters, i.liters % 1 ? 1 : 0)} L {i.unit_price_cents > 0 && <span class="muted">({ars(i.unit_price_cents)} c/u)</span>}</li>
                ))}
              </ul>
              {calc.cans.total_cents > 0 && <p class="total">Total estimado: <strong>{ars(calc.cans.total_cents)}</strong></p>}
              <p class="muted small">Compraría {fmt(calc.cans.total_liters)} L en total y te sobrarían unos {fmt(calc.cans.leftover_liters)} L para retoques.</p>
            </>
          ) : <p class="muted small">Este producto no tiene presentaciones cargadas.</p>}

          {branches.length >= 2 && (
            <label class="branch">¿A qué sucursal le enviás el presupuesto?
              <select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Elegí una sucursal…</option>
                {branches.map((b) => <option value={b.id}>{b.name}{b.address ? ` — ${b.address}` : ''}</option>)}
              </select>
            </label>
          )}
          {branches.length === 1 && <p class="muted small">Sucursal: <strong>{branches[0].name}</strong>{branches[0].address ? ` — ${branches[0].address}` : ''}</p>}

          <div class="row wa-row">
            {calc.cans?.items?.length > 0 && (
              <button type="button" class="btn primary" onClick={handleAddCansToCart}>
                🛒 Agregar estas latas al carrito
              </button>
            )}
            {needsBranch
              ? <button class="btn wa" disabled title="Elegí una sucursal">💬 Enviar presupuesto por WhatsApp</button>
              : <a class="btn wa" href={whatsappUrl(number, message)} target="_blank" rel="noopener noreferrer">💬 Enviar presupuesto por WhatsApp</a>}
            <button onClick={copy}>{copied ? '✓ Copiado' : 'Copiar texto'}</button>
            {canShareImage && color && <button onClick={shareImage}>🖼️ Compartir con la imagen</button>}
          </div>
          {addedNotice && (
            <p class="ok small" style={{ marginTop: '8px' }}>
              ✓ ¡Latas agregadas al carrito! <a href={tenantHref('/carrito')} style={{ fontWeight: 'bold', textDecoration: 'underline' }}>Ver carrito →</a>
            </p>
          )}
          {needsBranch && <p class="muted small">Elegí la sucursal para habilitar el envío.</p>}
          {!needsBranch && !hasNumber && <p class="muted small">Esta pinturería no cargó su número: WhatsApp te va a dejar elegir a quién enviarlo.</p>}
          {shareMsg && <p class="err small">{shareMsg}</p>}
          <p class="muted small">🔒 Se abre WhatsApp con el mensaje ya escrito; no se envía nada hasta que vos toques Enviar. No se adjunta tu foto ni se guardan tus datos.</p>
        </div>
      )}
      {!calc && !product && products.length > 0 && <p class="muted">Elegí un producto para ver los litros y las latas.</p>}
      {!calc && product && <p class="muted">Calibrá la escala o escribí los m² para ver los litros.</p>}

      <p class="warn">⚠️ Es una <strong>estimación</strong>: depende de la perspectiva de la foto, del estado de la pared y de cómo aplique cada persona. Confirmá las medidas antes de comprar. Los precios son orientativos.</p>
    </section>
  );
}
