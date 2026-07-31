import { useConfigurator } from '../store/useConfigurator';
import { DEFAULT_BUSINESS } from '../domain/catalog';

/**
 * Storefront footer with the legal links, where shops normally put them (and where
 * the LSSI requirement of permanent accessibility is met without cluttering the
 * top nav).
 *
 * No clearance needed for the configurator's price bar: it is sticky, not fixed, so
 * it scrolls away at the end of the page and this footer follows it.
 */
export function SiteFooter({ dark = false }: { dark?: boolean } = {}) {
  const b = useConfigurator((s) => s.catalog.business) ?? DEFAULT_BUSINESS;
  const year = new Date().getFullYear();

  return (
    <footer className={`site-footer${dark ? ' site-footer-oscura' : ''}`}>
      <nav className="site-footer-links">
        <a href="/aviso-legal">Aviso legal</a>
        <a href="/condiciones">Condiciones de venta</a>
        <a href="/privacidad">Política de privacidad</a>
      </nav>
      <p className="site-footer-legal">
        © {year} {b.name || 'Copistería'}
        {b.nif ? ` · NIF ${b.nif}` : ''}
      </p>
    </footer>
  );
}
