import { useConfigurator } from '../store/useConfigurator';
import { DEFAULT_BUSINESS, landingOf, legalOf } from '../domain/catalog';

/**
 * Home page.
 *
 * Until now the site opened straight into the configurator, which is fine for
 * someone who already knows what they want and terrible for everyone else: no
 * shop name, no phone, no explanation, and no way to reach the mugs or the
 * badges without finding them in the top menu.
 *
 * Every text and every contact detail comes from the shop's configuration in the
 * database — nothing here is written for one particular shop. The same build
 * serves Fotocopiator or any other, which is the whole point of one repository
 * with several deployments.
 *
 * Deliberately static: no data fetching, no images to download. It is the first
 * thing a customer sees, often on a phone and on mobile data, so the fastest page
 * is the one that ships nothing.
 */
export function Landing() {
  const catalog = useConfigurator((s) => s.catalog);
  const t = landingOf(catalog);
  const b = catalog.business ?? DEFAULT_BUSINESS;
  const legal = legalOf(catalog);
  const shop = b.name || 'Copistería';
  // Spanish mobile numbers on WhatsApp: strip everything but digits and assume
  // the country code when it is missing.
  const waNumber = legal.phone.replace(/\D/g, '');
  const wa = waNumber ? `https://wa.me/${waNumber.length === 9 ? `34${waNumber}` : waNumber}` : '';

  return (
    <main className="landing">
      <section className="lp-hero">
        <div className="lp-hero-text">
          <h2>{t.claim}</h2>
          <p>{t.subclaim}</p>
          <div className="lp-cta">
            <a className="btn btn-primary lp-cta-main" href="#imprimir">
              Imprimir mis documentos
            </a>
            <a className="btn lp-cta-alt" href="#recoger">
              Seguir un pedido
            </a>
          </div>
          {t.trust && <p className="lp-trust">{t.trust}</p>}
        </div>
        {/* Decorative only: drawn, not downloaded — no image requests on first paint. */}
        <div className="lp-hero-art" aria-hidden>
          <span className="lp-sheet lp-sheet-3" />
          <span className="lp-sheet lp-sheet-2" />
          <span className="lp-sheet lp-sheet-1" />
        </div>
      </section>

      <section className="lp-cards">
        <a className="lp-card lp-card-print" href="#imprimir">
          <span className="lp-card-icon" aria-hidden>
            🖨️
          </span>
          <h3>Copistería online</h3>
          <p>Fotocopias e impresión en A3, A4 y A5, en color o blanco y negro, con encuadernación si la necesitas.</p>
          <span className="lp-card-go">Empezar a imprimir →</span>
        </a>
        {t.showMugs && (
          <a className="lp-card lp-card-mug" href="#tazas">
            <span className="lp-card-icon" aria-hidden>
              ☕
            </span>
            <h3>Tazas personalizadas</h3>
            <p>Tu foto o tu diseño en una taza. La ves en 3D antes de pedirla.</p>
            <span className="lp-card-go">Diseñar mi taza →</span>
          </a>
        )}
        {t.showBadges && (
          <a className="lp-card lp-card-badge" href="#chapas">
            <span className="lp-card-icon" aria-hidden>
              🎯
            </span>
            <h3>Chapas personalizadas</h3>
            <p>Con imperdible, imán, espejo o abrebotellas. Ideales para eventos y regalos.</p>
            <span className="lp-card-go">Diseñar mis chapas →</span>
          </a>
        )}
      </section>

      <section className="lp-how">
        <h3>Cómo funciona</h3>
        <ol className="lp-steps">
          <li>
            <span className="lp-step-n">1</span>
            <div>
              <strong>Sube tus archivos</strong>
              <p>PDF o imágenes. Puedes subir varios documentos en el mismo pedido.</p>
            </div>
          </li>
          <li>
            <span className="lp-step-n">2</span>
            <div>
              <strong>Elige cómo imprimirlos</strong>
              <p>Tamaño, color, doble cara y encuadernado. El precio se actualiza mientras eliges.</p>
            </div>
          </li>
          <li>
            <span className="lp-step-n">3</span>
            <div>
              <strong>Recíbelos o recógelos</strong>
              <p>
                Envío a domicilio o recogida en tienda
                {legal.prepTime ? `. Preparación en ${legal.prepTime}` : ''}.
              </p>
            </div>
          </li>
        </ol>
      </section>

      {(b.address || legal.phone || b.email) && (
        <section className="lp-contact">
          <h3>{shop}</h3>
          <ul>
            {b.address && <li>📍 {b.address}</li>}
            {legal.phone && (
              <li>
                📞{' '}
                <a href={`tel:${legal.phone.replace(/\s/g, '')}`}>{legal.phone}</a>
                {wa && (
                  <>
                    {' · '}
                    <a href={wa} target="_blank" rel="noopener noreferrer">
                      WhatsApp
                    </a>
                  </>
                )}
              </li>
            )}
            {b.email && (
              <li>
                ✉️ <a href={`mailto:${b.email}`}>{b.email}</a>
              </li>
            )}
          </ul>
        </section>
      )}
    </main>
  );
}
