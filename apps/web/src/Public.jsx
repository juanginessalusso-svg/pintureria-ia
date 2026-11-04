import { useEffect, useState } from 'preact/hooks';

// Placeholder: acá va el visualizador (etapa C) y el asesor (etapa G).
export function Public() {
  const [t, setT] = useState(null);
  const tenant = new URLSearchParams(location.search).get('tenant');
  useEffect(() => {
    fetch('/api/public/tenant' + (tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''))
      .then((r) => (r.ok ? r.json() : null))
      .then(setT)
      .catch(() => setT(null));
  }, []);
  return (
    <main class="wrap">
      <h1>{t ? t.name : 'Visualizador de color'}</h1>
      <p class="muted">Próximamente: probá colores en tu casa y consultá al asesor.</p>
      <p><a href="/admin">Panel de administración</a></p>
    </main>
  );
}
