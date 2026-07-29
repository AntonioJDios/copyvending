import { useConfigurator } from '../store/useConfigurator';
import {
  DEFAULT_BUSINESS,
  DEFAULT_PAYMENTS,
  DEFAULT_PAY_MATRIX,
  DEFAULT_SHIPPING,
  DEFAULT_VAT_PERCENT,
  legalOf,
} from '../domain/catalog';
import { LegalOverride } from './LegalOverride';
import { TERMS_VERSION } from '../lib/legal';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

/**
 * Terms of sale (condiciones generales de contratación).
 *
 * Generated from the shop's ACTUAL configuration — VAT rate, shipping zones and
 * rates, free-shipping threshold, accepted payment methods — so it can't drift out
 * of date when prices change. Anything the owner must still decide (deadlines,
 * phone) shows as a bracketed placeholder.
 *
 * The section that matters most legally is §8: personalised goods are excluded
 * from the 14-day withdrawal right, and that exclusion only holds if the customer
 * was told BEFORE buying — which is why the checkout requires accepting this text.
 *
 * DRAFT: have it reviewed before opening the shop. See docs/legales.md.
 */
export function TermsOfSale() {
  const b = useConfigurator((s) => s.catalog.business) ?? DEFAULT_BUSINESS;
  const shipping = useConfigurator((s) => s.catalog.shipping) ?? DEFAULT_SHIPPING;
  const payments = useConfigurator((s) => s.catalog.payments) ?? DEFAULT_PAYMENTS;
  const invoicing = useConfigurator((s) => s.catalog.invoicing);
  const legal = legalOf(useConfigurator((s) => s.catalog));

  const name = b.name || '[NOMBRE DEL NEGOCIO / TITULAR]';
  const nif = b.nif || '[NIF]';
  const address = b.address || '[DIRECCIÓN]';
  const email = b.email || '[EMAIL DE CONTACTO]';
  const vat = invoicing?.vatPercent ?? DEFAULT_VAT_PERCENT;

  const shipOn = !!shipping.enabled;
  const freeFrom = Number(shipping.freeThreshold) || 0;
  const payLocal = payments.local?.enabled !== false;
  const payOnline = !!payments.redsys?.enabled;
  const matrix = payments.matrix ?? DEFAULT_PAY_MATRIX;
  const body = legal.termsText.trim();

  return (
    <div className="app">
      <header className="topbar">
        <h1>Condiciones de venta</h1>
        <nav className="topnav">
          <a className="btn" href="#aviso-legal">Aviso legal</a>
          <a className="btn" href="#privacidad">Privacidad</a>
          <a className="btn" href="#">← Volver</a>
        </nav>
      </header>

      {body ? <LegalOverride text={body} /> : (
      <div className="legal-page">
        <p className="muted">
          Última actualización: {legal.updatedAt || '[FECHA]'} · Versión {TERMS_VERSION}. <b>Plantilla</b>: los importes, formas de pago y zonas
          de envío se toman automáticamente de la configuración de la tienda; sustituye los campos entre corchetes
          (plazos, teléfono) por los datos reales.
        </p>

        <h2>1. Objeto y aceptación</h2>
        <p>
          Estas condiciones regulan la contratación de productos y servicios de impresión y personalización a través de
          este sitio. Al confirmar un pedido, el cliente declara haberlas leído y aceptado. Se recomienda conservar una
          copia: la versión vigente en el momento de la compra queda registrada con el pedido.
        </p>

        <h2>2. Vendedor</h2>
        <p>
          {name}, NIF {nif}, con domicilio en {address} y correo de contacto {email}. Datos completos en el{' '}
          <a href="#aviso-legal">aviso legal</a>.
        </p>

        <h2>3. Productos y servicios</h2>
        <p>
          Impresión y copia de documentos aportados por el cliente (en distintos tamaños y gramajes, en blanco y negro o
          en color, con distintos acabados y encuadernaciones), plastificado, pegatinas y artículos personalizados como
          tazas y chapas. Todos los
          trabajos se producen <b>según las especificaciones que el propio cliente configura</b> en el pedido.
        </p>

        <h2>4. Precios e impuestos</h2>
        <ul>
          <li>Todos los precios se muestran en euros y <b>con el IVA incluido</b> (tipo aplicado: {vat}%).</li>
          <li>
            El precio del trabajo se calcula a partir de la configuración elegida (tamaño, color, caras, gramaje,
            acabado, número de copias…). El importe mostrado antes de confirmar es el que se cobra.
          </li>
          <li>
            El precio se <b>recalcula y verifica en nuestro servidor</b> al registrar el pedido. Si se detectara un error
            evidente de precio, se avisará al cliente antes de producir el trabajo y podrá confirmar o cancelar sin coste.
          </li>
          <li>Los gastos de envío, cuando procedan, se indican por separado antes de confirmar (apartado 6).</li>
        </ul>

        <h2>5. Proceso de compra</h2>
        <ol>
          <li>El cliente sube sus archivos y configura el trabajo; el precio se muestra en todo momento.</li>
          <li>Añade el trabajo al carrito y facilita sus datos de contacto.</li>
          <li>Elige la forma de entrega (recogida o envío) y la forma de pago.</li>
          <li>
            Confirma el pedido, acepta estas condiciones y recibe un <b>código de pedido</b> con el que puede consultar su
            estado (junto con su email).
          </li>
        </ol>
        <p>
          El contrato se perfecciona con la confirmación del pedido. Se enviará confirmación por correo electrónico a la
          dirección facilitada.
        </p>

        <h2>6. Entrega, plazos y gastos de envío</h2>
        <p>
          <b>Recogida en tienda.</b> El pedido se prepara y se avisa por correo cuando está listo. Plazo habitual de
          preparación: {legal.prepTime || '[PLAZO DE PREPARACIÓN]'}, que puede variar según el volumen del trabajo y
          los acabados solicitados. El pedido se conserva en tienda a disposición del cliente durante {legal.custodyDays || '[DÍAS DE CUSTODIA]'}.
        </p>
        {shipOn ? (
          <>
            <p>
              <b>Envío a domicilio.</b> Realizamos envíos a península y Baleares mediante agencia de transporte. Plazo
              estimado de entrega: {legal.deliveryTime || '[PLAZO DE ENTREGA]'} desde que el pedido sale del taller, y
              en todo caso dentro del plazo máximo de 30 días naturales desde la confirmación.
            </p>
            <ul>
              <li><b>Península:</b> {eur(Number(shipping.peninsula) || 0)}</li>
              <li><b>Baleares:</b> {eur(Number(shipping.baleares) || 0)}</li>
              {freeFrom > 0 && (
                <li><b>Envío gratuito</b> en pedidos iguales o superiores a {eur(freeFrom)} (importe de los productos, sin contar el envío).</li>
              )}
              <li>
                <b>No se realizan envíos a Canarias, Ceuta ni Melilla</b> (Canarias por su régimen aduanero; consúltanos
                para otros destinos).
              </li>
            </ul>
            {shipping.info?.trim() && <p>{shipping.info.trim()}</p>}
          </>
        ) : (
          <p>
            <b>Envío a domicilio.</b> Actualmente no se ofrecen envíos: los pedidos se recogen en la tienda.
          </p>
        )}
        <p>
          Si la entrega se retrasa por causa que nos sea imputable, el cliente podrá solicitar la resolución del contrato
          y el reembolso de lo pagado, salvo en trabajos ya producidos conforme al apartado 8.
        </p>

        <h2>7. Formas de pago</h2>
        <ul>
          {payLocal && <li><b>{payments.local?.label || 'Pago en el mostrador'}</b> al recoger el pedido (efectivo o tarjeta en tienda).</li>}
          {payOnline && (
            <li>
              <b>Pago online con tarjeta o Bizum</b> a través de la pasarela segura de Redsys. Los datos de la tarjeta se
              introducen directamente en el entorno de la entidad bancaria: <b>no los recibimos ni los almacenamos</b>.
            </li>
          )}
          {!payLocal && !payOnline && <li>[FORMAS DE PAGO PENDIENTES DE CONFIGURAR]</li>}
        </ul>
        {shipOn && !matrix.envio?.local && (
          <p>
            Los pedidos <b>con envío a domicilio requieren pago anticipado</b>: no se admite el pago contra entrega.
          </p>
        )}

        <h2>8. Derecho de desistimiento y su excepción</h2>
        <p>
          Como regla general, el consumidor dispone de <b>14 días naturales</b> para desistir de una compra a distancia
          sin necesidad de justificación (artículos 102 y siguientes del Real Decreto Legislativo 1/2007, texto refundido
          de la Ley General para la Defensa de los Consumidores y Usuarios).
        </p>
        <p className="legal-highlight">
          <b>IMPORTANTE:</b> ese derecho <b>NO es aplicable</b> a los productos de esta tienda que se fabrican a partir de
          los archivos y las especificaciones del propio cliente. El artículo 103 del citado Real Decreto Legislativo
          excluye del desistimiento, entre otros supuestos, <b>«el suministro de bienes confeccionados conforme a las
          especificaciones del consumidor o claramente personalizados»</b>.
        </p>
        <p>
          En consecuencia, <b>no admiten devolución ni desistimiento</b>: las copias e impresiones de documentos, las
          encuadernaciones, los plastificados, las pegatinas y los artículos personalizados (tazas, chapas y similares),
          una vez producidos. Al confirmar el pedido, el cliente reconoce haber sido informado de esta exclusión y la
          acepta expresamente.
        </p>
        <p>
          Esta exclusión <b>no afecta</b> a los derechos del cliente en caso de producto defectuoso o que no se
          corresponda con lo pedido, que se regulan en el apartado 9.
        </p>
        <p>
          <b>Cancelación antes de producir.</b> Mientras el pedido no haya entrado en producción (estado “Recibido”), el
          cliente puede modificarlo o solicitar su cancelación sin coste escribiendo a {email} e indicando el código de
          pedido. Si ya se hubiera pagado, se reembolsará el importe íntegro por el mismo medio de pago.
        </p>

        <h2>9. Errores, falta de conformidad y reclamaciones</h2>
        <p>
          Respondemos de la <b>falta de conformidad</b> del trabajo entregado durante los plazos legalmente previstos. En
          particular, si el trabajo presenta un defecto de producción imputable a nosotros (páginas mal impresas o
          ilegibles, acabado distinto del solicitado, encuadernación defectuosa, artículo dañado), el cliente puede
          solicitar su <b>reimpresión o subsanación sin coste</b> y, si no fuera posible, la devolución del importe.
        </p>
        <p>
          Para ello, ponte en contacto en un plazo razonable desde la recepción, aportando el código de pedido y, si es
          posible, una fotografía del defecto.
        </p>
        <p>
          <b>No se consideran defectos</b> los derivados de la calidad o el contenido del archivo aportado por el cliente
          (baja resolución, fuentes no incrustadas, márgenes insuficientes, colores no calibrados o errores del propio
          documento). El configurador avisa de los problemas que puede detectar automáticamente antes de imprimir, pero
          la revisión final del archivo corresponde al cliente.
        </p>
        <p>
          Existen <b>hojas de reclamaciones</b> a disposición del consumidor en el establecimiento. También puedes
          dirigir tu reclamación a {email}.
        </p>

        <h2>10. Justificante de compra</h2>
        <p>
          Con cada pedido se emite un <b>ticket</b> (si está pagado) o un <b>albarán</b> (si el importe queda pendiente),
          descargable en PDF. Si necesitas <b>factura</b>, solicítala indicando los datos de facturación y te la
          emitiremos.
        </p>

        <h2>11. Archivos del cliente</h2>
        <p>
          El cliente es responsable del contenido de los archivos que sube y de disponer de los derechos necesarios para
          su reproducción, según lo indicado en el <a href="#aviso-legal">aviso legal</a>. El tratamiento de los datos
          personales se detalla en la <a href="#privacidad">política de privacidad</a>.
        </p>

        <h2>12. Legislación aplicable</h2>
        <p>
          Estas condiciones se rigen por la legislación española. En caso de conflicto serán competentes los juzgados y
          tribunales del domicilio del consumidor.
        </p>
      </div>
      )}
    </div>
  );
}
