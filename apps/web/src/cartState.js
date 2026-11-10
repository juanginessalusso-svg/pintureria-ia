import { useState, useEffect } from 'preact/hooks';
import { addToCart as coreAdd, updateCartQty as coreUpdate, removeFromCart as coreRemove, cartTotals } from '@pintureria/core';
import { getTenantParam } from './tenant.js';

function getStorageKey() {
  const t = getTenantParam() || 'default';
  return `cart_${t}`;
}

function loadSavedCart() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (raw) return JSON.parse(raw);
  } catch {
    // modo incógnito o storage deshabilitado
  }
  return [];
}

function saveCart(items) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(items));
  } catch {
    // ignorar fallo de almacenamiento
  }
}

// Escuchas para sincronizar cambios de carrito entre componentes
const listeners = new Set();
let globalCart = loadSavedCart();

function notify() {
  saveCart(globalCart);
  for (const fn of listeners) fn([...globalCart]);
}

export function useCart() {
  const [items, setItems] = useState(globalCart);

  useEffect(() => {
    // Al montar, recargar por si cambió de tenant
    globalCart = loadSavedCart();
    setItems(globalCart);

    const onUpdate = (newItems) => setItems(newItems);
    listeners.add(onUpdate);
    return () => listeners.delete(onUpdate);
  }, []);

  const add = (item) => {
    globalCart = coreAdd(globalCart, item);
    notify();
  };

  const updateQty = (keyOrIdx, qty) => {
    globalCart = coreUpdate(globalCart, keyOrIdx, qty);
    notify();
  };

  const remove = (keyOrIdx) => {
    globalCart = coreRemove(globalCart, keyOrIdx);
    notify();
  };

  const clear = () => {
    globalCart = [];
    notify();
  };

  const totals = cartTotals(items);

  return {
    items,
    totals,
    add,
    updateQty,
    remove,
    clear,
  };
}
