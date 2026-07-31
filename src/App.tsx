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
import { landingOf } from './domain/catalog';
import { useRoute } from './lib/router';
import { applySeo } from './lib/seo';
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
const ADMIN_ROUTES = ['/admin', '/pedidos', '/estadisticas', '/clientes'];

function Shop() {
  const route = useRoute();
  const fetchCatalog = useConfigurator((s) => s.fetchCatalog);
  const restoreSession = useAuth((s) => s.restore);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const shopName = useConfigurator((s) => s.catalog.business?.name) || 'Copistería';
  const shopLogo = useConfigurator((s) => s.catalog.business?.logo) || '';
  // La plantilla de portada decide el fondo del contenedor: la oscura lo pone negro.
  const landingTemplate = useConfigurator((s) => landingOf(s.catalog).template);

  // Pull the shared admin catalog (prices) so every device shows the same shop.
  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  // Etiquetas para buscadores y para compartir. Van aquí y no en el index.html
  // porque salen de la configuración de la tienda, y el mismo build sirve a
  // varias. Se recalculan cuando llega el catálogo o cambia de página.
  const catalog = useConfigurator((s) => s.catalog);
  useEffect(() => {
    if (CURRENT_SOURCE === 'mostrador') return; // la tablet no se indexa
    applySeo(catalog);
  }, [catalog, route]);

  // Restore the customer session once, app-wide, so the account state is known
  // on every page (checkout, cart, headers…).
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // The legal links live in the footer, like in any other shop — rendered once
  // here so every customer-facing page gets them.
  const isAdminRoute = ADMIN_ROUTES.some((r) => route.startsWith(r));
  const onLanding = CURRENT_SOURCE !== 'mostrador' && (route === '/' || route.startsWith('/inicio'));
  const isDarkLanding = onLanding && landingTemplate === 'oscura';
  const page = renderPage();
  return (
    <>
      {page}
      {/* La portada oscura pinta también la cabecera y el pie: un bloque blanco
          arriba y otro abajo sobre una página negra queda como un error. */}
      {!isAdminRoute && <SiteFooter dark={isDarkLanding} />}
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
    const ocultarNombre = !!shopLogo && !isDarkLanding;
    return (
      <header className="topbar">
        {/* Con logo se quita la marca dibujada por CSS, para no tener dos. */}
        {/* El nombre de la tienda es navegación, no el título de la página: el h1
            de cada pantalla es su propio titular. Tener el mismo h1 en todas las
            páginas es de los errores de SEO más comunes. */}
        <div className={`brand${shopLogo ? ' has-logo' : ''}${isDarkLanding ? ' brand-redondo' : ''}`}>
          {shopLogo && <img className="brand-logo" src={shopLogo} alt={shopName} />}
          {/* El nombre sale de la ficha del negocio, igual que en el pie: el mismo
              código tiene que poder vestirse de cualquier tienda. En el mostrador
              no es enlace, porque la tablet no necesita la portada comercial. */}
          {/* Con el logo entero al lado, repetir el nombre es ruido y se oculta
              (queda en el marcado para el lector de pantalla). Pero en la portada
              oscura el logo va dentro de un círculo pequeño, donde no se lee: ahí
              el nombre tiene que estar a la vista. */}
          {CURRENT_SOURCE === 'mostrador' ? (
            <span className={ocultarNombre ? 'sr-only' : ''}>{shopName}</span>
          ) : (
            <a href="/inicio" className={ocultarNombre ? 'sr-only' : ''}>
              {shopName}
            </a>
          )}
          <span className={`source-badge src-${CURRENT_SOURCE}`}>
            {CURRENT_SOURCE === 'mostrador' ? '🏪 Papelería' : '🌐 Web'}
          </span>
        </div>
        <nav className="topnav">
          <div className={`topnav-links${menuOpen ? ' open' : ''}`}>
            {hasBackend && (
              <a className="btn" href="/asistente" onClick={() => setMenuOpen(false)}>
                ✨ Asistente
              </a>
            )}
            <a className="btn" href="/imprimir" onClick={() => setMenuOpen(false)}>
              Imprimir
            </a>
            <a className="btn" href="/tazas" onClick={() => setMenuOpen(false)}>
              Tazas
            </a>
            <a className="btn" href="/chapas" onClick={() => setMenuOpen(false)}>
              Chapas
            </a>
            <a className="btn" href="/recoger" onClick={() => setMenuOpen(false)}>
              Recoger pedido
            </a>
            <a className="admin-link" href="/admin" title="Administración" onClick={() => setMenuOpen(false)}>
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
  if (route.startsWith('/admin'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminGate>
          <AdminPanel />
        </AdminGate>
      </Suspense>
    );
  if (route.startsWith('/tazas'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <MugConfigurator />
      </Suspense>
    );
  if (route.startsWith('/chapas'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <ChapaConfigurator />
      </Suspense>
    );
  if (onLanding)
    return (
      <div className={`app app-landing${isDarkLanding ? ' app-landing-oscura' : ''}`}>
        {renderHeader()}
        <Landing />
        {/* El cajón del carrito vive en cada pantalla que tenga la cabecera: sin
            esto, en la portada el botón del carrito no abría nada. */}
        <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      </div>
    );
  if (route.startsWith('/carrito')) return <CartPage />;
  if (route.startsWith('/recoger')) return <RecoverOrder />;
  if (route.startsWith('/privacidad')) return <PrivacyPolicy />;
  if (route.startsWith('/aviso-legal')) return <LegalNotice />;
  if (route.startsWith('/condiciones')) return <TermsOfSale />;
  if (route.startsWith('/cuenta') || route.startsWith('/acceder')) return <Account />;
  if (route.startsWith('/asistente'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AssistantStudio />
      </Suspense>
    );
  if (route.startsWith('/pedidos'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminGate>
          <OrdersPanel />
        </AdminGate>
      </Suspense>
    );
  if (route.startsWith('/estadisticas'))
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
        <AdminGate>
          <StatsPanel />
        </AdminGate>
      </Suspense>
    );
  if (route.startsWith('/clientes'))
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
        <h1>Imprime tus documentos online</h1>
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
