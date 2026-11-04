import { useMemo, useState } from 'preact/hooks';

// Sin tildes y en minúsculas: "Marrón" se encuentra buscando "marron".
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const BIG = 60; // hasta esta cantidad se muestran todos agrupados; más que eso, familias + búsqueda
const PAGE = 120;

/** Selector de color. Con catálogos grandes (cartas de cientos de tonos) se navega por familia o buscando. */
export function ColorPicker({ colors, selected, onPick }) {
  const [q, setQ] = useState('');
  const [fam, setFam] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const families = useMemo(() => [...new Set(colors.map((c) => c.family || 'Otros'))].sort((a, b) => a.localeCompare(b, 'es')), [colors]);
  const big = colors.length > BIG;
  const nq = norm(q.trim());
  const list = useMemo(() => {
    if (!big) return [];
    return colors
      .filter((c) => (!fam || (c.family || 'Otros') === fam) && (!nq || norm(`${c.name} ${c.code}`).includes(nq)))
      .sort((a, b) => b.lab.L - a.lab.L); // de más claro a más oscuro
  }, [colors, fam, nq, big]);

  const swatch = (c) => (
    <button key={c.id} class={`sw-btn ${selected?.id === c.id ? 'sel' : ''}`} title={`${c.name} (${c.code})`} aria-label={`${c.name} ${c.code}`}
      style={{ background: c.hex }} onClick={() => onPick(c)} />
  );

  return (
    <div class="picker">
      {!big && families.map((f) => (
        <div key={f}>
          <div class="muted small">{f}</div>
          <div class="swatches">{colors.filter((c) => (c.family || 'Otros') === f).map(swatch)}</div>
        </div>
      ))}

      {big && (
        <>
          <input class="search" type="search" placeholder="Buscar por nombre o código (ej: verde calma, 702)" value={q}
            onInput={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
          <div class="chips">
            <button class={!fam ? 'on' : ''} onClick={() => { setFam(''); setLimit(PAGE); }}>Todas</button>
            {families.map((f) => (
              <button key={f} class={fam === f ? 'on' : ''} onClick={() => { setFam(f); setLimit(PAGE); }}>{f}</button>
            ))}
          </div>
          {!fam && !nq && <p class="muted small">Elegí una familia o buscá por nombre o código ({colors.length} colores).</p>}
          {(fam || nq) && (
            <>
              <p class="muted small">{list.length} {list.length === 1 ? 'color' : 'colores'}{list.length > limit ? ` (mostrando ${limit})` : ''}, del más claro al más oscuro</p>
              <div class="swatches">{list.slice(0, limit).map(swatch)}</div>
              {list.length > limit && <button onClick={() => setLimit(limit + PAGE)}>Ver más ({list.length - limit})</button>}
            </>
          )}
        </>
      )}

      {selected && (
        <p class="picked">
          <span class="sw" style={{ background: selected.hex }} /> <strong>{selected.name}</strong>{' '}
          <span class="muted">({selected.code}{selected.family ? ` · ${selected.family}` : ''})</span>
        </p>
      )}
    </div>
  );
}
