import { useLocation } from 'preact-iso';
import { useCart } from '../cartState.js';
import { tenantHref } from '../tenant.js';

export function Header({ tenant }) {
  const { path } = useLocation();
  const { totals } = useCart();

  const isCatalog = path.startsWith('/productos');
  const isVisualizer = path.startsWith('/visualizador');
  const isAssistant = path.startsWith('/asistente-tecnico');
  const isCart = path.startsWith('/carrito');

  // Si el nombre tiene dos palabras, las apilamos como PLAZA / OLMOS
  const rawName = (tenant?.name || 'Plaza Olmos').trim();
  const parts = rawName.split(' ');
  const line1 = parts[0]?.toUpperCase() || 'PLAZA';
  const line2 = parts.slice(1).join(' ').toUpperCase() || 'OLMOS';

  return (
    <header className="claude-header">
      <div className="claude-header-inner">
        <a href={tenantHref('/')} aria-label={`${rawName}, inicio`} className="claude-logo-link">
          <span className="logo-line">{line1}</span>
          <span className="logo-line">{line2}</span>
        </a>

        <nav className="claude-nav">
          <a
            href={tenantHref('/productos')}
            className={`claude-nav-link ${isCatalog ? 'active' : ''}`}
          >
            Catálogo
          </a>
          <a
            href={tenantHref('/visualizador')}
            className={`claude-nav-link ${isVisualizer ? 'active' : ''}`}
          >
            Probar Color
          </a>
          <a
            href={tenantHref('/asistente-tecnico')}
            className={`claude-nav-link ${isAssistant ? 'active' : ''}`}
          >
            Asistente Técnico
          </a>
          <a
            href={tenantHref('/carrito')}
            aria-label="Carrito de compras"
            className={`claude-cart-btn ${isCart ? 'active' : ''}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20 8H6.2" />
              <circle cx="9.5" cy="20" r="1.4" />
              <circle cx="17" cy="20" r="1.4" />
            </svg>
            {totals.count > 0 && <span className="claude-cart-badge">{totals.count}</span>}
          </a>
        </nav>
      </div>
    </header>
  );
}
