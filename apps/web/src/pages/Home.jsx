import { useState } from 'preact/hooks';
import { tenantHref } from '../tenant.js';

const OFFICIAL_BRANCHES = [
  {
    id: 1,
    city: 'Río Cuarto',
    address: 'Marcelo T. de Alvear 560',
    phone: '0358 464-5765',
    phoneClean: '03584645765',
    whatsapp: '5493584645765',
  },
  {
    id: 2,
    city: 'Río Cuarto',
    address: 'San Martín 2079',
    phone: '0358 15577-6669',
    phoneClean: '0358155776669',
    whatsapp: '5493585776669',
  },
  {
    id: 3,
    city: 'Río Cuarto',
    address: 'Hipólito Irigoyen 643',
    phone: '0358 462-2371',
    phoneClean: '03584622371',
    whatsapp: '5493584622371',
  },
  {
    id: 4,
    city: 'Río Cuarto',
    address: 'H. Primo esq. General Paz',
    phone: '0358 465-2117',
    phoneClean: '03584652117',
    whatsapp: '5493584652117',
  },
  {
    id: 5,
    city: 'Río Cuarto',
    address: 'Av. Sabattini 2137',
    phone: '0358 464-4904',
    phoneClean: '03584644904',
    whatsapp: '5493584644904',
  },
  {
    id: 6,
    city: 'Chivilcoy',
    address: 'Av. Sarmiento 157',
    phone: '02346 43-6192',
    phoneClean: '02346436192',
    whatsapp: '5492346436192',
  },
  {
    id: 7,
    city: 'Chivilcoy',
    address: 'Av. José León Suárez 242',
    phone: '02346 43-6192',
    phoneClean: '02346436192',
    whatsapp: '5492346436192',
  },
];

const SWATCH_COLORS = [
  { name: 'Arena', hex: '#E6D5B8', img: '/assets/living-arena.jpg' },
  { name: 'Terracota', hex: '#C8573A', img: '/assets/living-terracota.jpg' },
  { name: 'Salvia', hex: '#9DB59A', img: '/assets/living-salvia.jpg' },
  { name: 'Cielo', hex: '#8FB7DB', img: '/assets/living-cielo.jpg' },
  { name: 'Mostaza', hex: '#E2B04A', img: '/assets/living-mostaza.jpg' },
  { name: 'Ciruela', hex: '#7B4B6A', img: '/assets/living-ciruela.jpg' },
];

const BLOBS = [
  '58% 42% 55% 45% / 50% 55% 45% 50%',
  '45% 55% 42% 58% / 56% 44% 56% 44%',
  '52% 48% 60% 40% / 44% 56% 44% 56%',
  '40% 60% 50% 50% / 55% 45% 55% 45%',
];

