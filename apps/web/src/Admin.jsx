import { useEffect, useState } from 'preact/hooks';
import { CSV_TEMPLATE, decodeCsvBytes, pesos } from '@pintureria/core';
import { api, mensaje, setCsrf } from './api.js';

/* ---- Iconos SVG limpios y modernos ---- */
function PaletteIcon({ className = 'admin-nav-icon' }) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
    </svg>
  );
}

function BoxIcon({ className = 'admin-nav-icon' }) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function StoreIcon({ className = 'admin-nav-icon' }) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
      <path d="M22 7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2" />
    </svg>
  );
}

function SettingsIcon({ className = 'admin-nav-icon' }) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function UserShieldIcon({ className = 'admin-nav-icon' }) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}


/* ---- Componente Principal Admin con Layout Dashboard y Sidebar ---- */
export function Admin() {
  const [me, setMe] = useState(undefined); // undefined = cargando, null = sin sesión
  const [tab, setTab] = useState('colores');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    api('/admin/me')
      .then((m) => { setCsrf(m.csrf); setMe(m); })
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return (
      <div class="admin-login-wrap">
        <p class="muted">Cargando panel de administración…</p>
      </div>
    );
  }

  if (!me) {
    return <Login onLogin={(m) => { setCsrf(m.csrf); api('/admin/me').then(setMe); }} />;
  }

  const salir = async () => {
    await api('/admin/logout', { method: 'POST' });
    setCsrf('');
    setMe(null);
  };

  const navItems = [
    { id: 'colores', label: 'Colores', icon: PaletteIcon, desc: 'Catálogo de colores para simulador y cartas' },
    { id: 'productos', label: 'Productos', icon: BoxIcon, desc: 'Gestión de productos, rendimiento, precios y presentaciones' },
    { id: 'sucursales', label: 'Sucursales', icon: StoreIcon, desc: 'Puntos de venta físicos y líneas de WhatsApp' },
    { id: 'ajustes', label: 'Ajustes', icon: SettingsIcon, desc: 'Configuración general de la pinturería y marca' },
    { id: 'cuenta', label: 'Cuenta', icon: UserShieldIcon, desc: 'Seguridad y contraseña de acceso' },
  ];

  const currentTab = navItems.find((n) => n.id === tab) || navItems[0];

  return (
    <div class="admin-body">
      {/* Header móvil */}
      <div class="admin-mobile-header">
        <button class="admin-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Menú">
          {mobileOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
        <span class="admin-brand-name">{me.tenant.name}</span>
        <button class="admin-logout-btn" onClick={salir} title="Cerrar sesión">
          <LogoutIcon /> Salir
        </button>
      </div>

      <div class="admin-layout">
        {/* Backdrop para mobile */}
        <div class={`admin-backdrop ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} />

        {/* Barra Lateral (Sidebar) */}
        <aside class={`admin-sidebar ${mobileOpen ? 'open' : ''}`}>
          <div class="admin-sidebar-brand">
            <div class="admin-brand-icon">
              <PaletteIcon className="w-5 h-5 text-white" />
            </div>
            <div class="admin-brand-info">
              <span class="admin-brand-name" title={me.tenant.name}>{me.tenant.name}</span>
              <span class="admin-brand-badge">Panel Admin</span>
            </div>
          </div>

          <nav class="admin-nav">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  class={`admin-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setTab(item.id);
                    setMobileOpen(false);
                  }}
                >
                  <Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div class="admin-sidebar-footer">
            <a href="/" target="_blank" rel="noopener noreferrer" class="admin-store-link">
              <ExternalIcon />
              <span>Ver tienda online</span>
            </a>

            <div class="admin-user-card">
              <div class="admin-user-details">
                <div class="admin-user-avatar">
                  {me.username ? me.username.slice(0, 1).toUpperCase() : 'A'}
                </div>
                <span class="admin-user-name" title={me.username}>{me.username}</span>
              </div>
              <button class="admin-logout-btn" onClick={salir} title="Cerrar sesión">
                <LogoutIcon />
                <span>Salir</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Contenido Principal */}
        <main class="admin-main">
          <header class="admin-header">
            <div>
              <h1 class="admin-header-title">{currentTab.label}</h1>
              <p class="admin-header-desc">{currentTab.desc}</p>
            </div>
          </header>

          <div class="admin-content-area">
            {tab === 'colores' && <Colors />}
            {tab === 'productos' && <Products />}
            {tab === 'sucursales' && <Branches />}
            {tab === 'ajustes' && <Settings />}
            {tab === 'cuenta' && <Account />}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---- Pantalla de Login ---- */
