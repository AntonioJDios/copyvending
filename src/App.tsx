import { lazy, Suspense, useEffect, useState } from 'react';
import { useConfigurator } from './store/useConfigurator';
import { FileGrid } from './components/FileGrid';
import { OptionsPanel } from './components/OptionsPanel';
import { PriceBar } from './components/PriceBar';
import { ProjectName } from './components/ProjectName';
import { CartDrawer } from './components/CartDrawer';
import { CartPage } from './components/CartPage';
import { CartButton } from './components/CartButton';

// Heavy / secondary screens are loaded on demand (keeps three.js out of the
// main configurator bundle).
const AdminPanel = lazy(() => import('./components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const OrdersPanel = lazy(() => import('./components/OrdersPanel').then((m) => ({ default: m.OrdersPanel })));
const MugConfigurator = lazy(() => import('./mug/MugConfigurator').then((m) => ({ default: m.MugConfigurator })));
const ChapaConfigurator = lazy(() => import('./chapa/ChapaConfigurator').then((m) => ({ default: m.ChapaConfigurator })));

/** Minimal hash routing: #admin shows the (future) admin panel, else the shop. */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const fetchCatalog = useConfigurator((s) => s.fetchCatalog);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  // Pull the shared admin catalog (prices) so every device shows the same shop.
  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  if (route.startsWith('#admin'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminPanel />
      </Suspense>
    );
  if (route.startsWith('#tazas'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <MugConfigurator />
      </Suspense>
    );
  if (route.startsWith('#chapas'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <ChapaConfigurator />
      </Suspense>
    );
  if (route.startsWith('#carrito')) return <CartPage />;
  if (route.startsWith('#pedidos'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <OrdersPanel />
      </Suspense>
    );

  return (
    <div className="app">
      <header className="topbar">
        <h1>Copistería</h1>
        <nav className="topnav">
          <a className="btn" href="#tazas">
            Tazas
          </a>
          <a className="btn" href="#chapas">
            Chapas
          </a>
          <CartButton onClick={() => setCartOpen(true)} />
          <a className="admin-link" href="#admin" title="Administración">
            ⚙
          </a>
        </nav>
      </header>
      <div className="hero">
        <h2>Imprime tus documentos online</h2>
        <p>Sube tus PDF o imágenes, elige cómo imprimirlos y añade al carrito. El precio se calcula al instante.</p>
      </div>
      <ProjectName />
      <button type="button" className="options-toggle" onClick={() => setOptionsOpen(true)}>
        ⚙ Opciones de impresión
      </button>
      <div className={`layout${optionsCollapsed ? ' focus' : ''}`}>
        <OptionsPanel
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          onCollapse={() => setOptionsCollapsed(true)}
        />
        <FileGrid />
      </div>
      {optionsCollapsed && (
        <button
          type="button"
          className="options-reopen"
          onClick={() => setOptionsCollapsed(false)}
          title="Mostrar opciones"
          aria-label="Mostrar opciones de impresión"
        >
          ›
        </button>
      )}
      <PriceBar />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}
