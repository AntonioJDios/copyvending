import { Icon } from '../Icon';
import { useLandingData } from './useLandingData';

/**
 * Plantilla «oscura»: negro, neón y tono de tú, para público universitario y de
 * oposiciones. Anillas como motivo de marca, confeti cayendo y el tablón como
 * post-its con celo.
 *
 * Los MISMOS datos que la clara (ver useLandingData): solo cambia la presentación.
 * Los textos los escribe la tienda; los de aquí son los rótulos fijos de la
 * plantilla, igual que en la otra.
 *
 * Todo el movimiento vive en CSS (ver landing-oscura.css) y se apaga entero con
 * `prefers-reduced-motion`. Nada aparece condicionado a JavaScript: una portada que
 * se queda en blanco si un script falla no es una portada.
 */

/** Confeti: posiciones fijas. Aleatorio cambiaría en cada carga y no hay motivo. */
const CONFETTI = [
  { top: 7, left: 18, size: 10, kind: 'sq', tone: 'a' },
  { top: 16, left: 62, size: 7, kind: 'sq', tone: 'b' },
  { top: 28, left: 12, size: 9, kind: 'tri', tone: 'c' },
  { top: 38, left: 78, size: 8, kind: 'dot', tone: 'a' },
  { top: 52, left: 30, size: 7, kind: 'sq', tone: 'b' },
  { top: 63, left: 88, size: 10, kind: 'sq', tone: 'c' },
  { top: 72, left: 8, size: 8, kind: 'dot', tone: 'b' },
  { top: 84, left: 55, size: 9, kind: 'tri', tone: 'a' },
  { top: 91, left: 25, size: 7, kind: 'dot', tone: 'c' },
  { top: 12, left: 92, size: 8, kind: 'tri', tone: 'b' },
] as const;