function Login({ onLogin }) {
  const [f, setF] = useState({ tenant: localStorage.getItem('tenant') ?? '', username: 'admin', password: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enviar = async (e) => {
    e.preventDefault();
    setErr('');
    const cleanTenant = f.tenant.trim().toLowerCase();
    const cleanUsername = f.username.trim();
    try {
      const m = await api('/admin/login', {
        method: 'POST',
        body: { tenant: cleanTenant, username: cleanUsername, password: f.password },
      });
      localStorage.setItem('tenant', cleanTenant);
      onLogin(m);
    } catch (x) { setErr(mensaje(x)); }
  };

  return (
    <div class="admin-login-wrap">
      <div class="admin-login-box">
        <div class="admin-login-header">
          <div class="admin-brand-icon" style={{ margin: '0 auto 12px' }}>
            <PaletteIcon className="w-5 h-5 text-white" />
          </div>
          <h1>Panel de Administración</h1>
          <p>Ingresá tus credenciales para gestionar el sistema</p>
        </div>
        <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label class="admin-field">
            Pinturería (código)
            <input class="admin-input" value={f.tenant} onInput={set('tenant')} required />
          </label>
          <label class="admin-field">
            Usuario
            <input class="admin-input" value={f.username} onInput={set('username')} autocomplete="username" required />
          </label>
          <label class="admin-field">
            Contraseña
            <input class="admin-input" type="password" value={f.password} onInput={set('password')} autocomplete="current-password" required />
          </label>
          {err && <div class="admin-notice-err">{err}</div>}
          <button class="admin-btn admin-btn-primary" style={{ width: '100%', marginTop: '6px' }}>Entrar al Panel</button>
        </form>
      </div>
    </div>
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

/* ==========================================================================
   SECCIÓN: COLORES
   ========================================================================== */
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
      <div class="admin-card-box">
        <h3>{editing ? 'Editar color' : 'Agregar nuevo color'}</h3>
        <form onSubmit={guardar} class="admin-grid-form">
          <label class="admin-field">Código<input value={f.code} onInput={set('code')} required /></label>
          <label class="admin-field">Nombre<input value={f.name} onInput={set('name')} required /></label>
          <label class="admin-field">Familia<input value={f.family} onInput={set('family')} placeholder="Blancos, Grises…" /></label>
          <label class="admin-field">
            Color
            <div class="admin-color-picker-group">
              <input class="admin-color-swatch-input" type="color" value={f.hex} onInput={set('hex')} />
              <input value={f.hex} onInput={set('hex')} placeholder="#ffffff" />
            </div>
          </label>
          <div class="admin-col-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginTop: '4px' }}>
            <label class="admin-checkbox-label">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
              Visible para clientes
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button class="admin-btn admin-btn-primary">{editing ? 'Guardar cambios' : 'Agregar color'}</button>
              {editing && <button type="button" class="admin-btn admin-btn-secondary" onClick={() => { setEditing(null); setF(EMPTY_COLOR); }}>Cancelar</button>}
            </div>
          </div>
        </form>
      </div>

      {err && <div class="admin-notice-err">{err}</div>}

      {(rows?.length ?? 0) > 20 && (
        <div class="admin-search-bar">
          <input class="admin-input admin-search-input" type="search" placeholder="Buscar por nombre, código o familia…" value={q} onInput={(e) => setQ(e.target.value)} />
          <span class="muted small">{filtered(rows).length} de {rows.length}{filtered(rows).length > 200 ? ' (mostrando 200)' : ''}</span>
        </div>
      )}

      <div class="admin-table-wrapper">
        <table class="admin-data-table">
          <thead>
            <tr>
              <th style={{ width: '48px' }}>Color</th>
              <th>Código</th>
              <th>Nombre</th>
              <th>Familia</th>
              <th>Hex</th>
              <th>LAB</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered(rows).slice(0, 200).map((c) => (
              <tr class={c.active ? '' : 'off'}>
                <td><span class="admin-color-preview-chip" style={{ background: c.hex }} /></td>
                <td><strong>{c.code}</strong></td>
                <td>{c.name}</td>
                <td>{c.family}</td>
                <td><code>{c.hex}</code></td>
                <td class="muted">{c.lab_l.toFixed(0)} / {c.lab_a.toFixed(0)} / {c.lab_b.toFixed(0)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: '6px' }}>
                    <button class="admin-btn-edit-outline" onClick={() => editar(c)}>Editar</button>
                    <button class="admin-btn-danger-outline" onClick={() => borrar(c)}>Borrar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <div class="admin-empty-state">Todavía no cargaste colores.</div>}
      </div>
    </section>
  );
}

/* ==========================================================================
   SECCIÓN: IMPORTADOR CSV DE PRODUCTOS
   ========================================================================== */
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
    <div class="admin-card-box" style={{ background: '#f8fafc', borderColor: '#cbd5e1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div>
          <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>Importar productos desde Excel / CSV</strong>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: '#64748b' }}>Carga masiva o actualización de precios por planilla</p>
        </div>
        <button class="admin-btn admin-btn-secondary" onClick={() => setOpen(!open)}>{open ? 'Cerrar importador' : 'Abrir importador'}</button>
      </div>
      {open && (
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
          <p class="muted small" style={{ marginTop: 0 }}>
            Una fila por <strong>presentación</strong>: repetí el SKU y cambiá litros y precio. Obligatorias: <em>sku, nombre, rendimiento</em> (m² por litro y por mano).
            Acepta separador <code>;</code> o <code>,</code>, coma decimal y precios como <code>$ 48.000,50</code>. Si el SKU ya existe se actualiza.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '14px 0' }}>
            <button class="admin-btn admin-btn-secondary" onClick={plantilla}>⬇︎ Descargar plantilla CSV</button>
            <label class="admin-btn admin-btn-primary" style={{ cursor: 'pointer' }}>
              📄 Elegir archivo CSV
              <input type="file" accept=".csv,.txt,text/csv" onChange={elegir} hidden />
            </label>
            {fileName && <span class="muted small" style={{ fontWeight: 600 }}>{fileName}</span>}
          </div>
          {busy && <p class="muted small">Procesando archivo…</p>}
          {s && (
            <div class="result" style={{ marginTop: '12px' }}>
              <p style={{ margin: 0 }}>
                {s.products} productos ({s.sizes} presentaciones): <strong>{s.create} nuevos</strong>, <strong>{s.update} se actualizan</strong>
                {replace && <>, <strong class="err">{s.remove} se borran</strong>{s.remove ? ` (${s.removeNames.join(', ')}${s.remove > s.removeNames.length ? '…' : ''})` : ''}</>}.
              </p>
              {res.errors.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <p class="err"><strong>Corregí {res.errors.length} {res.errors.length === 1 ? 'error' : 'errores'} y volvé a elegir el archivo (no se importó nada):</strong></p>
                  <ul class="small" style={{ margin: '6px 0', paddingLeft: '20px' }}>{res.errors.slice(0, 30).map((e) => <li><strong>Línea {e.line}:</strong> {e.message}</li>)}</ul>
                  {res.errors.length > 30 && <p class="muted small">…y {res.errors.length - 30} más.</p>}
                </div>
              )}
              {res.warnings.length > 0 && (
                <details style={{ marginTop: '8px' }}><summary class="muted small">{res.warnings.length} {res.warnings.length === 1 ? 'aviso' : 'avisos'}</summary>
                  <ul class="small" style={{ margin: '6px 0', paddingLeft: '20px' }}>{res.warnings.slice(0, 30).map((w) => <li>Línea {w.line}: {w.message}</li>)}</ul>
                </details>
              )}
              {res.ignoredColumns?.length > 0 && <p class="muted small" style={{ marginTop: '6px' }}>Columnas que no se usan: {res.ignoredColumns.join(', ')}.</p>}
              {res.ok && (
                <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
                  <label class="admin-checkbox-label"><input type="checkbox" checked={replace} onChange={(e) => cambiarModo(e.target.checked)} /> Reemplazar todo: borrar los productos que no estén en el archivo</label>
                  <button class="admin-btn admin-btn-primary" onClick={importar} disabled={busy}>Importar {s.products} productos</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {msg.ok && <div class="admin-notice-ok">{msg.ok}</div>}
      {msg.err && <div class="admin-notice-err">{msg.err}</div>}
    </div>
  );
}

/* ==========================================================================
   SECCIÓN: PRODUCTOS
   ========================================================================== */
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

      <div class="admin-card-box">
        <h3>{editing ? 'Editar producto' : 'Agregar nuevo producto'}</h3>
        <form onSubmit={guardar} class="admin-grid-form">
          <label class="admin-field">SKU<input value={f.sku} onInput={set('sku')} placeholder="PINT-01" required /></label>
          <label class="admin-field">Nombre<input value={f.name} onInput={set('name')} placeholder="Látex Interior Mate" required /></label>
          <label class="admin-field">Categoría<input value={f.category} onInput={set('category')} placeholder="interior, exterior, humedad…" /></label>
          <label class="admin-field">Manos recomendadas<input type="number" min="1" max="4" value={f.coats} onInput={set('coats')} /></label>
          <label class="admin-field">Rendimiento por mano (m²/L)<input type="number" step="0.1" min="0.1" value={f.yield_m2_per_l} onInput={set('yield_m2_per_l')} required /></label>
          <label class="admin-field admin-col-full">Descripción<textarea rows="2" value={f.description} onInput={set('description')} placeholder="Breve resumen del producto…" /></label>
          <label class="admin-field admin-col-full">Ficha técnica (pasos de aplicación, preparación, advertencias)
            <textarea rows="4" value={f.tech_sheet} onInput={set('tech_sheet')} placeholder="Superficies recomendadas, tiempo de secado, dilución…" />
          </label>
          <div class="admin-col-full">
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '8px' }}>Presentaciones y precios (ARS)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {f.sizes.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input style={{ maxWidth: '140px' }} type="number" step="0.5" min="0.5" placeholder="Litros (ej: 4)" value={s.liters} onInput={(e) => setSize(i, 'liters', e.target.value)} />
                  <input style={{ maxWidth: '180px' }} type="number" step="1" min="0" placeholder="Precio $ ARS" value={s.price} onInput={(e) => setSize(i, 'price', e.target.value)} />
                  <button type="button" class="admin-btn-danger-outline" onClick={() => setF({ ...f, sizes: f.sizes.filter((_, j) => j !== i) })}>Quitar</button>
                </div>
              ))}
            </div>
            <button type="button" class="admin-btn admin-btn-secondary" style={{ marginTop: '10px' }} onClick={() => setF({ ...f, sizes: [...f.sizes, { liters: '', price: '' }] })}>+ Agregar presentación</button>
          </div>
          <div class="admin-col-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginTop: '6px' }}>
            <label class="admin-checkbox-label">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
              Visible para clientes
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button class="admin-btn admin-btn-primary">{editing ? 'Guardar cambios' : 'Agregar producto'}</button>
              {editing && <button type="button" class="admin-btn admin-btn-secondary" onClick={() => { setEditing(null); setF(EMPTY_PRODUCT); }}>Cancelar</button>}
            </div>
          </div>
        </form>
      </div>

      {err && <div class="admin-notice-err">{err}</div>}

      <div class="admin-table-wrapper">
        <table class="admin-data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Rendimiento</th>
              <th>Presentaciones</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((p) => (
              <tr class={p.active ? '' : 'off'}>
                <td><strong>{p.sku}</strong></td>
                <td>{p.name}</td>
                <td>{p.category}</td>
                <td>{p.yield_m2_per_l} m²/L</td>
                <td>{p.sizes.map((s) => `${s.liters} L ${pesos(s.price_cents)}`).join(' · ')}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: '6px' }}>
                    <button class="admin-btn-edit-outline" onClick={() => editar(p)}>Editar</button>
                    <button class="admin-btn-danger-outline" onClick={() => borrar(p)}>Borrar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <div class="admin-empty-state">Todavía no cargaste productos.</div>}
      </div>
    </section>
  );
}

