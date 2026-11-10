import { useState, useEffect } from 'preact/hooks';
import { useCart } from '../cartState.js';
import { tenantHref, tenantQuery } from '../tenant.js';
import { pesos, buildCartOrderMessage, whatsappUrl } from '@pintureria/core';

export function Cart({ tenant, branches = [] }) {
  const { items, totals, updateQty, remove, clear } = useCart();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (branches.length && !selectedBranchId) {
      setSelectedBranchId(branches[0].id || branches[0].name);
    }
  }, [branches, selectedBranchId]);

  const branch = branches.find((b) => (b.id || b.name) === selectedBranchId) || branches[0];
  const targetWhatsapp = branch?.whatsapp || tenant?.whatsapp;

  const handleSendOrder = () => {
    if (!items.length) return;
    const msg = buildCartOrderMessage({
      shop: tenant?.name,
      branch: branch?.name,
      items,
      notes,
    });
    const url = whatsappUrl(targetWhatsapp, msg);
    window.open(url, '_blank');
  };

  if (!items.length) {
    return (
      <div className="wrap empty-cart-page">
        <div className="empty-cart-card">
          <span className="empty-cart-icon">🛒</span>
          <h2>Tu carrito está vacío</h2>
          <p className="muted">Todavía no agregaste productos ni pinturas.</p>
          <div className="empty-cart-actions">
            <a href={tenantHref('/productos')} className="btn primary">
              Explorar Catálogo
            </a>
            <a href={tenantHref('/visualizador')} className="btn">
              Ir al Simulador de Paredes
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap cart-page">
      <h1>Carrito de Compras</h1>

      <div className="cart-layout">
        <div className="cart-items-col">
          <div className="cart-items-list">
            {items.map((item, idx) => (
              <div key={item.sku + '_' + idx} className="cart-item-row">
                <div className="cart-item-info">
                  <h4 className="cart-item-name">{item.name}</h4>
                  <div className="cart-item-meta">
                    {item.liters && <span className="meta-tag">{item.liters} L</span>}
                    {item.color && (
                      <span className="meta-color">
                        {item.color.hex && (
                          <span className="sw-sm" style={{ background: item.color.hex }} />
                        )}
                        Color: {item.color.name}
                      </span>
                    )}
                  </div>
                  {item.unit_price_cents > 0 && (
                    <span className="cart-item-price-unit">{pesos(item.unit_price_cents)} c/u</span>
                  )}
                </div>

                <div className="cart-item-controls">
                  <div className="qty-selector sm">
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={() => updateQty(idx, item.qty - 1)}
                    >
                      -
                    </button>
                    <span className="qty-num">{item.qty}</span>
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={() => updateQty(idx, item.qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="cart-remove-btn"
                    onClick={() => remove(idx)}
                    title="Eliminar producto"
                  >
                    🗑️
                  </button>
                </div>

                <div className="cart-item-subtotal">
                  {item.unit_price_cents > 0 ? (
                    pesos(item.unit_price_cents * item.qty)
                  ) : (
                    <span className="muted">A cotizar</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="cart-clear-row">
            <button type="button" className="btn-link-danger" onClick={clear}>
              Vaciar carrito
            </button>
          </div>
        </div>

        <div className="cart-summary-col">
          <div className="summary-card">
            <h3>Resumen del Pedido</h3>

            <div className="summary-row">
              <span>Artículos:</span>
              <span>{totals.count}</span>
            </div>

            <div className="summary-row total-row">
              <span>Total Estimado:</span>
              <span className="total-amount">{totals.formattedTotal}</span>
            </div>

            {branches.length > 0 && (
              <div className="summary-field">
                <label htmlFor="branch-select">Sucursal de retiro / consulta:</label>
                <select
                  id="branch-select"
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b.id || b.name} value={b.id || b.name}>
                      {b.name} {b.address ? `(${b.address})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="summary-field">
              <label htmlFor="cart-notes">Aclaraciones o consulta especial (opcional):</label>
              <textarea
                id="cart-notes"
                rows="2"
                placeholder="Ej: ¿Tienen stock en color blanco satinado? ¿Hacen envíos a domicilio?"
                value={notes}
                onInput={(e) => setNotes(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn btn-wa-checkout"
              onClick={handleSendOrder}
            >
              📲 Finalizar Pedido por WhatsApp
            </button>

            <p className="checkout-hint">
              Al tocar el botón se abrirá WhatsApp con el detalle de tu pedido listo para enviar a la sucursal.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
