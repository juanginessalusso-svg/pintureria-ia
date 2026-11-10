import { useState, useEffect } from 'preact/hooks';
import { lazy, Router, Route } from 'preact-iso';
import { Header } from './components/Header.jsx';
import { Footer } from './components/Footer.jsx';
import { Home } from './pages/Home.jsx';
import { Catalog } from './pages/Catalog.jsx';
import { ProductDetail } from './pages/ProductDetail.jsx';
import { TechnicalAssistant } from './pages/TechnicalAssistant.jsx';
import { Cart } from './pages/Cart.jsx';
import { NotFound } from './pages/NotFound.jsx';
import { fetchTenant, fetchBranches } from './tenant.js';

// Lazy loading del visualizador para NO cargar los modelos ONNX en la tienda
const LazyVisualizer = lazy(() =>
  import('./Visualizer.jsx').then((m) => ({ default: m.Visualizer }))
);

export function App() {
  const [tenant, setTenant] = useState(null);
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    fetchTenant().then(setTenant).catch(() => {});
    fetchBranches().then(setBranches).catch(() => {});
  }, []);

  return (
    <div className="site-layout">
      <Header tenant={tenant} />

      <main className="site-content">
        <Router>
          <Route path="/" component={() => <Home tenant={tenant} branches={branches} />} />
          <Route path="/productos" component={Catalog} />
          <Route path="/productos/:sku" component={ProductDetail} />
          <Route path="/asistente-tecnico" component={TechnicalAssistant} />
          <Route path="/carrito" component={() => <Cart tenant={tenant} branches={branches} />} />
          <Route path="/visualizador" component={LazyVisualizer} />
          <Route default component={NotFound} />
        </Router>
      </main>

      <Footer tenant={tenant} branches={branches} />
    </div>
  );
}
