import { Icon } from '../Icon';
import { useLandingData } from './useLandingData';

/**
 * Plantilla «clara»: sobria, fondo blanco, bandas alternando blanco y un tinte
 * suave. Es la de por defecto y la que sirve para cualquier tienda.
 *
 * Nada escrito para una tienda concreta: todo sale de useLandingData, que a su vez
 * lee la configuración de la base de datos. Sin imágenes: la decoración son tres
 * divs con CSS, porque es lo primero que ve un cliente y muchas veces desde el
 * móvil con datos.
 */
export function LandingClara() {
  const d = useLandingData();
  const { t, eur } = d;

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
            {d.logo && <img className="lp-logo" src={d.logo} alt={d.shop} />}
            <h2>{t.claim}</h2>
            <p>{t.subclaim}</p>
            {d.from !== null && (
              <p className="lp-from">
                Imprime desde <strong>{d.perPage(d.from)}</strong> la página
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
          {/* Decorativo: dibujado, no descargado. */}
          <div className="lp-hero-art" aria-hidden>
            <span className="lp-sheet lp-sheet-3" />
            <span className="lp-sheet lp-sheet-2" />
            <span className="lp-sheet lp-sheet-1" />
          </div>
        </div>
      </section>

      {(d.freeFrom !== null || d.prepTime || d.deliveryTime) && (
        <div className="lp-badges">
          <div className="lp-inner">
            {d.freeFrom !== null && (
              <span className="lp-badge">
                <Icon name="truck" />
                <span>
                  <strong>Envío gratis</strong> desde {eur(d.freeFrom)}
                </span>
              </span>
            )}
            {d.prepTime && (
              <span className="lp-badge">
                <Icon name="clock" />
                <span>
                  Preparación en <strong>{d.prepTime}</strong>
                </span>
              </span>
            )}
            {d.deliveryTime && (
              <span className="lp-badge">
                <Icon name="package" />
                <span>
                  Entrega en <strong>{d.deliveryTime}</strong>
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

      {d.notices.length > 0 && (
        <section className="lp-band lp-band-tint">
          <div className="lp-inner">
            {/* Sin titular: cada anuncio lleva el suyo. */}
            <div className="lp-notices">
              {d.notices.map((n, i) => (
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
                {d.freeFrom !== null
                  ? `Envío a domicilio (gratis desde ${eur(d.freeFrom)}) o recogida en tienda.`
                  : 'Envío a domicilio o recogida en tienda.'}
              </p>
            </li>
          </ol>
        </div>
      </section>

      {d.hasContact && (
        <section className="lp-band lp-band-tint">
          <div className="lp-inner">
            <h3 className="lp-h">Dónde estamos</h3>
            <div className="lp-contact">
              {d.address && (
                <div className="lp-contact-item">
                  <span className="lp-contact-icon">
                    <Icon name="pin" />
                  </span>
                  <span className="lp-contact-body">
                    <strong>Dirección</strong>
                    {d.address}
                  </span>
                </div>
              )}
              {d.phone && (
                <div className="lp-contact-item">
                  <span className="lp-contact-icon">
                    <Icon name="phone" />
                  </span>
                  <span className="lp-contact-body">
                    <strong>Teléfono</strong>
                    <a href={`tel:${d.phone.replace(/\s/g, '')}`}>{d.phone}</a>
                  </span>
                </div>
              )}
              {d.email && (
                <div className="lp-contact-item">
                  <span className="lp-contact-icon">
                    <Icon name="mail" />
                  </span>
                  <span className="lp-contact-body">
                    <strong>Correo</strong>
                    <a href={`mailto:${d.email}`}>{d.email}</a>
                  </span>
                </div>
              )}
            </div>
            {d.wa && (
              <a className="lp-wa" href={d.wa} target="_blank" rel="noopener noreferrer">
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
