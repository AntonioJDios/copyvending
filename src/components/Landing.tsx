import { useConfigurator } from '../store/useConfigurator';
import { cheapestPagePrice, DEFAULT_BUSINESS, landingOf, legalOf } from '../domain/catalog';
import { Icon } from './Icon';

/**
 * Home page.
 *
 * Until now the site opened straight into the configurator, which is fine for
 * someone who already knows what they want and terrible for everyone else: no
 * shop name, no phone, no explanation, and no way to reach the mugs or the badges
 * without hunting through the top menu.
 *
 * Two rules hold this file together:
 *
 *  1. **Nothing is written for one particular shop.** Every text, the logo, the
 *     prices and the contact details come from the shop's configuration in the
 *     database, so the same build dresses up as Fotocopiator or as any other —
 *     which is the whole point of one repository with several deployments.
 *  2. **Nothing is invented.** The "from X €" comes from the real price table and
 *     the free-shipping threshold from the real shipping config. A price typed by
 *     hand into a landing page goes stale, and a stale price on a home page is
 *     misleading advertising, not a cosmetic bug.
 *
 * Order of the page: hero → guarantees → notice board → what you can order (with
 * how it works, same block) → contact. Bands alternate white and tinted so the
 * sections read as separate blocks; each band is full width with its own centred
 * inner wrapper, which is why the markup looks doubled up.
 *
 * No emoji as icons — see ./Icon. The system draws emoji differently on every
 * device and they cannot take the brand colour.
 */
