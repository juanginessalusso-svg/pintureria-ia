import { useState } from 'preact/hooks';
import { ASSISTANT_CASES } from '../assistantData.js';

export function TechnicalAssistant() {
  const [selectedCategory, setSelectedCategory] = useState('patologias'); // 'patologias', 'superficies', 'all'
  const [selectedId, setSelectedId] = useState(ASSISTANT_CASES[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = ASSISTANT_CASES.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesQuery =
      searchQuery.trim() === '' ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.solution.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  const selectedItem =
    filteredItems.find((it) => it.id === selectedId) ||
    filteredItems[0] ||
    ASSISTANT_CASES[0];

  const patologiasCount = ASSISTANT_CASES.filter((c) => c.category === 'patologias').length;
  const superficiesCount = ASSISTANT_CASES.filter((c) => c.category === 'superficies').length;

  return (
    <div className="assistant-page">
      {/* Header Banner */}
      <section className="assistant-hero">
        <div className="assistant-hero-container">
          <span className="section-eyebrow light">CENTRO DE DIAGNÓSTICO PROFESIONAL</span>
          <h1 className="assistant-title">Asistente Técnico</h1>
          <p className="assistant-subtitle">
            En esta sección encontrarás todos los problemas que afectan las superficies y las soluciones exactas sobre cómo tratarlas antes de pintar.
          </p>

          {/* Buscador en tiempo real */}
          <div className="assistant-search-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Buscar caso (ej: yeso muerto, humedad, alcalinidad, óxido, chapa, melamina...)"
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.target.value)}
              className="assistant-search-input"
            />
            {searchQuery && (
              <button
                className="assistant-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Selector de Categorías */}
      <div className="assistant-tabs-wrapper">
        <div className="assistant-tabs">
          <button
            className={`assistant-tab ${selectedCategory === 'patologias' ? 'active' : ''}`}
            onClick={() => {
              setSelectedCategory('patologias');
              const first = ASSISTANT_CASES.find((c) => c.category === 'patologias');
              if (first) setSelectedId(first.id);
            }}
          >
            🔍 Patologías ({patologiasCount})
          </button>
          <button
            className={`assistant-tab ${selectedCategory === 'superficies' ? 'active' : ''}`}
            onClick={() => {
              setSelectedCategory('superficies');
              const first = ASSISTANT_CASES.find((c) => c.category === 'superficies');
              if (first) setSelectedId(first.id);
            }}
          >
            🧱 Superficies Difíciles ({superficiesCount})
          </button>
          <button
            className={`assistant-tab ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            Todos los Casos ({ASSISTANT_CASES.length})
          </button>
        </div>
      </div>

      {/* Contenedor Principal: Directorio Lateral + Ficha Técnica */}
      <div className="assistant-main-container">
        {/* Barra Lateral / Directorio Completo */}
        <aside className="assistant-sidebar">
          <div className="assistant-sidebar-head">
            <h3 className="assistant-sidebar-title">
              {selectedCategory === 'patologias'
                ? 'Patologías'
                : selectedCategory === 'superficies'
                ? 'Superficies Difíciles'
                : 'Directorio de Casos'}
            </h3>
            <span className="assistant-badge-count">{filteredItems.length} casos</span>
          </div>

          <div className="assistant-items-list">
            {filteredItems.length === 0 ? (
              <p className="assistant-no-results">No se encontraron casos con ese criterio de búsqueda.</p>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    className={`assistant-item-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedId(item.id);
                      if (window.innerWidth < 860) {
                        document.getElementById('assistant-detail-view')?.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                  >
                    <div className="assistant-item-header">
                      <span className={`assistant-category-badge ${item.category}`}>
                        {item.category === 'patologias' ? 'Patología' : 'Superficie'}
                      </span>
                    </div>
                    <strong className="assistant-item-name">{item.title}</strong>
                    <p className="assistant-item-summary">{item.shortDesc}</p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Ficha Técnica Detallada */}
        <section id="assistant-detail-view" className="assistant-detail-card">
          {selectedItem ? (
            <article>
              <div className="assistant-detail-top">
                <span className={`assistant-category-badge ${selectedItem.category}`}>
                  {selectedItem.category === 'patologias' ? 'Patologías' : 'Superficies Difíciles de Pintar'}
                </span>
                <h2 className="assistant-detail-title">/ {selectedItem.title}</h2>
              </div>

              {selectedItem.image && (
                <div className="assistant-detail-img-wrap">
                  <img
                    src={selectedItem.image}
                    alt={`Fotografía real de ${selectedItem.title}`}
                    className="assistant-detail-img"
                    loading="lazy"
                  />
                </div>
              )}

              {/* SECCIÓN DESCRIPCIÓN */}
              <div className="assistant-section-box">
                <h3 className="assistant-section-heading">
                  <span className="dot-icon orange"></span> DESCRIPCIÓN
                </h3>
                <div className="assistant-text-content">
                  {selectedItem.description
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((p, i) => (
                      <p key={i} className="assistant-desc-text">
                        {p}
                      </p>
                    ))}
                </div>
              </div>

              {/* SECCIÓN SOLUCIONES */}
              <div className="assistant-section-box highlight-solution">
                <h3 className="assistant-section-heading">
                  <span className="dot-icon green"></span> SOLUCIONES
                </h3>
                <div className="assistant-text-content">
                  {selectedItem.solution
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((p, i) => (
                      <p key={i} className="assistant-sol-text">
                        {p}
                      </p>
                    ))}
                </div>
              </div>
            </article>
          ) : (
            <div className="assistant-empty-state">
              <p>Seleccioná un caso de la lista para ver su descripción y solución técnica.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
