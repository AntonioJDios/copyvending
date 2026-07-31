import { useConfigurator } from '../store/useConfigurator';
import { DEFAULT_BUSINESS, legalOf } from '../domain/catalog';
import { LegalOverride } from './LegalOverride';

/**
 * Legal notice (aviso legal, LSSI-CE art. 10). Same pattern as PrivacyPolicy: the
 * shop's identity comes from the admin "Datos del negocio" and anything missing
 * shows as a bracketed placeholder, so it is obvious what still has to be filled.
 *
 * Drafted to be complete and honest, but it is a DRAFT: have it reviewed before
 * opening the shop. See docs/legales.md.
 */
export function LegalNotice() {
  const b = useConfigurator((s) => s.catalog.business) ?? DEFAULT_BUSINESS;
  const legal = legalOf(useConfigurator((s) => s.catalog));
  const name = b.name || '[NOMBRE DEL NEGOCIO / TITULAR]';
  const nif = b.nif || '[NIF]';
  const address = b.address || '[DIRECCIÓN]';
  const email = b.email || '[EMAIL DE CONTACTO]';

  const body = legal.legalNoticeText.trim();

  return (
    <div className="app">
      <header className="topbar">
        <h1>Aviso legal</h1>
        <nav className="topnav">
          <a className="btn" href="/condiciones">Condiciones de venta</a>
          <a className="btn" href="/privacidad">Privacidad</a>
          <a className="btn" href="/">← Volver</a>
        </nav>
      </header>

      {body ? <LegalOverride text={body} /> : (
      <div className="legal-page">
        <p className="muted">
          Última actualización: {legal.updatedAt || '[FECHA]'} · Versión 1.0. <b>Plantilla</b>: sustituye los campos entre corchetes por los
          datos reales del negocio (se rellenan solos desde “Datos del negocio” en el panel de administración).
        </p>

        <h2>1. Titular del sitio web</h2>
        <p>
          En cumplimiento del artículo 10 de la Ley 34/2002 de Servicios de la Sociedad de la Información y de Comercio
          Electrónico (LSSI-CE), se informa de los datos del titular de este sitio:
        </p>
        <ul>
          <li><b>Titular:</b> {name}</li>
          <li><b>NIF:</b> {nif}</li>
          <li><b>Domicilio:</b> {address}</li>
          <li><b>Correo electrónico:</b> {email}</li>
          <li><b>Teléfono:</b> {legal.phone || '[TELÉFONO]'}</li>
          <li><b>Actividad:</b> servicios de reprografía, impresión digital, encuadernación y personalización de artículos.</li>
          {legal.registro.trim() ? <li><b>Datos registrales:</b> {legal.registro}</li> : null}
        </ul>

        <h2>2. Objeto</h2>
        <p>
          Este sitio permite configurar y encargar trabajos de impresión y artículos personalizados, subiendo los
          archivos del propio usuario, así como consultar el estado de los pedidos. El acceso al sitio es gratuito, sin
          perjuicio del precio de los productos y servicios que se contraten.
        </p>

        <h2>3. Condiciones de uso</h2>
        <p>
          El usuario se compromete a utilizar el sitio conforme a la ley y a este aviso legal, y en particular a:
        </p>
        <ul>
          <li>Facilitar datos veraces en el pedido y mantenerlos actualizados.</li>
          <li>No utilizar el servicio con fines ilícitos ni para reproducir contenidos que infrinjan derechos de terceros.</li>
          <li>No intentar alterar el funcionamiento del sitio ni acceder a datos de otros usuarios.</li>
        </ul>

        <h2>4. Responsabilidad sobre los archivos y los derechos de autor</h2>
        <p>
          El usuario es el <b>único responsable</b> del contenido de los archivos que sube y declara que ostenta los
          derechos necesarios para su reproducción, o que la copia está amparada por un límite legal al derecho de autor.
        </p>
        <p>
          {name} actúa como prestador de un servicio técnico de reproducción y <b>no revisa ni supervisa</b> el
          contenido de los archivos. Nos reservamos el derecho de rechazar o interrumpir un encargo cuando existan
          indicios razonables de que reproducirlo infringe derechos de terceros o la legislación vigente, o cuando su
          contenido sea manifiestamente ilícito. En tal caso se comunicará al usuario y no se cobrará el trabajo no
          realizado.
        </p>

        <h2>5. Propiedad intelectual del sitio</h2>
        <p>
          Los contenidos propios del sitio (textos, diseño, código, imágenes de producto y marcas) pertenecen a{' '}
          {name} o se utilizan con autorización, y no pueden reproducirse sin consentimiento. Los archivos subidos por el
          usuario siguen siendo suyos: no adquirimos ningún derecho sobre ellos más allá de lo necesario para ejecutar el
          pedido.
        </p>

        <h2>6. Enlaces</h2>
        <p>
          Si el sitio incluye enlaces a páginas de terceros (por ejemplo, el seguimiento de un envío), no respondemos de
          su contenido ni de sus políticas.
        </p>

        <h2>7. Protección de datos</h2>
        <p>
          El tratamiento de los datos personales se describe en la{' '}
          <a href="/privacidad">política de privacidad</a>.
        </p>

        <h2>8. Cookies</h2>
        <p>
          Este sitio <b>no utiliza cookies de analítica, publicidad ni seguimiento</b>. Únicamente emplea
          almacenamiento técnico en tu propio navegador (necesario para mantener el carrito, tu sesión y las opciones de
          impresión que eliges), que está exento del deber de consentimiento previo por ser imprescindible para prestar
          el servicio que solicitas. Si en el futuro se incorporan herramientas de analítica, se solicitará tu
          consentimiento mediante un aviso específico.
        </p>

        <h2>9. Legislación aplicable y resolución de conflictos</h2>
        <p>
          Este aviso legal se rige por la legislación española. Para cualquier controversia serán competentes los
          juzgados y tribunales del domicilio del consumidor, conforme a la normativa de defensa de consumidores y
          usuarios.
        </p>

        <h2>10. Modificaciones</h2>
        <p>
          Podemos modificar este aviso legal para adaptarlo a cambios legales o del servicio. Se publicará siempre la
          versión vigente en esta página.
        </p>
      </div>
      )}
    </div>
  );
}
