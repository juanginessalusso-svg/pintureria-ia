import { useState } from 'preact/hooks';
import { tenantHref } from '../tenant.js';

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
  const wallColor = SWATCH_COLORS[selectedWallIdx].hex;

  const shopName = tenant?.name || 'Plaza Olmos';
  const accent = '#D9442B';

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
            <p className="hi d3 claude-hero-subtitle">
              Subí una foto de tu pared, probá colores antes de abrir la lata y te decimos cuántos litros llevar.
            </p>

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

      {/* 4. NOSOTROS CON FOTO DEL LOCAL Y LOGO */}
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
