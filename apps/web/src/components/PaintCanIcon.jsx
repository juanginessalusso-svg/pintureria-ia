const CATEGORY_COLORS = {
  interior: { paint: '#3b82f6', label: 'Interior' },
  exterior: { paint: '#10b981', label: 'Exterior' },
  esmalte: { paint: '#f59e0b', label: 'Esmalte' },
  antioxido: { paint: '#ea580c', label: 'Antióxido' },
  humedad: { paint: '#06b6d4', label: 'Humedad' },
  preparacion: { paint: '#8b5cf6', label: 'Preparación' },
};

export function PaintCanIcon({ category, size = 64 }) {
  const normCat = String(category || '').toLowerCase().trim();
  const theme = CATEGORY_COLORS[normCat] || { paint: 'var(--brand, #1f6feb)', label: 'Pintura' };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="paint-can-svg"
      aria-hidden="true"
    >
      {/* Sombra base */}
      <ellipse cx="32" cy="58" rx="20" ry="3.5" fill="#000" fillOpacity="0.1" />

      {/* Cuerpo de la lata */}
      <path
        d="M14 20 L16 54 Q16 57 32 57 Q48 57 50 54 L52 20 Z"
        fill="#e2e8f0"
        stroke="#64748b"
        strokeWidth="1.5"
      />

      {/* Franja de color / pintura derramada */}
      <path
        d="M15 28 Q24 33 32 29 Q40 25 49 28 L50 46 Q40 50 32 48 Q24 46 16 46 Z"
        fill={theme.paint}
      />

      {/* Reflejo brillante de la lata */}
      <path
        d="M19 23 L20 52"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeOpacity="0.7"
      />

      {/* Aro metálico superior */}
      <ellipse cx="32" cy="20" rx="19" ry="5.5" fill="#f8fafc" stroke="#475569" strokeWidth="1.5" />
      <ellipse cx="32" cy="20" rx="15" ry="3.8" fill={theme.paint} stroke="#334155" strokeWidth="1" />

      {/* Manija de alambre */}
      <path
        d="M13 24 C13 7 51 7 51 24"
        stroke="#94a3b8"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="13" cy="24" r="2" fill="#475569" />
      <circle cx="51" cy="24" r="2" fill="#475569" />
    </svg>
  );
}
