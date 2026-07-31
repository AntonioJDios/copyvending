import { useConfigurator } from '../../store/useConfigurator';
import { cheapestPagePrice, DEFAULT_BUSINESS, landingOf, legalOf, type LandingConfig, type Notice } from '../../domain/catalog';

/**
 * Todo lo que necesita una portada, ya calculado.
 *
 * Existe para que las plantillas se diferencien SOLO en la presentación. Si cada
 * una leyera la configuración por su cuenta, en tres meses una mostraría el envío
 * gratis con una condición y la otra con otra, y ese tipo de divergencia no la
 * detecta nadie hasta que un cliente se queja.
 *
 * Dos reglas que se aplican aquí y no en el marcado:
 *
 *  - **Nada inventado.** El «desde X €» sale de la tarifa real y el umbral de envío
 *    gratis de la configuración de envíos. Un precio escrito a mano en una portada
 *    se queda viejo, y un precio viejo en una portada es publicidad engañosa.
 *  - **Lo que no está configurado no se promete.** Cada campo puede venir vacío, y
 *    entonces la plantilla no lo pinta en lugar de mostrar un hueco o un cero.
 */
export interface LandingData {
  /** Textos editables por la tienda. */
  t: LandingConfig;
  /** Nombre de la tienda (o un genérico si no está configurado). */
  shop: string;
  /** Logo como data URL, o cadena vacía. */
  logo: string;
  address: string;
  email: string;
  phone: string;
  /** Enlace a WhatsApp ya montado, o cadena vacía si no hay teléfono. */
  wa: string;
  prepTime: string;
  deliveryTime: string;
  /** Precio por página más bajo de la tarifa, o null si no hay que mostrarlo. */
  from: number | null;
  /** Umbral de envío gratis, o null si la tienda no lo ofrece. */
  freeFrom: number | null;
  notices: Notice[];
  /** ¿Hay algún dato de contacto que mostrar? */
  hasContact: boolean;
  /** Formato de importe: 33,00 €. */
  eur: (n: number) => string;
  /** Formato de precio por página: los céntimos importan, 0,019 € no es 0,02 €. */
  perPage: (n: number) => string;
}

export function useLandingData(): LandingData {
  const catalog = useConfigurator((s) => s.catalog);
  const t = landingOf(catalog);
  const b = catalog.business ?? DEFAULT_BUSINESS;
  const legal = legalOf(catalog);
  const ship = catalog.shipping;

  // Solo un umbral real y activado: «envío gratis desde 0 €» no significa nada, y
  // anunciar un envío gratis que la tienda no ofrece es peor que no decir nada.
  const freeFrom = ship?.enabled && Number(ship.freeThreshold) > 0 ? Number(ship.freeThreshold) : null;

  const phone = legal.phone;
  const digits = phone.replace(/\D/g, '');
  // Móvil español sin prefijo: se le añade el 34.
  const wa = digits ? `https://wa.me/${digits.length === 9 ? `34${digits}` : digits}` : '';

  return {
    t,
    shop: b.name || 'Copistería',
    logo: b.logo || '',
    address: b.address || '',
    email: b.email || '',
    phone,
    wa,
    prepTime: legal.prepTime,
    deliveryTime: legal.deliveryTime,
    from: t.showPriceFrom ? cheapestPagePrice(catalog) : null,
    freeFrom,
    notices: t.notices,
    hasContact: !!(b.address || phone || b.email),
    eur: (n) => `${n.toFixed(2).replace('.', ',')} €`,
    perPage: (n) => `${n.toFixed(n < 0.1 ? 3 : 2).replace('.', ',')} €`,
  };
}
