import { useEffect, useState } from 'react';
import { CURRENT_SOURCE } from './source';

/**
 * Rutas de la tienda.
 *
 * Antes todo iba detrás de un `#` (`#imprimir`, `#tazas`). Para un buscador eso NO
 * son páginas distintas: la web entera era una sola dirección, y no había forma de
 * posicionar «imprimir online» o «tazas personalizadas» por separado. Ahora son
 * rutas de verdad (`/imprimir`), que es donde está el tráfico.
 *
 * Dos cosas que hacen que esto no rompa nada:
 *
 *  1. **La tablet del mostrador sigue con `#`.** Se sirve desde `papeleria.html`;
 *     si navegara a `/carrito`, al recargar el navegador pediría esa ruta al
 *     servidor y aterrizaría en la web pública, perdiendo el contexto de
 *     mostrador. Como es una herramienta interna, el buscador da igual ahí. Las
 *     dos formas devuelven la misma ruta normalizada, así que los componentes no
 *     se enteran de la diferencia.
 *  2. **Los enlaces viejos siguen funcionando.** Hay correos enviados a clientes
 *     con `…/#acceder/<token>` y `…/#recoger/<pedido>`: al entrar con uno de
 *     esos, se traduce a su ruta equivalente sin que el cliente note nada. Eso no
 *     se puede quitar nunca — esos correos están en bandejas de entrada ajenas.
 */

/** ¿Navegamos con el `#` (mostrador) o con rutas reales (web)? */
const useHash = CURRENT_SOURCE === 'mostrador';

/** Evento propio: `pushState` no dispara nada por sí solo. */
const NAV_EVENT = 'copisteria:nav';

/** Ruta normalizada: siempre empieza por `/` y nunca acaba en `/` (salvo la raíz). */
function normalise(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
}

/** La ruta actual, venga del `#` o del camino. */
export function currentPath(): string {
  if (useHash) {
    const h = window.location.hash.replace(/^#/, '');
    // Lo que va tras `?` es parámetro, no ruta.
    return normalise(h.split('?')[0] || '/');
  }
  return normalise(window.location.pathname);
}

/** Los parámetros de la dirección, vengan del `#` o de la query real. */
export function currentQuery(): URLSearchParams {
  if (useHash) {
    const q = window.location.hash.split('?')[1] ?? '';
    return new URLSearchParams(q);
  }
  return new URLSearchParams(window.location.search);
}

/** Ir a una ruta sin recargar la página. */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = to.startsWith('/') ? to : `/${to}`;
  if (useHash) {
    // En el mostrador basta con el hash; el navegador ya avisa con hashchange.
    const next = `#${target.slice(1)}`;
    if (opts.replace) window.history.replaceState(null, '', next);
    else window.location.hash = next;
    if (opts.replace) window.dispatchEvent(new Event(NAV_EVENT));
    return;
  }
  if (opts.replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  window.dispatchEvent(new Event(NAV_EVENT));
  // Al cambiar de página se empieza por arriba, como haría una web normal.
  window.scrollTo(0, 0);
}

/** La ruta actual, reaccionando a la navegación. */
export function useRoute(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    window.addEventListener(NAV_EVENT, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
      window.removeEventListener(NAV_EVENT, on);
    };
  }, []);
  return path;
}

/**
 * Traduce una dirección con `#` a su ruta equivalente.
 *
 * Exportada para poder probarla: es lo que sostiene los enlaces de los correos ya
 * enviados, y si se rompe un cliente que pincha en «acceder a mi cuenta» acaba en
 * una página en blanco sin que nos enteremos.
 */
export function pathFromLegacyHash(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  // `#inicio` era la portada.
  if (raw === 'inicio') return '/';
  // Solo lo que parece una ruta nuestra: nada de `#` de anclas o de terceros.
  if (!/^[a-zA-Z0-9][\w\-./?=&%@+]*$/.test(raw)) return null;
  const [path, query] = raw.split('?');
  return `/${path.replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
}

/**
 * Arranca el router: traduce los enlaces viejos y captura los clics internos.
 *
 * Se llama una vez, antes de pintar. En el mostrador no hace nada: allí se sigue
 * navegando con el `#`.
 */
export function startRouter(): void {
  if (useHash) return;

  // 1) Enlaces de correos ya enviados: `…/#recoger/PS-123?e=…` → `/recoger/PS-123?e=…`
  const legacy = pathFromLegacyHash(window.location.hash);
  if (legacy) window.history.replaceState(null, '', legacy);

  // 2) Los clics en enlaces internos no recargan la página. Se hace con un solo
  //    oyente en el documento en lugar de un componente `<Link>`: así los `href`
  //    siguen siendo direcciones de verdad, que es lo que necesitan el buscador,
  //    el «abrir en pestaña nueva» y el clic con la rueda del ratón.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // pestaña nueva
    const a = (e.target as HTMLElement | null)?.closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/')) return; // externo, mailto:, tel:, #…
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    // La API y los archivos estáticos los sirve el servidor, no el router.
    if (href.startsWith('/api/') || /\.[a-z0-9]{2,5}(\?|$)/i.test(href)) return;
    e.preventDefault();
    navigate(href);
  });
}
