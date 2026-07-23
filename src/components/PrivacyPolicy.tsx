import { useConfigurator } from '../store/useConfigurator';
import { DEFAULT_BUSINESS } from '../domain/catalog';

/**
 * Privacy policy (RGPD/LOPDGDD). The shop's identity is filled from the admin
 * "Datos del negocio"; anything not set falls back to a bracketed placeholder.
 * Kept simple and honest; not legal advice.
 */
export function PrivacyPolicy() {
  const b = useConfigurator((s) => s.catalog.business) ?? DEFAULT_BUSINESS;
  const name = b.name || '[NOMBRE DEL NEGOCIO / TITULAR]';
  const nif = b.nif || '[NIF]';
  const address = b.address || '[DIRECCIÓN]';
  const email = b.email || '[EMAIL DE CONTACTO]';
  return (
    <div className="app">
      <header className="topbar">
        <h1>Política de privacidad</h1>
        <nav className="topnav">
          <a className="btn" href="#">← Volver</a>
        </nav>
      </header>

      <div className="legal-page">
        <p className="muted">
          Última actualización: [FECHA] · Versión 1.0. <b>Plantilla</b>: sustituye los campos entre corchetes por los datos reales del negocio.
        </p>

        <h2>1. Responsable del tratamiento</h2>
        <p>
          {name}, con NIF {nif}, domicilio en {address} y correo de contacto {email}, es el responsable del
          tratamiento de tus datos personales.
        </p>

        <h2>2. Qué datos recogemos</h2>
        <ul>
          <li>Datos identificativos y de contacto: <b>nombre, apellidos, email y teléfono</b>.</li>
          <li>Datos del pedido: los archivos que subes y las opciones de impresión que eliges.</li>
        </ul>

        <h2>3. Para qué los usamos</h2>
        <ul>
          <li>Gestionar, preparar y entregar tu pedido.</li>
          <li>Avisarte del estado del pedido y localizarlo en el mostrador.</li>
          <li>Si creas una cuenta, conservar tus datos para gestionar tus pedidos y agilizar los siguientes.</li>
        </ul>

        <h2>4. Base legal</h2>
        <p>
          El tratamiento para gestionar tu pedido se basa en la <b>ejecución del contrato</b> (la prestación del
          servicio que solicitas). La creación de una cuenta y la conservación de tus datos para futuros pedidos se
          basan en tu <b>consentimiento</b>, que puedes retirar en cualquier momento.
        </p>

        <h2>5. Conservación</h2>
        <p>
          Conservamos los datos del pedido durante el tiempo necesario para prestarte el servicio y, después, durante
          los plazos legales aplicables (por ejemplo, obligaciones fiscales y contables). Los datos de tu cuenta se
          conservan mientras la mantengas activa.
        </p>

        <h2>6. Destinatarios</h2>
        <p>
          No cedemos tus datos a terceros salvo obligación legal. Utilizamos proveedores que nos prestan servicios
          técnicos (alojamiento y almacenamiento de archivos) actuando como encargados del tratamiento.
        </p>

        <h2>7. Tus derechos</h2>
        <p>
          Puedes ejercer los derechos de <b>acceso, rectificación, supresión, oposición, limitación y portabilidad</b>
          escribiendo a {email}, indicando tu solicitud. También puedes presentar una reclamación ante la
          Agencia Española de Protección de Datos (<span className="muted">www.aepd.es</span>) si consideras que no se
          han atendido debidamente.
        </p>

        <h2>8. Cambios en esta política</h2>
        <p>
          Podemos actualizar esta política para adaptarla a cambios legales o del servicio. Publicaremos siempre la
          versión vigente en esta página.
        </p>
      </div>
    </div>
  );
}