/* ==========================================================================
   SECCIÓN: SUCURSALES
   ========================================================================== */
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
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '12px 16px', marginBottom: '18px', fontSize: '0.84rem', color: '#1e40af' }}>
        Cada sucursal puede tener su propio WhatsApp. Si cargás 2 o más, el cliente elige a cuál le manda el presupuesto.
        Si una sucursal no tiene número propio, se usa el de "Ajustes". Con una sola sucursal se usa directamente.
      </div>

      <div class="admin-card-box">
        <h3>{editing ? 'Editar sucursal' : 'Agregar nueva sucursal'}</h3>
        <form onSubmit={guardar} class="admin-grid-form">
          <label class="admin-field">Nombre<input value={f.name} onInput={set('name')} placeholder="Río Cuarto - Centro" required /></label>
          <label class="admin-field">Dirección<input value={f.address} onInput={set('address')} placeholder="San Martín 450" /></label>
          <label class="admin-field">WhatsApp<input value={f.whatsapp} onInput={set('whatsapp')} placeholder="5493584907406" inputmode="tel" /></label>
          <label class="admin-field">Orden<input type="number" min="0" max="999" value={f.position} onInput={set('position')} /></label>
          <div class="admin-col-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginTop: '4px' }}>
            <label class="admin-checkbox-label">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
              Visible para clientes
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button class="admin-btn admin-btn-primary">{editing ? 'Guardar cambios' : 'Agregar sucursal'}</button>
              {editing && <button type="button" class="admin-btn admin-btn-secondary" onClick={() => { setEditing(null); setF(EMPTY_BRANCH); }}>Cancelar</button>}
            </div>
          </div>
        </form>
      </div>

      {err && <div class="admin-notice-err">{err}</div>}

      <div class="admin-table-wrapper">
        <table class="admin-data-table">
          <thead>
            <tr>
              <th style={{ width: '60px' }}>Orden</th>
              <th>Nombre</th>
              <th>Dirección</th>
              <th>WhatsApp</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((b) => (
              <tr class={b.active ? '' : 'off'}>
                <td><strong>{b.position}</strong></td>
                <td>{b.name}</td>
                <td>{b.address}</td>
                <td>{b.whatsapp || <span class="muted">usa el de Ajustes</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: '6px' }}>
                    <button class="admin-btn-edit-outline" onClick={() => editar(b)}>Editar</button>
                    <button class="admin-btn-danger-outline" onClick={() => borrar(b)}>Borrar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <div class="admin-empty-state">Todavía no cargaste sucursales.</div>}
      </div>
    </section>
  );
}

