import { lazy, Suspense, useEffect, useState } from 'react';
import { useConfigurator } from './store/useConfigurator';
import { useAuth } from './store/useAuth';
import { hasBackend } from './lib/api';
import { AssistantChat } from './components/AssistantChat';
import { SuggestionBanner } from './components/SuggestionBanner';
import { PreflightNotice } from './components/PreflightNotice';
import { RecoverOrder } from './components/RecoverOrder';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { LegalNotice } from './components/LegalNotice';
import { TermsOfSale } from './components/TermsOfSale';
import { Account } from './components/Account';
import { FileGrid } from './components/FileGrid';
import { OptionsPanel } from './components/OptionsPanel';
import { PriceBar } from './components/PriceBar';
import { ProjectName } from './components/ProjectName';
import { CartDrawer } from './components/CartDrawer';
import { CartPage } from './components/CartPage';
import { CartButton } from './components/CartButton';
import { AccountButton } from './components/AccountButton';
import { AdminGate } from './components/AdminGate';
import { CounterGate } from './components/CounterGate';
import { SiteFooter } from './components/SiteFooter';
import { Landing } from './components/Landing';
import { CURRENT_SOURCE } from './lib/source';

// Heavy / secondary screens are loaded on demand (keeps three.js out of the
// main configurator bundle).
const AdminPanel = lazy(() => import('./components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const OrdersPanel = lazy(() => import('./components/OrdersPanel').then((m) => ({ default: m.OrdersPanel })));
const StatsPanel = lazy(() => import('./components/StatsPanel').then((m) => ({ default: m.StatsPanel })));
const MugConfigurator = lazy(() => import('./mug/MugConfigurator').then((m) => ({ default: m.MugConfigurator })));
const ChapaConfigurator = lazy(() => import('./chapa/ChapaConfigurator').then((m) => ({ default: m.ChapaConfigurator })));
const AssistantStudio = lazy(() => import('./components/AssistantStudio').then((m) => ({ default: m.AssistantStudio })));
const ClientsPanel = lazy(() => import('./components/ClientsPanel').then((m) => ({ default: m.ClientsPanel })));

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
  // The counter front (papeleria.html) has to prove it is the shop's device
  // before it can use the counter price list.
  if (CURRENT_SOURCE === 'mostrador')
    return (
      <CounterGate>
        <Shop />
      </CounterGate>
    );
  return <Shop />;
}

/** Backoffice routes: no storefront footer there. */
const ADMIN_ROUTES = ['#admin', '#pedidos', '#estadisticas', '#clientes'];

function Shop() {
  const route = useHashRoute();
  const fetchCatalog = useConfigurator((s) => s.fetchCatalog);
  const restoreSession = useAuth((s) => s.restore);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const shopName = useConfigurator((s) => s.catalog.business?.name) || 'Copistería';
  const shopLogo = useConfigurator((s) => s.catalog.business?.logo) || '';

  // Pull the shared admin catalog (prices) so every device shows the same shop.
  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  // Restore the customer session once, app-wide, so the account state is known
  // on every page (checkout, cart, headers…).
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // The legal links live in the footer, like in any other shop — rendered once
  // here so every customer-facing page gets them.
  const isAdminRoute = ADMIN_ROUTES.some((r) => route.startsWith(r));
  const page = renderPage();
  return (
    <>
      {page}
      {!isAdminRoute && <SiteFooter />}
    </>
  );

  /**
   * Cabecera de la tienda, compartida por la portada y el configurador.
   *
   * Es una función y no un componente a propósito: un componente definido dentro
   * de otro se vuelve a montar en cada render, y aquí eso significa perder el
   * menú desplegado a media interacción.
   */
  function renderHeader() {
    return (
      <header className="topbar">
        {/* Con logo se quita la marca dibujada por CSS, para no tener dos. */}
        <h1 className={shopLogo ? 'has-logo' : ''}>
          {shopLogo && <img className="brand-logo" src={shopLogo} alt={shopName} />}
          {/* El nombre sale de la ficha del negocio, igual que en el pie: el mismo
              código tiene que poder vestirse de cualquier tienda. En el mostrador
              no es enlace, porque la tablet no necesita la portada comercial. */}
          {CURRENT_SOURCE === 'mostrador' ? (
            <span className={shopLogo ? 'sr-only' : ''}>{shopName}</span>
          ) : (
            // Con logo el nombre ya está dibujado dentro de la imagen: repetirlo al
            // lado es ruido. Se mantiene en el marcado (oculto) para que el enlace
            // a la portada siga teniendo texto para un lector de pantalla.
            <a href="#inicio" className={shopLogo ? 'sr-only' : ''}>
              {shopName}
            </a>
          )}
          <span className={`source-badge src-${CURRENT_SOURCE}`}>
            {CURRENT_SOURCE === 'mostrador' ? '🏪 Papelería' : '🌐 Web'}
          </span>
        </h1>
        <nav className="topnav">
          <div className={`topnav-links${menuOpen ? ' open' : ''}`}>
            {hasBackend && (
              <a className="btn" href="#asistente" onClick={() => setMenuOpen(false)}>
                ✨ Asistente
              </a>
            )}
            <a className="btn" href="#imprimir" onClick={() => setMenuOpen(false)}>
              Imprimir
            </a>
            <a className="btn" href="#tazas" onClick={() => setMenuOpen(false)}>
              Tazas
            </a>
            <a className="btn" href="#chapas" onClick={() => setMenuOpen(false)}>
              Chapas
            </a>
            <a className="btn" href="#recoger" onClick={() => setMenuOpen(false)}>
              Recoger pedido
            </a>
            <a className="admin-link" href="#admin" title="Administración" onClick={() => setMenuOpen(false)}>
              ⚙
            </a>
          </div>
          <AccountButton />
          <CartButton onClick={() => setCartOpen(true)} />
          <button type="button" className="burger" aria-label="Menú" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            ☰
          </button>
        </nav>
      </header>
    );
  }

  function renderPage() {
  if (route.startsWith('#admin'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminGate>
          <AdminPanel />
        </AdminGate>
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
  if (CURRENT_SOURCE !== 'mostrador' && (route === '' || route === '#' || route.startsWith('#inicio')))
    return (
      <div className="app app-landing">
        {renderHeader()}
        <Landing />
      </div>
    );
  if (route.startsWith('#carrito')) return <CartPage />;
  if (route.startsWith('#recoger')) return <RecoverOrder />;
  if (route.startsWith('#privacidad')) return <PrivacyPolicy />;
  if (route.startsWith('#aviso-legal')) return <LegalNotice />;
  if (route.startsWith('#condiciones')) return <TermsOfSale />;
  if (route.startsWith('#cuenta') || route.startsWith('#acceder')) return <Account />;
  if (route.startsWith('#asistente'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AssistantStudio />
      </Suspense>
    );
  if (route.startsWith('#pedidos'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminGate>
          <OrdersPanel />
        </AdminGate>
      </Suspense>
    );
  if (route.startsWith('#estadisticas'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminGate>
          <StatsPanel />
        </AdminGate>
      </Suspense>
    );
  if (route.startsWith('#clientes'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminGate>
          <ClientsPanel />
        </AdminGate>
      </Suspense>
    );

  return (
    <div className="app">
      {renderHeader()}
      <div className="hero">
        <h2>Imprime tus documentos online</h2>
        <p>Sube tus PDF o imágenes, elige cómo imprimirlos y añade al carrito. El precio se calcula al instante.</p>
      </div>
      <ProjectName />
      <button type="button" className="options-toggle" onClick={() => setOptionsOpen(true)}>
        ⚙ Opciones de impresión
      </button>
      {hasBackend && <SuggestionBanner />}
      <PreflightNotice />
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
      {hasBackend && <AssistantChat />}
    </div>
  );
  }
}
