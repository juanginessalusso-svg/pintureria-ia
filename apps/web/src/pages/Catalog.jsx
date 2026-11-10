import { useState, useEffect } from 'preact/hooks';
import { tenantHref, tenantQuery } from '../tenant.js';
import { PaintCanIcon } from '../components/PaintCanIcon.jsx';
import { pesos } from '@pintureria/core';

export function Catalog() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('todas');

  useEffect(() => {
    fetch(`/api/public/products${tenantQuery()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setProducts(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const categories = ['todas', ...new Set(products.map((p) => p.category).filter(Boolean))];

  const formatCatName = (c) => {
    if (c === 'todas') return 'Todos';
    return c.charAt(0).toUpperCase() + c.slice(1);
  };

  const filtered = products.filter((p) => {
    const matchesCat = category === 'todas' || p.category === category;
    const q = query.trim().toLowerCase();
    const matchesQ =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q));
    return matchesCat && matchesQ;
  });

  return (
    <div className="catalog-claude-page">
      {/* Encabezado del catálogo con estilo Claude */}
      <section className="catalog-claude-hero">
        <div className="catalog-claude-inner">
          <div className="catalog-claude-left">
            <span className="section-eyebrow">CATÁLOGO</span>
            <h1 className="catalog-claude-title">Pinturas para cada superficie</h1>
            <p className="catalog-claude-subtitle">
              Cada producto indica cuántos metros cuadrados rinde un litro, así sabés qué llevar.
            </p>

            <div className="catalog-claude-search-box">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="search-icon">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="search"
                placeholder="Buscar por nombre o descripción..."
                value={query}
                onInput={(e) => setQuery(e.target.value)}
                className="catalog-claude-input"
              />
            </div>

            {categories.length > 1 && (
              <div className="catalog-claude-pills">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`catalog-pill-btn ${category === c ? 'active' : ''}`}
                    onClick={() => setCategory(c)}
                  >
                    {formatCatName(c)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="catalog-claude-right">
            <div className="wob catalog-blob-decor"></div>
          </div>
        </div>
      </section>

      {/* Grilla de productos */}
      <section className="catalog-products-container">
        {loading ? (
          <p className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>Cargando catálogo...</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>No se encontraron productos con ese criterio de búsqueda.</p>
          </div>
        ) : (
          <div className="products-grid">
            {filtered.map((p) => {
              const minPrice = p.sizes?.length
                ? Math.min(...p.sizes.map((s) => s.price_cents).filter((pr) => pr > 0))
                : 0;

              return (
                <a key={p.id || p.sku} href={tenantHref(`/productos/${p.sku}`)} className="product-card">
                  <div className="product-thumb">
                    <PaintCanIcon category={p.category} size={70} />
                    {p.category && <span className="product-cat-tag">{p.category}</span>}
                  </div>
                  <div className="product-info">
                    <h3 className="product-title">{p.name}</h3>
                    {p.yield_m2_per_l > 0 && (
                      <span className="product-meta">Rendimiento: {p.yield_m2_per_l} m²/L</span>
                    )}
                    <div className="product-price-row">
                      {minPrice > 0 ? (
                        <span className="product-price">Desde {pesos(minPrice)}</span>
                      ) : (
                        <span className="product-price-consult">Consultar precio</span>
                      )}
                      <span className="btn-view">Ver opciones →</span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
