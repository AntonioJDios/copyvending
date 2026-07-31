import { useConfigurator } from '../store/useConfigurator';
import { landingOf } from '../domain/catalog';
import { LandingClara } from './landing/LandingClara';
import { LandingOscura } from './landing/LandingOscura';

/**
 * Portada de la tienda: elige la plantilla que la tienda haya configurado.
 *
 * Las plantillas son un juego pequeño y cerrado de diseños con nombre, y cualquier
 * tienda puede elegir cualquiera — no hay ninguna hecha para un cliente concreto.
 * Las dos leen los mismos datos (ver landing/useLandingData), así que solo cambia
 * la presentación.
 *
 * Se seleccionan en Configuración → Portada. Una plantilla desconocida (un valor
 * viejo o mal escrito en la base de datos) cae en la clara en lugar de dejar la
 * web sin portada.
 */
export function Landing() {
  const template = useConfigurator((s) => landingOf(s.catalog).template);
  return template === 'oscura' ? <LandingOscura /> : <LandingClara />;
}
