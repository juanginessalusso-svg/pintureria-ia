import { useState, useEffect } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { tenantHref, tenantQuery } from '../tenant.js';
import { useCart } from '../cartState.js';
import { PaintCanIcon } from '../components/PaintCanIcon.jsx';
import { pesos } from '@pintureria/core';

export function ProductDetail() {
  const route = useRoute();
  const sku = route.params.sku;
  const { add } = useCart();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState(null);
  const [qty, setQty] = useState(1);
  const [addedNotice, setAddedNotice] = useState(false);

  useEffect(() => {
    fetch(`/api/public/products${tenantQuery()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const found = data.find((p) => p.sku === sku);
        setProduct(found || null);
        if (found?.sizes?.length) {
          setSelectedSize(found.sizes[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sku]);

  if (loading) return <div className="wrap"><p className="muted">Cargando producto...</p></div>;
  if (!product) {
    return (
      <div className="wrap empty-state">
        <h2>Producto no encontrado</h2>
        <p>No pudimos encontrar el producto solicitado.</p>
        <a href={tenantHref('/productos')} className="btn primary">Volver al catálogo</a>
      </div>
    );
  }

  const handleAddToCart = () => {
    if (!selectedSize) return;
    add({
      sku: product.sku,
      name: product.name,
      liters: selectedSize.liters,
      unit_price_cents: selectedSize.price_cents,
      qty: Math.max(1, qty),
    });
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 3000);
  };

  return (
    <div className="wrap product-detail-page">
      <div className="breadcrumb">
        <a href={tenantHref('/productos')}>← Volver al catálogo</a>
      </div>

      <div className="product-detail-grid">
        <div className="product-detail-media">
          <div className="product-image-box">
            <PaintCanIcon category={product.category} size={150} />
          </div>
        </div>

        <div className="product-detail-info">
          {product.category && <span className="badge-cat">{product.category}</span>}
          <h1 className="product-detail-title">{product.name}</h1>
          <span className="product-sku muted">SKU: {product.sku}</span>

          {product.description && (
            <p className="product-detail-desc">{product.description}</p>
          )}

          <div className="product-specs">
            {product.yield_m2_per_l > 0 && (
              <div className="spec-item">
                <span className="spec-label">Rendimiento:</span>
                <span className="spec-value">{product.yield_m2_per_l} m² por litro</span>
              </div>
            )}
            {product.coats > 0 && (
              <div className="spec-item">
                <span className="spec-label">Manos sugeridas:</span>
                <span className="spec-value">{product.coats} manos</span>
              </div>
            )}
          </div>

          {product.sizes?.length > 0 && (
            <div className="sizes-section">
              <label className="sizes-label">Seleccioná la presentación (litros):</label>
              <div className="sizes-selector">
                {product.sizes.map((s) => (
                  <button
                    key={s.liters}
                    type="button"
                    className={`size-btn ${selectedSize?.liters === s.liters ? 'selected' : ''}`}
                    onClick={() => setSelectedSize(s)}
                  >
                    <span className="size-liters">{s.liters} L</span>
                    <span className="size-price">
                      {s.price_cents > 0 ? pesos(s.price_cents) : 'Consultar'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="purchase-actions">
            <div className="qty-selector">
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                -
              </button>
              <span className="qty-num">{qty}</span>
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQty((q) => q + 1)}
              >
                +
              </button>
            </div>

            <button
              type="button"
              className="btn primary btn-lg add-cart-btn"
              onClick={handleAddToCart}
            >
              Agregar al carrito
            </button>
          </div>

          {addedNotice && (
            <div className="alert-success">
              ✓ ¡Producto agregado al carrito! <a href={tenantHref('/carrito')}>Ver carrito →</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
