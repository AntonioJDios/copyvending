import { activeContent, DEFAULT_BUSINESS, landingOf, legalOf, seoOf, type Catalog } from '../domain/catalog';

/**
 * Etiquetas para buscadores y para compartir.
 *
 * Se escriben desde JavaScript y no en el index.html porque **el mismo build sirve
 * a varias tiendas**: el título, la descripción y la imagen salen de la
 * configuración de cada una. Google ejecuta JavaScript y lee lo que quede en el
 * documento, así que funciona; lo que no funciona es un `index.html` con el nombre
 * de una copistería concreta escrito dentro.
 *
 * El cálculo (`seoTags`) está separado de la escritura (`applySeo`) para poder
 * probarlo sin un navegador: la lógica que puede equivocarse es QUÉ se declara —
 * sobre todo la ficha del negocio, donde un dato inventado va a parar al mapa de
 * Google—, no el `document.head.appendChild`.
 */

export interface SeoTags {
  title: string;
  description: string;
  /** Sin la parte del `#`: para un buscador, `#carrito` no es otra página. */
  canonical: string;
  image: string;
  siteName: string;
  /** Ficha del negocio, o null si la tienda no tiene ni nombre. */
  jsonLd: Record<string, unknown> | null;
}

/** Dirección absoluta, que es la única que valen Open Graph y JSON-LD. */
function absolute(url: string, origin: string): string {
  if (!url) return '';
  if (url.startsWith('data:')) return url; // un logo incrustado no se puede absolutizar
  try {
    return new URL(url, origin).href;
  } catch {
    return '';
  }
}

/**
 * Qué etiquetas corresponden a esta tienda.
 *
 * En la ficha del negocio solo se declara lo que la tienda ha rellenado: una
 * dirección a medias o un teléfono vacío ahí es peor que no ponerlos, porque
 * Google los usa para la ficha del mapa y para el botón de llamar.
 */
export function seoTags(catalog: Catalog, origin: string, pathname: string): SeoTags {
  const { title, description } = seoOf(catalog);
  const b = catalog.business ?? DEFAULT_BUSINESS;
  const legal = legalOf(catalog);
  const name = b.name?.trim() ?? '';
  const content = activeContent(landingOf(catalog));
  const image = absolute(content.heroImage || b.logo || '', origin);

  let jsonLd: Record<string, unknown> | null = null;
  if (name) {
    jsonLd = {
      '@context': 'https://schema.org',
      // Una copistería es un comercio con servicios de impresión.
      '@type': 'PrintShop',
      name,
      url: origin,
    };
    if (b.address?.trim()) jsonLd.address = { '@type': 'PostalAddress', streetAddress: b.address.trim() };
    if (legal.phone?.trim()) jsonLd.telephone = legal.phone.trim();
    if (b.email?.trim()) jsonLd.email = b.email.trim();
    if (image) jsonLd.image = image;
  }

  return {
    title,
    description,
    canonical: `${origin}${pathname}`,
    image,
    siteName: name || 'Copistería',
    jsonLd,
  };
}

/** Crea o actualiza una etiqueta del `<head>` sin duplicarla. */
function meta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!content) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function link(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

const LD_ID = 'seo-negocio';

/** Escribe en el documento las etiquetas que devuelve seoTags. */
export function applySeo(catalog: Catalog): void {
  const t = seoTags(catalog, window.location.origin, window.location.pathname);

  document.title = t.title;
  meta('name', 'description', t.description);
  link('canonical', t.canonical);

  meta('property', 'og:type', 'website');
  meta('property', 'og:site_name', t.siteName);
  meta('property', 'og:title', t.title);
  meta('property', 'og:description', t.description);
  meta('property', 'og:url', t.canonical);
  meta('property', 'og:locale', 'es_ES');
  meta('property', 'og:image', t.image);
  // Con imagen, tarjeta grande; sin ella, la pequeña queda mejor que un hueco.
  meta('name', 'twitter:card', t.image ? 'summary_large_image' : 'summary');
  meta('name', 'twitter:title', t.title);
  meta('name', 'twitter:description', t.description);
  meta('name', 'twitter:image', t.image);

  document.getElementById(LD_ID)?.remove();
  if (t.jsonLd) {
    const el = document.createElement('script');
    el.id = LD_ID;
    el.type = 'application/ld+json';
    el.textContent = JSON.stringify(t.jsonLd);
    document.head.appendChild(el);
  }
}