/* ==========================================================================
   SECCIÓN: AJUSTES
   ========================================================================== */
function Settings() {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState({ ok: '', err: '' });
  useEffect(() => { api('/admin/settings').then(setF); }, []);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const guardar = async (e) => {
    e.preventDefault();
    try { await api('/admin/settings', { method: 'PUT', body: f }); setMsg({ ok: 'Ajustes guardados con éxito.', err: '' }); }
    catch (x) { setMsg({ ok: '', err: mensaje(x) }); }
  };

  return (
    <div class="admin-card-box" style={{ maxWidth: '720px' }}>
      <h3>Ajustes Generales del Negocio</h3>
      <form onSubmit={guardar} class="admin-grid-form">
        <label class="admin-field admin-col-full">Nombre del negocio<input value={f.name} onInput={set('name')} required /></label>
        <label class="admin-field admin-col-full">WhatsApp para presupuestos<input value={f.whatsapp} onInput={set('whatsapp')} placeholder="5491112345678" /></label>
        <label class="admin-field admin-col-full">Logo (URL https)<input value={f.logo_url} onInput={set('logo_url')} placeholder="https://..." /></label>
        <label class="admin-field admin-col-full">
          Color de marca
          <div class="admin-color-picker-group">
            <input class="admin-color-swatch-input" type="color" value={f.primary_color} onInput={set('primary_color')} />
            <input value={f.primary_color} onInput={set('primary_color')} placeholder="#1f6feb" />
          </div>
        </label>
        <div class="admin-col-full" style={{ marginTop: '8px' }}>
          <button class="admin-btn admin-btn-primary">Guardar ajustes</button>
        </div>
        {msg.ok && <div class="admin-col-full admin-notice-ok">{msg.ok}</div>}
        {msg.err && <div class="admin-col-full admin-notice-err">{msg.err}</div>}
      </form>
    </div>
  );
}

/* ==========================================================================
   SECCIÓN: CUENTA Y SEGURIDAD
   ========================================================================== */
function Account() {
  const [f, setF] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const guardar = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/password', { method: 'POST', body: f });
      setF({ current: '', next: '' }); setMsg({ ok: 'Contraseña actualizada con éxito.', err: '' });
    } catch (x) { setMsg({ ok: '', err: mensaje(x) }); }
  };

  return (
    <div class="admin-card-box" style={{ maxWidth: '480px' }}>
      <h3>Seguridad y Contraseña</h3>
      <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <label class="admin-field">
          Contraseña actual
          <input class="admin-input" type="password" value={f.current} onInput={set('current')} autocomplete="current-password" required />
        </label>
        <label class="admin-field">
          Contraseña nueva (mínimo 10 caracteres)
          <input class="admin-input" type="password" value={f.next} onInput={set('next')} minlength="10" autocomplete="new-password" required />
        </label>
        <div style={{ marginTop: '6px' }}>
          <button class="admin-btn admin-btn-primary">Cambiar contraseña</button>
        </div>
        {msg.ok && <div class="admin-notice-ok">{msg.ok}</div>}
        {msg.err && <div class="admin-notice-err">{msg.err}</div>}
      </form>
    </div>
  );
}