export function Home({ tenant, branches = [] }) {
  const [selectedWallIdx, setSelectedWallIdx] = useState(2); // Salvia por defecto
  const [selectedCity, setSelectedCity] = useState('rio-cuarto');
  const wallColor = SWATCH_COLORS[selectedWallIdx].hex;

  const shopName = tenant?.name || 'Plaza Olmos';
  const accent = '#D9442B';

  const branchList = (branches && branches.length >= 7) ? branches : OFFICIAL_BRANCHES;
  const filteredBranches = branchList.filter(b => {
    const c = (b.city || '').toLowerCase();
    if (selectedCity === 'chivilcoy') return c.includes('chivilcoy');
    return c.includes('cuarto');
  });

  const rioCuartoCount = branchList.filter(b => (b.city || '').toLowerCase().includes('cuarto')).length;
  const chivilcoyCount = branchList.filter(b => (b.city || '').toLowerCase().includes('chivilcoy')).length;

  return (
    <div className="home-claude">
      {/* 1. PORTADA ORIGINAL DE CLAUDE */}
      <section className="claude-hero">
        <div className="claude-hero-container">
          <div className="claude-hero-left">
            <p className="hi d1 claude-hero-eyebrow">
              <span className="claude-accent-bar"></span>
              Pinturerías en Río Cuarto y Chivilcoy
            </p>
            <h1 className="hi d2 claude-hero-title">
              Pintá con el{' '}
              <span className="hero-title-highlight">
                color justo
                <svg viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true" className="title-brush-svg">
                  <path d="M4 10 C70 4, 140 16, 210 8 S280 6, 296 11" stroke="#D9442B" stroke-width="9" strokeWidth="9" strokeLinecap="round" fill="none" />
                </svg>
              </span>.
            </h1>
          </div>

          <div className="hi d2 claude-hero-right">
            <svg viewBox="0 0 560 560" role="img" aria-label="Una pared en arco pintada hasta la mitad con un rodillo" className="hero-arch-svg">
              <defs>
                <clipPath id="archClip">
                  <path d="M146 90 H414 a16 16 0 0 1 16 16 V320 a150 150 0 0 1 -300 0 V106 a16 16 0 0 1 16 -16 Z" />
                </clipPath>
              </defs>
              <path className="blobp" d="M90 140 C60 40, 230 -10, 340 30 C470 70, 560 160, 530 300 C505 430, 420 540, 290 535 C150 530, 40 470, 30 340 C20 250, 110 230, 90 140 Z" fill="#1E3A62" />
              <g clipPath="url(#archClip)">
                <rect x="120" y="80" width="320" height="400" fill="#F3EDE2" />
                <rect x="162" y="160" width="74" height="92" rx="4" fill="#FFFFFF" stroke="#D9D0BF" strokeWidth="3" />
                <circle cx="190" cy="190" r="11" fill="#E2B04A" />
                <path d="M168 246 L196 214 L214 230 L230 208 V246 Z" fill="#1E3A62" />
                <path d="M300 80 C268 140, 332 182, 296 240 C262 300, 324 342, 290 400 C272 440, 302 468, 286 480 L440 480 L440 80 Z" fill={accent} />
                <rect x="338" y="100" width="22" height="300" rx="11" fill="#FFFFFF" opacity="0.13" />
              </g>
              <g className="roll">
                <rect x="248" y="222" width="104" height="34" rx="17" fill="#F3EDE2" stroke="#152B4B" strokeWidth="3" />
                <path d="M352 239 H376 a10 10 0 0 1 10 10 V272" stroke="#152B4B" strokeWidth="5" fill="none" strokeLinecap="round" />
                <rect x="380" y="272" width="12" height="62" rx="6" fill="#FFFFFF" stroke="#152B4B" strokeWidth="3" />
              </g>
              <circle className="fl fl1" cx="110" cy="440" r="44" fill="#9DB59A" stroke="#F7F4EE" strokeWidth="5" />
              <circle className="fl fl2" cx="468" cy="86" r="28" fill="#E2B04A" stroke="#F7F4EE" strokeWidth="5" />
              <circle className="fl fl3" cx="486" cy="430" r="38" fill="#8FB7DB" stroke="#F7F4EE" strokeWidth="5" />
            </svg>
          </div>
        </div>
      </section>

      {/* 2. SIMULADOR INTERACTIVO */}
      <section id="simulador" className="simulador-section">
        <svg viewBox="0 0 1440 56" preserveAspectRatio="none" aria-hidden="true" className="wave-top-svg">
          <path d="M0 0 H1440 V30 C1320 6 1200 54 1060 30 S780 6 640 32 S340 54 200 28 S60 12 0 30 Z" fill="#F7F4EE" />
        </svg>

        <div className="simulador-container">
          <div className="simulador-display">
            <div className="simulador-room-box" style={{ padding: 0, overflow: 'hidden', background: '#0F1E36', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img
                src={SWATCH_COLORS[selectedWallIdx].img}
                alt={`Living real con pared color ${SWATCH_COLORS[selectedWallIdx].name}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '24px' }}
              />
            </div>
          </div>

          <div className="simulador-controls">
            <span className="section-eyebrow light">SIMULADOR DE COLOR</span>
            <h2 className="simulador-title">Probá antes de pintar</h2>
            <p className="simulador-subtitle">
              Elegí un tono y mirá cómo cambia la pared. Con la foto de tu casa, la inteligencia artificial detecta la pared automáticamente.
            </p>

            <div className="swatches-grid">
              {SWATCH_COLORS.map((sw, i) => (
                <button
                  key={sw.name}
                  type="button"
                  className={`swb ${i === selectedWallIdx ? 'selected' : ''}`}
                  onClick={() => setSelectedWallIdx(i)}
                  aria-label={`Color ${sw.name}`}
                >
                  <span
                    className="sws"
                    style={{
                      backgroundColor: sw.hex,
                      borderRadius: BLOBS[i % BLOBS.length],
                    }}
                  >
                    {i === selectedWallIdx && <span className="sw-check-ring" />}
                  </span>
                  <span className="sw-name">{sw.name}</span>
                </button>
              ))}
            </div>


          </div>
        </div>

        {/* Gotas de pintura decorativas */}
        <svg viewBox="0 0 1440 90" aria-hidden="true" className="drip-bottom-svg">
          <path className="drip drip1" d="M236 -2 V62 a14 14 0 0 0 28 0 V-2 Z" fill="#1E3A62" />
          <path className="drip drip2" d="M690 -2 V76 a18 18 0 0 0 36 0 V-2 Z" fill="#1E3A62" />
          <path className="drip drip3" d="M1120 -2 V42 a12 12 0 0 0 24 0 V-2 Z" fill="#1E3A62" />
        </svg>
      </section>

      {/* SECCIÓN RENOVACIÓN & EVOLUCIÓN */}
      <section className="renovation-section">
        <div className="renovation-container">
          <div className="renovation-badge-col">
            <div className="renovation-seal">
              <svg viewBox="0 0 100 100" className="renovation-seal-svg">
                <path
                  id="sealPath"
                  d="M 50, 50 m -37, 0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0"
                  fill="none"
                />
                <text className="seal-text">
                  <textPath href="#sealPath" startOffset="0%">
                    DISEÑO E INNOVACIÓN • CALIDAD PROFESIONAL •
                  </textPath>
                </text>
              </svg>
              <div className="seal-center-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="renovation-content-col">
            <div className="renovation-headline-block">
              <h2 className="renovation-title">
                Evolucionamos para transformar tus ideas
              </h2>
              <div className="renovation-sub-row">
                <span className="renovation-tag">NOS RENOVAMOS</span>
                <span className="renovation-line"></span>
              </div>
            </div>

            <div className="renovation-body">
              <p className="renovation-lead">
                Nos hemos reinventado para estar a la vanguardia del diseño, la tecnología y el asesoramiento especializado.
              </p>
              <p className="renovation-text">
                Preparate para que tus espacios cobren vida con colores vibrantes, máxima durabilidad y herramientas digitales pensadas para facilitarte cada etapa de tu proyecto.
              </p>

              <div className="renovation-features-row">
                <div className="renov-feat-item">
                  <div className="feat-bullet blue"></div>
                  <div>
                    <strong>Fórmulas y Colores</strong>
                    <span>Pigmentación superior y alto poder cubritivo.</span>
                  </div>
                </div>
                <div className="renov-feat-item">
                  <div className="feat-bullet orange"></div>
                  <div>
                    <strong>Tecnología Digital</strong>
                    <span>Probador virtual de ambientes y cálculo de litros.</span>
                  </div>
                </div>
                <div className="renov-feat-item">
                  <div className="feat-bullet green"></div>
                  <div>
                    <strong>Asistencia Técnica</strong>
                    <span>Diagnóstico de patologías de paredes al instante.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. CÓMO FUNCIONA */}
      <section className="how-it-works-section">
        <div className="how-container">
          <div className="how-header">
            <span className="section-eyebrow">CÓMO FUNCIONA</span>
            <h2 className="how-title">Del color al pedido, sin vueltas</h2>
          </div>

          <div className="how-steps-wrapper">
            <svg className="wave" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
              <path d="M60 60 C250 -10, 350 120, 600 60 S950 0, 1140 70" stroke="#1E3A62" strokeOpacity="0.28" strokeWidth="3" strokeDasharray="2 12" strokeLinecap="round" fill="none" />
            </svg>

            <div className="how-steps-grid">
              <div className="how-step-card">
                <div className="wob step-icon-blob blue">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="14" height="6" rx="2" />
                    <path d="M17 7h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-7a1 1 0 0 0-1 1v2" />
                    <rect x="10" y="15" width="3" height="6" rx="1" />
                  </svg>
                </div>
                <span className="step-num">01</span>
                <h3 className="step-title">Probá el color</h3>
                <p className="step-desc">Subí una foto y mirá cómo queda cada tono en tu propia pared.</p>
              </div>

              <div className="how-step-card st2">
                <div className="wob wob2 step-icon-blob orange">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 17 L17 3 L21 7 L7 21 Z" />
                    <path d="M8 12l2 2M11 9l2 2M14 6l2 2" />
                  </svg>
                </div>
                <span className="step-num">02</span>
                <h3 className="step-title">Calculá litros y latas</h3>
                <p className="step-desc">Medí tus paredes y armamos la combinación más económica para no gastar de más.</p>
              </div>

              <div className="how-step-card">
                <div className="wob wob3 step-icon-blob blue">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
                    <path d="M9 10.5c.5 2 2.5 4 4.5 4.5l1.3-1.3-1.8-1-.9.7c-.8-.4-1.5-1.1-1.9-1.9l.7-.9-1-1.8Z" />
                  </svg>
                </div>
                <span className="step-num">03</span>
                <h3 className="step-title">Pedí por WhatsApp</h3>
                <p className="step-desc">Mandá el presupuesto a tu sucursal más cercana y coordiná retiro o entrega.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. SUCURSALES */}
      <section id="sucursales" className="branches-section">
        <div className="branches-container">
          <div className="branches-header">
            <span className="section-eyebrow">PUNTOS DE ATENCIÓN</span>
            <h2 className="branches-title">Nuestras Sucursales</h2>

            {/* Selector de Ciudad: Río Cuarto o Chivilcoy */}
            <div className="branches-city-tabs" role="tablist" aria-label="Filtrar sucursales por ciudad">
              <button
                type="button"
                role="tab"
                aria-selected={selectedCity === 'rio-cuarto'}
                className={`branches-city-tab ${selectedCity === 'rio-cuarto' ? 'active' : ''}`}
                onClick={() => setSelectedCity('rio-cuarto')}
              >
                <span className="city-pill-dot blue"></span>
                Río Cuarto ({rioCuartoCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedCity === 'chivilcoy'}
                className={`branches-city-tab ${selectedCity === 'chivilcoy' ? 'active' : ''}`}
                onClick={() => setSelectedCity('chivilcoy')}
              >
                <span className="city-pill-dot orange"></span>
                Chivilcoy ({chivilcoyCount})
              </button>
            </div>

            {/* Tira informativa de horario */}
            <div className="branches-schedule-strip">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span><strong>Horario:</strong> Lun a Vie de 8:00 a 17:00 hs</span>
            </div>
          </div>

          <div className={`branches-compact-grid ${filteredBranches.length <= 2 ? 'few-cards' : ''}`}>
            {filteredBranches.map((b) => {
              const cleanWa = (b.whatsapp || b.phoneClean || b.phone || '').replace(/\D/g, '');
              const waUrl = cleanWa
                ? `https://wa.me/${cleanWa}?text=${encodeURIComponent(`Hola Plaza Olmos (${b.address}), quisiera hacer una consulta.`)}`
                : null;
              const mapsQuery = encodeURIComponent(`Plaza Olmos Pinturería ${b.address}`);
              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
              const isChivilcoy = (b.city || '').toLowerCase().includes('chivilcoy');

              return (
                <div key={b.id || b.address} className={`branch-card-compact ${isChivilcoy ? 'theme-chivilcoy' : 'theme-rc'}`}>
                  <div className="bcc-top-bar">
                    <span className="bcc-city-tag">
                      <span className="bcc-indicator"></span>
                      {b.city || (isChivilcoy ? 'Chivilcoy' : 'Río Cuarto')}
                    </span>
                    <a
                      href={`tel:${(b.phoneClean || b.phone || '').replace(/\D/g, '')}`}
                      className="bcc-phone-badge"
                      title="Llamar directo"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <span>{b.phone}</span>
                    </a>
                  </div>

                  <div className="bcc-main-info">
                    <div className="bcc-pin-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </div>
                    <h3 className="bcc-address-text">{b.address.replace(', Río Cuarto', '').replace(', Chivilcoy', '')}</h3>
                  </div>

                  <div className="bcc-actions-row">
                    {waUrl && (
                      <a href={waUrl} target="_blank" rel="noopener noreferrer" className="btn-bcc-whatsapp">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.52 3.48A11.93 11.93 0 0 0 12.06 0C5.46 0 .09 5.37.09 11.97c0 2.11.55 4.16 1.6 5.97L0 24l6.22-1.63a11.9 11.9 0 0 0 5.84 1.51h.01c6.6 0 11.97-5.37 11.97-11.97 0-3.2-1.25-6.21-3.52-8.43zm-8.46 18.4h-.01a9.92 9.92 0 0 1-5.06-1.39l-.36-.22-3.76.99 1-3.66-.24-.38a9.92 9.92 0 0 1-1.53-5.25c0-5.48 4.46-9.94 9.95-9.94 2.66 0 5.16 1.04 7.03 2.92a9.9 9.9 0 0 1 2.92 7.03c0 5.49-4.46 9.95-9.94 9.95zm5.45-7.46c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.18-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.64-.93-2.25-.24-.59-.49-.51-.68-.52-.18-.01-.38-.01-.58-.01-.2 0-.53.08-.8.38-.28.3-1.06 1.04-1.06 2.53s1.08 2.94 1.23 3.14c.15.2 2.13 3.25 5.15 4.56.72.31 1.28.5 1.72.64.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z"/>
                        </svg>
                        <span>WhatsApp</span>
                      </a>
                    )}
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-bcc-maps">
                      <span>Ver mapa</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. NOSOTROS CON FOTO DEL LOCAL Y LOGO */}
      <section id="nosotros" className="about-section">
        <svg viewBox="0 0 1440 56" preserveAspectRatio="none" aria-hidden="true" className="wave-about-top">
          <path d="M0 0 H1440 V26 C1300 56 1180 6 1040 30 S760 52 620 26 S340 4 200 30 S60 40 0 22 Z" fill="#F7F4EE" />
        </svg>

        <div className="about-container">
          <div className="about-media">
            <div className="about-image-wrapper">
              <img
                className="wob about-store-img"
                src="/assets/local-fachada.png"
                alt={`Fachada de ${shopName}`}
              />
              <div className="wob wob2 about-dot-blob"></div>
              <img
                src="/assets/plaza-olmos-logo.png"
                alt={`Logo de ${shopName}`}
                className="about-logo-badge"
              />
            </div>
          </div>

          <div className="about-content">
            <span className="section-eyebrow">{shopName}</span>
            <h2 className="about-title">Asesoramiento de pinturería, ahora también online</h2>
            <p className="about-text">
              Pinturas y revestimientos con atención profesional, en locales de Río Cuarto y Chivilcoy.
            </p>
            <p className="about-text">
              Elegí el color desde tu casa, calculá cuánta pintura necesitás y retirá o recibí tu pedido desde la sucursal más cercana.
            </p>
            <div style={{ marginTop: '28px' }}>
              <a href={tenantHref('/productos')} className="btn-modern-catalog">
                <span>Ver catálogo completo</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
