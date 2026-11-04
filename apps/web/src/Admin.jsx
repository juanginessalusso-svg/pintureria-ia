import { useEffect, useState } from 'preact/hooks';
import { CSV_TEMPLATE, decodeCsvBytes, pesos } from '@pintureria/core';
import { api, mensaje, setCsrf } from './api.js';


export function Admin() {
  const [me, setMe] = useState(undefined); // undefined = cargando, null = sin sesión
  const [tab, setTab] = useState('colores');

  useEffect(() => {
    api('/admin/me')
      .then((m) => { setCsrf(m.csrf); setMe(m); })
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <main class="wrap"><p class="muted">Cargando…</p></main>;
  if (!me) return <Login onLogin={(m) => { setCsrf(m.csrf); api('/admin/me').then(setMe); }} />;

  const salir = async () => { await api('/admin/logout', { method: 'POST' }); setCsrf(''); setMe(null); };
  return (
    <main class="wrap">
      <header class="bar">
        <h1>{me.tenant.name}</h1>
        <span class="muted">{me.username} · <button class="link" onClick={salir}>Salir</button></span>
      </header>
      <nav class="tabs">
        {['colores', 'productos', 'sucursales', 'ajustes', 'cuenta'].map((t) => (
          <button class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </nav>
      {tab === 'colores' && <Colors />}
      {tab === 'productos' && <Products />}
      {tab === 'sucursales' && <Branches />}
      {tab === 'ajustes' && <Settings />}
      {tab === 'cuenta' && <Account />}
    </main>
  );
}

function Login({ onLogin }) {
  const [f, setF] = useState({ tenant: localStorage.getItem('tenant') ?? '', username: 'admin', password: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enviar = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const m = await api('/admin/login', { method: 'POST', body: f });
      localStorage.setItem('tenant', f.tenant);
      onLogin(m);
    } catch (x) { setErr(mensaje(x)); }
  };
  return (
    <main class="wrap narrow">
      <h1>Panel de administración</h1>
      <form onSubmit={enviar} class="card">
        <label>Pinturería (código)<input value={f.tenant} onInput={set('tenant')} required /></label>
        <label>Usuario<input value={f.username} onInput={set('username')} autocomplete="username" required /></label>
        <label>Contraseña<input type="password" value={f.password} onInput={set('password')} autocomplete="current-password" required /></label>
        {err && <p class="err">{err}</p>}
        <button class="primary">Entrar</button>
      </form>
    </main>
  );
}

/** Carga una lista y expone recargar; muestra errores de forma uniforme. */
function useList(path) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const reload = () => api(path).then(setRows).catch((e) => setErr(mensaje(e)));
  useEffect(() => { reload(); }, []);
  return { rows, err, setErr, reload };
}

const EMPTY_COLOR = { code: '', name: '', family: '', hex: '#cccccc', active: true };

function Colors() {
  const { rows, err, setErr, reload } = useList('/admin/colors');
  const [f, setF] = useState(EMPTY_COLOR);
  const [q, setQ] = useState('');
  // Con cartas grandes (cientos de colores) se filtra por texto y se muestran los primeros 200.
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filtered = (all) => {
    const nq = norm(q.trim());
    return (all ?? []).filter((c) => !nq || norm(`${c.name} ${c.code} ${c.family}`).includes(nq));
  };
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const guardar = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api(editing ? `/admin/colors/${editing}` : '/admin/colors', { method: editing ? 'PUT' : 'POST', body: f });
      setF(EMPTY_COLOR); setEditing(null); reload();
    } catch (x) { setErr(mensaje(x)); }
  };
  const borrar = async (c) => {
    if (!confirm(`¿Borrar "${c.name}"?`)) return;
    try { await api(`/admin/colors/${c.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr(mensaje(x)); }
  };
  const editar = (c) => { setEditing(c.id); setF({ code: c.code, name: c.name, family: c.family, hex: c.hex, active: c.active }); };

  return (
    <section>
      <form onSubmit={guardar} class="card grid">
        <label>Código<input value={f.code} onInput={set('code')} required /></label>
        <label>Nombre<input value={f.name} onInput={set('name')} required /></label>
        <label>Familia<input value={f.family} onInput={set('family')} placeholder="Blancos, Grises…" /></label>
        <label>Color
          <span class="row"><input type="color" value={f.hex} onInput={set('hex')} /><input value={f.hex} onInput={set('hex')} /></span>
        </label>
        <label class="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Visible para clientes</label>
        <div class="row">
          <button class="primary">{editing ? 'Guardar cambios' : 'Agregar color'}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setF(EMPTY_COLOR); }}>Cancelar</button>}
        </div>
      </form>
      {err && <p class="err">{err}</p>}
      {(rows?.length ?? 0) > 20 && (
        <div class="row">
          <input class="search" type="search" placeholder="Buscar por nombre, código o familia" value={q} onInput={(e) => setQ(e.target.value)} />
          <span class="muted small">{filtered(rows).length} de {rows.length}{filtered(rows).length > 200 ? ' (mostrando 200)' : ''}</span>
        </div>
      )}
      <table>
        <thead><tr><th></th><th>Código</th><th>Nombre</th><th>Familia</th><th>Hex</th><th>LAB</th><th></th></tr></thead>
        <tbody>
          {filtered(rows).slice(0, 200).map((c) => (
            <tr class={c.active ? '' : 'off'}>
              <td><span class="sw" style={{ background: c.hex }} /></td>
              <td>{c.code}</td><td>{c.name}</td><td>{c.family}</td><td>{c.hex}</td>
              <td class="muted">{c.lab_l.toFixed(0)} / {c.lab_a.toFixed(0)} / {c.lab_b.toFixed(0)}</td>
              <td class="row"><button onClick={() => editar(c)}>Editar</button><button onClick={() => borrar(c)}>Borrar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p class="muted">Todavía no cargaste colores.</p>}
    </section>
  );
}

/** Importar productos desde un CSV (Excel): vista previa con errores por línea y recién después se aplica. */
function ProductImport({ onDone }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [replace, setReplace] = useState(false);
  const [res, setRes] = useState(null); // respuesta de la vista previa (ok o con errores)
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [busy, setBusy] = useState(false);

  const call = async (text, mode, dryRun) => {
    try { return await api('/admin/products/import', { method: 'POST', body: { csv: text, mode, dryRun } }); }
    catch (e) { if (e.body?.errors) return e.body; throw e; } // 400 con errores por línea: se muestra igual
  };
  const preview = async (text, mode) => {
    setBusy(true); setMsg({ ok: '', err: '' });
    try { setRes(await call(text, mode, true)); } catch (e) { setRes(null); setMsg({ ok: '', err: mensaje(e) }); }
    setBusy(false);
  };
  const plantilla = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    a.download = 'plantilla-productos.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const elegir = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer())); // UTF-8 o, si no, Windows-1252 (Excel)
    setCsv(text); setFileName(file.name); setReplace(false);
    await preview(text, 'upsert');
  };
  const cambiarModo = async (v) => { setReplace(v); if (csv) await preview(csv, v ? 'replace' : 'upsert'); };
  const importar = async () => {
    const s = res.summary;
    if (replace && !confirm(`Se van a BORRAR ${s.remove} productos que no están en el archivo (${s.removeNames.join(', ')}${s.remove > s.removeNames.length ? '…' : ''}). ¿Seguro?`)) return;
    setBusy(true); setMsg({ ok: '', err: '' });
    try {
      const out = await call(csv, replace ? 'replace' : 'upsert', false);
      if (out.applied) {
        setMsg({ ok: `Listo: ${out.summary.create} productos nuevos y ${out.summary.update} actualizados${out.summary.remove ? `, ${out.summary.remove} borrados` : ''}.`, err: '' });
        setRes(null); setCsv(''); setFileName(''); onDone();
      } else setRes(out);
    } catch (e) { setMsg({ ok: '', err: mensaje(e) }); }
    setBusy(false);
  };

  const s = res?.summary;
  return (
    <div class="card">
      <div class="row">
        <strong>Importar productos desde Excel / CSV</strong>
        <button onClick={() => setOpen(!open)}>{open ? 'Cerrar' : 'Abrir'}</button>
      </div>
      {open && (
        <>
          <p class="muted small">
            Una fila por <strong>presentación</strong>: repetí el SKU y cambiá litros y precio. Obligatorias: <em>sku, nombre, rendimiento</em> (m² por litro y por mano).
            Acepta separador <code>;</code> o <code>,</code>, coma decimal y precios como <code>$ 48.000,50</code>. Si el SKU ya existe se actualiza.
          </p>
          <div class="row">
            <button onClick={plantilla}>⬇︎ Descargar plantilla</button>
            <label class="btn primary">📄 Elegir archivo CSV<input type="file" accept=".csv,.txt,text/csv" onChange={elegir} hidden /></label>
            {fileName && <span class="muted small">{fileName}</span>}
          </div>
          {busy && <p class="muted">Procesando…</p>}
          {s && (
            <div class="result">
              <p>
                {s.products} productos ({s.sizes} presentaciones): <strong>{s.create} nuevos</strong>, <strong>{s.update} se actualizan</strong>
                {replace && <>, <strong class="err">{s.remove} se borran</strong>{s.remove ? ` (${s.removeNames.join(', ')}${s.remove > s.removeNames.length ? '…' : ''})` : ''}</>}.
              </p>
              {res.errors.length > 0 && (
                <>
                  <p class="err"><strong>Corregí {res.errors.length} {res.errors.length === 1 ? 'error' : 'errores'} y volvé a elegir el archivo (no se importó nada):</strong></p>
                  <ul class="small">{res.errors.slice(0, 30).map((e) => <li><strong>Línea {e.line}:</strong> {e.message}</li>)}</ul>
                  {res.errors.length > 30 && <p class="muted small">…y {res.errors.length - 30} más.</p>}
                </>
              )}
              {res.warnings.length > 0 && (
                <details><summary class="muted small">{res.warnings.length} {res.warnings.length === 1 ? 'aviso' : 'avisos'}</summary>
                  <ul class="small">{res.warnings.slice(0, 30).map((w) => <li>Línea {w.line}: {w.message}</li>)}</ul>
                </details>
              )}
              {res.ignoredColumns?.length > 0 && <p class="muted small">Columnas que no se usan: {res.ignoredColumns.join(', ')}.</p>}
              {res.ok && (
                <>
                  <label class="check"><input type="checkbox" checked={replace} onChange={(e) => cambiarModo(e.target.checked)} /> Reemplazar todo: borrar los productos que no estén en el archivo</label>
                  <button class="primary" onClick={importar} disabled={busy}>Importar {s.products} productos</button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {msg.ok && <p class="ok">{msg.ok}</p>}
      {msg.err && <p class="err">{msg.err}</p>}
    </div>
  );
}

const EMPTY_PRODUCT = { sku: '', name: '', category: '', description: '', coats: 2, yield_m2_per_l: 10, tech_sheet: '', active: true, sizes: [{ liters: 4, price: '' }] };

function Products() {
  const { rows, err, setErr, reload } = useList('/admin/products');
  const [f, setF] = useState(EMPTY_PRODUCT);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setSize = (i, k, v) => setF({ ...f, sizes: f.sizes.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });

  const guardar = async (e) => {
    e.preventDefault(); setErr('');
    const body = {
      ...f,
      coats: Number(f.coats),
      yield_m2_per_l: Number(f.yield_m2_per_l),
      sizes: f.sizes.filter((s) => s.liters && s.price !== '').map((s) => ({ liters: Number(s.liters), price_cents: Math.round(Number(s.price) * 100) })),
    };
    try {
      await api(editing ? `/admin/products/${editing}` : '/admin/products', { method: editing ? 'PUT' : 'POST', body });
      setF(EMPTY_PRODUCT); setEditing(null); reload();
    } catch (x) { setErr(mensaje(x)); }
  };
  const borrar = async (p) => {
    if (!confirm(`¿Borrar "${p.name}"?`)) return;
    try { await api(`/admin/products/${p.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr(mensaje(x)); }
  };
  const editar = (p) => {
    setEditing(p.id);
    setF({ ...p, sizes: p.sizes.map((s) => ({ liters: s.liters, price: s.price_cents / 100 })) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section>
      <ProductImport onDone={reload} />
      <form onSubmit={guardar} class="card grid">
        <label>SKU<input value={f.sku} onInput={set('sku')} required /></label>
        <label>Nombre<input value={f.name} onInput={set('name')} required /></label>
        <label>Categoría<input value={f.category} onInput={set('category')} placeholder="interior, exterior, humedad…" /></label>
        <label>Manos recomendadas<input type="number" min="1" max="4" value={f.coats} onInput={set('coats')} /></label>
        <label>Rendimiento por mano (m²/L)<input type="number" step="0.1" min="0.1" value={f.yield_m2_per_l} onInput={set('yield_m2_per_l')} required /></label>
        <label class="wide">Descripción<textarea rows="2" value={f.description} onInput={set('description')} /></label>
        <label class="wide">Ficha técnica (pasos de aplicación, preparación, advertencias)
          <textarea rows="5" value={f.tech_sheet} onInput={set('tech_sheet')} />
        </label>
        <div class="wide">
          <strong>Presentaciones y precios (ARS)</strong>
          {f.sizes.map((s, i) => (
            <div class="row">
              <input type="number" step="0.5" min="0.5" placeholder="Litros" value={s.liters} onInput={(e) => setSize(i, 'liters', e.target.value)} />
              <input type="number" step="1" min="0" placeholder="Precio $" value={s.price} onInput={(e) => setSize(i, 'price', e.target.value)} />
              <button type="button" onClick={() => setF({ ...f, sizes: f.sizes.filter((_, j) => j !== i) })}>Quitar</button>
            </div>
          ))}
          <button type="button" onClick={() => setF({ ...f, sizes: [...f.sizes, { liters: '', price: '' }] })}>+ Presentación</button>
        </div>
        <label class="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Visible para clientes</label>
        <div class="row">
          <button class="primary">{editing ? 'Guardar cambios' : 'Agregar producto'}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setF(EMPTY_PRODUCT); }}>Cancelar</button>}
        </div>
      </form>
      {err && <p class="err">{err}</p>}
      <table>
        <thead><tr><th>SKU</th><th>Nombre</th><th>Categoría</th><th>Rend.</th><th>Presentaciones</th><th></th></tr></thead>
        <tbody>
          {(rows ?? []).map((p) => (
            <tr class={p.active ? '' : 'off'}>
              <td>{p.sku}</td><td>{p.name}</td><td>{p.category}</td><td>{p.yield_m2_per_l} m²/L</td>
              <td>{p.sizes.map((s) => `${s.liters} L ${pesos(s.price_cents)}`).join(' · ')}</td>
              <td class="row"><button onClick={() => editar(p)}>Editar</button><button onClick={() => borrar(p)}>Borrar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p class="muted">Todavía no cargaste productos.</p>}
    </section>
  );
}

const EMPTY_BRANCH = { name: '', address: '', whatsapp: '', active: true, position: 0 };

function Branches() {
  const { rows, err, setErr, reload } = useList('/admin/branches');
  const [f, setF] = useState(EMPTY_BRANCH);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const guardar = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api(editing ? `/admin/branches/${editing}` : '/admin/branches', { method: editing ? 'PUT' : 'POST', body: { ...f, position: Number(f.position) || 0 } });
      setF(EMPTY_BRANCH); setEditing(null); reload();
    } catch (x) { setErr(mensaje(x)); }
  };
  const borrar = async (b) => {
    if (!confirm(`¿Borrar la sucursal "${b.name}"?`)) return;
    try { await api(`/admin/branches/${b.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr(mensaje(x)); }
  };
  const editar = (b) => { setEditing(b.id); setF({ name: b.name, address: b.address, whatsapp: b.whatsapp, active: b.active, position: b.position }); };

  return (
    <section>
      <p class="muted small">
        Cada sucursal puede tener su propio WhatsApp. Si cargás 2 o más, el cliente elige a cuál le manda el presupuesto.
        Si una sucursal no tiene número propio, se usa el de "Ajustes". Con una sola sucursal se usa directamente.
      </p>
      <form onSubmit={guardar} class="card grid">
        <label>Nombre<input value={f.name} onInput={set('name')} placeholder="Río Cuarto - Centro" required /></label>
        <label>Dirección<input value={f.address} onInput={set('address')} /></label>
        <label>WhatsApp<input value={f.whatsapp} onInput={set('whatsapp')} placeholder="5493584907406" inputmode="tel" /></label>
        <label>Orden<input type="number" min="0" max="999" value={f.position} onInput={set('position')} /></label>
        <label class="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Visible para clientes</label>
        <div class="row">
          <button class="primary">{editing ? 'Guardar cambios' : 'Agregar sucursal'}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setF(EMPTY_BRANCH); }}>Cancelar</button>}
        </div>
      </form>
      {err && <p class="err">{err}</p>}
      <table>
        <thead><tr><th>Orden</th><th>Nombre</th><th>Dirección</th><th>WhatsApp</th><th></th></tr></thead>
        <tbody>
          {(rows ?? []).map((b) => (
            <tr class={b.active ? '' : 'off'}>
              <td>{b.position}</td><td>{b.name}</td><td>{b.address}</td><td>{b.whatsapp || <span class="muted">usa el de Ajustes</span>}</td>
              <td class="row"><button onClick={() => editar(b)}>Editar</button><button onClick={() => borrar(b)}>Borrar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p class="muted">Todavía no cargaste sucursales.</p>}
    </section>
  );
}

function Settings() {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState({ ok: '', err: '' });
  useEffect(() => { api('/admin/settings').then(setF); }, []);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const guardar = async (e) => {
    e.preventDefault();
    try { await api('/admin/settings', { method: 'PUT', body: f }); setMsg({ ok: 'Guardado.', err: '' }); }
    catch (x) { setMsg({ ok: '', err: mensaje(x) }); }
  };
  return (
    <form onSubmit={guardar} class="card grid">
      <label>Nombre del negocio<input value={f.name} onInput={set('name')} required /></label>
      <label>WhatsApp para presupuestos<input value={f.whatsapp} onInput={set('whatsapp')} placeholder="5491112345678" /></label>
      <label>Logo (URL https)<input value={f.logo_url} onInput={set('logo_url')} /></label>
      <label>Color de marca<span class="row"><input type="color" value={f.primary_color} onInput={set('primary_color')} /><input value={f.primary_color} onInput={set('primary_color')} /></span></label>
      <div><button class="primary">Guardar</button></div>
      {msg.ok && <p class="ok">{msg.ok}</p>}
      {msg.err && <p class="err">{msg.err}</p>}
    </form>
  );
}

function Account() {
  const [f, setF] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const guardar = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/password', { method: 'POST', body: f });
      setF({ current: '', next: '' }); setMsg({ ok: 'Contraseña cambiada.', err: '' });
    } catch (x) { setMsg({ ok: '', err: mensaje(x) }); }
  };
  return (
    <form onSubmit={guardar} class="card narrow">
      <label>Contraseña actual<input type="password" value={f.current} onInput={set('current')} autocomplete="current-password" required /></label>
      <label>Contraseña nueva (mínimo 10 caracteres)<input type="password" value={f.next} onInput={set('next')} minlength="10" autocomplete="new-password" required /></label>
      <button class="primary">Cambiar contraseña</button>
      {msg.ok && <p class="ok">{msg.ok}</p>}
      {msg.err && <p class="err">{msg.err}</p>}
    </form>
  );
}