export function Landing() {
  const catalog = useConfigurator((s) => s.catalog);
  const t = landingOf(catalog);
  const b = catalog.business ?? DEFAULT_BUSINESS;
  const legal = legalOf(catalog);
  const shop = b.name || 'Copistería';

  const from = t.showPriceFrom ? cheapestPagePrice(catalog) : null;
  const ship = catalog.shipping;
  // Only a real, enabled threshold: "free shipping from 0 €" would be nonsense,
  // and announcing free shipping the shop does not offer is worse.
  const freeFrom = ship?.enabled && Number(ship.freeThreshold) > 0 ? Number(ship.freeThreshold) : null;
  const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
  // Per-page prices are cents: 0,019 € must not round to 0,02 €.
  const perPage = (n: number) => `${n.toFixed(n < 0.1 ? 3 : 2).replace('.', ',')} €`;

  const waNumber = legal.phone.replace(/\D/g, '');
  const wa = waNumber ? `https://wa.me/${waNumber.length === 9 ? `34${waNumber}` : waNumber}` : '';

  return (
    <main className="landing">
      {/* Tira de aviso: lo urgente, visible sin bajar la página. */}
      {t.banner && (
        <div className="lp-banner">
          <span>{t.banner}</span>
        </div>
      )}

      <section className="lp-band lp-band-hero">
        <div className="lp-inner lp-hero">
          <div className="lp-hero-text">
            {b.logo && <img className="lp-logo" src={b.logo} alt={shop} />}
            <h2>{t.claim}</h2>
            <p>{t.subclaim}</p>
            {from !== null && (
              <p className="lp-from">
                Imprime desde <strong>{perPage(from)}</strong> la página
              </p>
            )}
            <div className="lp-cta">
              <a className="btn btn-primary lp-cta-main" href="#imprimir">
                Sube tus documentos
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
        </div>
      </section>

      {/* Tira de garantías. Cada dato sale de la configuración; lo que no esté
          configurado simplemente no se promete. */}
      {(freeFrom !== null || legal.prepTime || legal.deliveryTime) && (
        <div className="lp-badges">
          <div className="lp-inner">
            {freeFrom !== null && (
              <span className="lp-badge">
                <Icon name="truck" />
                <span>
                  <strong>Envío gratis</strong> desde {eur(freeFrom)}
                </span>
              </span>
            )}
            {legal.prepTime && (
              <span className="lp-badge">
                <Icon name="clock" />
                <span>
                  Preparación en <strong>{legal.prepTime}</strong>
                </span>
              </span>
            )}
            {legal.deliveryTime && (
              <span className="lp-badge">
                <Icon name="package" />
                <span>
                  Entrega en <strong>{legal.deliveryTime}</strong>
                </span>
              </span>
            )}
            <span className="lp-badge">
              <Icon name="lock" />
              <span>Pago seguro</span>
            </span>
          </div>
        </div>
      )}

      {/* Tablón de anuncios: lo primero después de las garantías, porque es lo que
          la tienda quiere contar hoy. */}
      {t.notices.length > 0 && (
        <section className="lp-band lp-band-tint">
          <div className="lp-inner">
            {/* Sin titular: los anuncios ya se explican solos y un rótulo
                «Tablón de anuncios» solo añade ruido. Cada anuncio lleva el suyo. */}
            <div className="lp-notices">
              {t.notices.map((n, i) => (
                <article className="lp-notice" key={`${n.title}-${i}`}>
                  <h4>{n.title}</h4>
                  {/* Texto plano, nunca HTML: lo escribe la tienda desde el panel. */}
                  <p>{n.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Qué puedes pedir y cómo funciona van juntos: son la misma idea — lo que
          vendemos y cómo se compra. */}
      <section className="lp-band">
        <div className="lp-inner">
          <h3 className="lp-h">Qué puedes pedir</h3>
          <div className="lp-cards">
            <a className="lp-card lp-card-print" href="#imprimir">
              <span className="lp-card-icon">
                <Icon name="printer" />
              </span>
              <h4>Copistería online</h4>
              <p>Fotocopias e impresión en A3, A4 y A5, en color o blanco y negro, con encuadernación si la necesitas.</p>
              <span className="lp-card-go">Empezar a imprimir →</span>
            </a>
            {t.showMugs && (
              <a className="lp-card lp-card-mug" href="#tazas">
                <span className="lp-card-icon">
                  <Icon name="mug" />
                </span>
                <h4>Tazas personalizadas</h4>
                <p>Tu foto o tu diseño en una taza. La ves en 3D antes de pedirla.</p>
                <span className="lp-card-go">Diseñar mi taza →</span>
              </a>
            )}
            {t.showBadges && (
              <a className="lp-card lp-card-badge" href="#chapas">
                <span className="lp-card-icon">
                  <Icon name="badge" />
                </span>
                <h4>Chapas personalizadas</h4>
                <p>Con imperdible, imán, espejo o abrebotellas. Ideales para eventos y regalos.</p>
                <span className="lp-card-go">Diseñar mis chapas →</span>
              </a>
            )}
          </div>

          <h4 className="lp-sub">Cómo funciona</h4>
          <ol className="lp-steps">
            <li className="lp-step">
              <span className="lp-step-icon">
                <Icon name="upload" />
                <span className="lp-step-n">1</span>
              </span>
              <strong>Sube tus archivos</strong>
              <p>PDF o imágenes. Puedes subir varios documentos en el mismo pedido.</p>
            </li>
            <li className="lp-step">
              <span className="lp-step-icon">
                <Icon name="sliders" />
                <span className="lp-step-n">2</span>
              </span>
              <strong>Elige cómo imprimirlos</strong>
              <p>Tamaño, color, doble cara y encuadernado. El precio se actualiza mientras eliges.</p>
            </li>
            <li className="lp-step">
              <span className="lp-step-icon">
                <Icon name="truck" />
                <span className="lp-step-n">3</span>
              </span>
              <strong>Recíbelos o recógelos</strong>
              <p>
                {freeFrom !== null
                  ? `Envío a domicilio (gratis desde ${eur(freeFrom)}) o recogida en tienda.`
                  : 'Envío a domicilio o recogida en tienda.'}
              </p>
            </li>
          </ol>
        </div>
      </section>

      {(b.address || legal.phone || b.email) && (
        <section className="lp-band lp-band-tint">
          <div className="lp-inner">
            <h3 className="lp-h">Dónde estamos</h3>
            <div className="lp-contact">
              {b.address && (
                <div className="lp-contact-item">
                  <span className="lp-contact-icon">
                    <Icon name="pin" />
                  </span>
                  <span className="lp-contact-body">
                    <strong>Dirección</strong>
                    {b.address}
                  </span>
                </div>
              )}
              {legal.phone && (
                <div className="lp-contact-item">
                  <span className="lp-contact-icon">
                    <Icon name="phone" />
                  </span>
                  <span className="lp-contact-body">
                    <strong>Teléfono</strong>
                    <a href={`tel:${legal.phone.replace(/\s/g, '')}`}>{legal.phone}</a>
                  </span>
                </div>
              )}
              {b.email && (
                <div className="lp-contact-item">
                  <span className="lp-contact-icon">
                    <Icon name="mail" />
                  </span>
                  <span className="lp-contact-body">
                    <strong>Correo</strong>
                    <a href={`mailto:${b.email}`}>{b.email}</a>
                  </span>
                </div>
              )}
            </div>
            {wa && (
              <a className="lp-wa" href={wa} target="_blank" rel="noopener noreferrer">
                <Icon name="whatsapp" />
                Escríbenos por WhatsApp
              </a>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
