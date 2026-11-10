import { tenantHref } from '../tenant.js';

export function NotFound() {
  return (
    <div className="wrap not-found-page">
      <div className="not-found-card">
        <h1>404</h1>
        <h2>Página no encontrada</h2>
        <p className="muted">La sección que estás buscando no existe o fue movida.</p>
        <a href={tenantHref('/')} className="btn primary">
          Volver al Inicio
        </a>
      </div>
    </div>
  );
}