export function LandingOscura() {
  const d = useLandingData();
  const { t, eur } = d;

  const marquee = [
    d.freeFrom !== null ? `Envío gratis desde ${eur(d.freeFrom)}` : null,
    d.prepTime ? `Listo en ${d.prepTime}` : null,
    'Apuntes · TFG · Oposiciones',
    'Pago seguro',
  ].filter(Boolean) as string[];

  return (
    <main className="dk">
      {t.banner && (
        <div className="dk-banner">
          <span>{t.banner}</span>
        </div>
      )}

      <div className="dk-coil" aria-hidden />

      <section className="dk-hero">
        {/* Confeti: decorativo, y se para solo si el sistema pide menos movimiento. */}
        <div className="dk-confetti" aria-hidden>
          {CONFETTI.map((c, i) => (
            <span
              key={i}
              className={`dk-cf dk-cf-${c.kind} dk-tone-${c.tone}`}
              style={{
                top: `${c.top}%`,
                left: `${c.left}%`,
                width: c.size,
                height: c.size,
                animationDuration: `${6 + (i % 5) * 1.4}s`,
                animationDelay: `${(i * 0.9) % 6}s`,
              }}
            />
          ))}
        </div>
        <div className="dk-in dk-hero-grid">
          <div>
            {d.logo && <img className="dk-logo" src={d.logo} alt={d.shop} />}
            <h1>{t.claim}</h1>
            <p className="dk-sub">{t.subclaim}</p>
            {d.from !== null && (
              <p className="dk-price">
                desde <b>{d.perPage(d.from)}</b> la página
              </p>
            )}
            <div className="dk-btns">
              <a className="dk-b1" href="/imprimir">
                <Icon name="upload" />
                Sube tus documentos
              </a>
              <a className="dk-b2" href="/recoger">
                Seguir mi pedido
              </a>
            </div>
            {t.trust && <p className="dk-trust">{t.trust}</p>}
          </div>
          {/* Con foto, la foto; sin foto, el cuaderno dibujado. Nunca un hueco. */}
          {t.heroImage ? (
            <div className="dk-pad dk-pad-photo">
              <img
                className="dk-shot"
                src={t.heroImage}
                alt=""
                /* Decorativa: lo que cuenta ya está en el titular, y un lector de
                   pantalla no debería leer la descripción de una foto de adorno. */
                aria-hidden
                loading="eager"
              />
            </div>
          ) : (
            <div className="dk-pad" aria-hidden>
              <span className="dk-sheet dk-s1" />
              <span className="dk-sheet dk-s2" />
              <span className="dk-sheet dk-s3">
                <span className="dk-rings" />
                <span className="dk-lines" />
              </span>
            </div>
          )}
        </div>
      </section>

      {marquee.length > 0 && (
        <div className="dk-mq">
          {/* Dos copias seguidas: el bucle desplaza la mitad y no se ve el corte. */}
          <div className="dk-mq-in" aria-hidden>
            {[...marquee, ...marquee].map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          {/* Para lectores de pantalla, una sola vez y quieto. */}
          <p className="sr-only">{marquee.join('. ')}</p>
        </div>
      )}

      {d.notices.length > 0 && (
        <section className="dk-sec">
          <div className="dk-in dk-board">
            {d.notices.map((n, i) => (
              <article className="dk-note" key={`${n.title}-${i}`}>
                <h3>{n.title}</h3>
                {/* Texto plano, nunca HTML. */}
                <p>{n.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="dk-coil dk-coil-pink" aria-hidden />

      <section className="dk-sec">
        <div className="dk-in">
          <h3 className="dk-h">Qué te imprimimos</h3>
          <p className="dk-lead">Todo sale de la misma tienda, y todo lo ves antes de pagarlo.</p>
          <div className="dk-cards">
            <a className="dk-card dk-c-neon" href="/imprimir">
              <i>
                <Icon name="printer" />
              </i>
              <h4>Apuntes y temarios</h4>
              <p>A4, A5 o A3, en color o blanco y negro, a doble cara y encuadernado con las anillas que elijas.</p>
              <span className="dk-go">Empezar a imprimir →</span>
            </a>
            {t.showMugs && (
              <a className="dk-card dk-c-pink" href="/tazas">
                <i>
                  <Icon name="mug" />
                </i>
                <h4>Tazas</h4>
                <p>Tu foto o tu diseño. La ves en 3D antes de pedirla.</p>
                <span className="dk-go">Diseñar mi taza →</span>
              </a>
            )}
            {t.showBadges && (
              <a className="dk-card dk-c-lime" href="/chapas">
                <i>
                  <Icon name="badge" />
                </i>
                <h4>Chapas</h4>
                <p>Con imperdible, imán, espejo o abrebotellas. Para tu grupo, tu banda o tu clase.</p>
                <span className="dk-go">Diseñar mis chapas →</span>
              </a>
            )}
          </div>

          <h3 className="dk-h dk-h2">Tres pasos y ya</h3>
          <p className="dk-lead">Sin registrarte, sin llamar y sin explicárselo a nadie por el mostrador.</p>
          <ol className="dk-steps">
            <li className="dk-step">
              <span className="dk-n" aria-hidden>
                1
              </span>
              <i>
                <Icon name="upload" />
              </i>
              <b>Sube el PDF</b>
              <p>Uno o veinte. Da igual el tamaño.</p>
            </li>
            <li className="dk-step">
              <span className="dk-n" aria-hidden>
                2
              </span>
              <i>
                <Icon name="sliders" />
              </i>
              <b>Elige cómo</b>
              <p>Color, doble cara, anillas. El precio se mueve mientras tocas.</p>
            </li>
            <li className="dk-step">
              <span className="dk-n" aria-hidden>
                3
              </span>
              <i>
                <Icon name="truck" />
              </i>
              <b>Recoge o recíbelo</b>
              <p>
                {d.freeFrom !== null
                  ? `En tienda o en tu casa. Gratis desde ${eur(d.freeFrom)}.`
                  : 'En tienda o en tu casa.'}
              </p>
            </li>
          </ol>
        </div>
      </section>

      {d.hasContact && (
        <section className="dk-sec">
          <div className="dk-in">
            <h3 className="dk-h">Dónde estamos</h3>
            <p className="dk-lead">Y si prefieres preguntar antes, escríbenos.</p>
            <div className="dk-contact">
              {d.address && (
                <div className="dk-ci">
                  <i>
                    <Icon name="pin" />
                  </i>
                  <div>
                    <s>Dirección</s>
                    <span>{d.address}</span>
                  </div>
                </div>
              )}
              {d.phone && (
                <div className="dk-ci">
                  <i>
                    <Icon name="phone" />
                  </i>
                  <div>
                    <s>Teléfono</s>
                    <a href={`tel:${d.phone.replace(/\s/g, '')}`}>{d.phone}</a>
                  </div>
                </div>
              )}
              {d.email && (
                <div className="dk-ci">
                  <i>
                    <Icon name="mail" />
                  </i>
                  <div>
                    <s>Correo</s>
                    <a href={`mailto:${d.email}`}>{d.email}</a>
                  </div>
                </div>
              )}
            </div>
            {d.wa && (
              <a className="dk-wa" href={d.wa} target="_blank" rel="noopener noreferrer">
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
