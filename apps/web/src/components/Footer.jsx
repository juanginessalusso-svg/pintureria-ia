import { tenantHref } from '../tenant.js';

export function Footer({ tenant }) {
  const currentYear = new Date().getFullYear();
  const rawName = (tenant?.name || 'Plaza Olmos').trim();
  const parts = rawName.split(' ');
  const line1 = parts[0]?.toUpperCase() || 'PLAZA';
  const line2 = parts.slice(1).join(' ').toUpperCase() || 'OLMOS';

  return (
    <footer className="claude-footer">
      <svg viewBox="0 0 1440 56" preserveAspectRatio="none" aria-hidden="true" className="claude-footer-wave">
        <path d="M0 0 H1440 V28 C1300 54 1190 4 1050 30 S780 52 640 26 S360 6 220 30 S70 46 0 24 Z" fill="#E8EDF4" />
      </svg>
      <div className="claude-footer-inner">
        <div className="claude-footer-left">
          <div className="claude-footer-logo">
            <span className="logo-line">{line1}</span>
            <span className="logo-line">{line2}</span>
          </div>
          <p className="claude-footer-text">
            Asesoramiento profesional en pinturas y revestimientos. Probá tus colores en tiempo real con inteligencia artificial.
          </p>
        </div>
      </div>
      <div className="claude-footer-bottom">
        <p className="claude-footer-copyright">
          © {currentYear} {rawName}. Todos los derechos reservados.
        </p>
      </div>
    </footer>
  );
}
