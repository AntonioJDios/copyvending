import { describe, expect, it } from 'vitest';
import {
  activeContent,
  isSafeImageUrl,
  cheapestPagePrice,
  DEFAULT_CONTENT_CLARA,
  DEFAULT_CONTENT_OSCURA,
  DEFAULT_LANDING,
  landingOf,
} from '../src/domain/catalog';

/**
 * La portada lee sus textos de la configuración de la tienda. Un catálogo guardado
 * antes de que esto existiera no tiene la clave `landing`, y una tienda que solo
 * cambió un campo la tiene a medias: en los dos casos la página tiene que
 * renderizarse igual, así que el accesor rellena los huecos.
 */
describe('textos de la portada', () => {
  it('un catálogo sin portada usa los valores por defecto', () => {
    expect(landingOf(undefined)).toEqual(DEFAULT_LANDING);
    expect(landingOf({ landing: undefined })).toEqual(DEFAULT_LANDING);
  });

  it('completa los campos que falten sin perder los guardados', () => {
    const partial = landingOf({ landing: { clara: { claim: 'Imprime en Málaga' } } as never });
    expect(partial.clara.claim).toBe('Imprime en Málaga');
    expect(partial.clara.subclaim).toBe(DEFAULT_CONTENT_CLARA.subclaim);
    expect(partial.showMugs).toBe(true);
  });

  it('respeta el ocultar productos de la portada', () => {
    const hidden = landingOf({ landing: { ...DEFAULT_LANDING, showMugs: false, showBadges: false } });
    expect(hidden.showMugs).toBe(false);
    expect(hidden.showBadges).toBe(false);
  });

  it('los textos por defecto no nombran ninguna tienda concreta', () => {
    // El mismo build sirve a varias copisterías: un valor por defecto con el
    // nombre de una de ellas aparecería en la web de las demás.
    const texts = [DEFAULT_CONTENT_CLARA, DEFAULT_CONTENT_OSCURA]
      .map((c) => `${c.claim} ${c.subclaim} ${c.trust} ${c.banner}`)
      .join(' ')
      .toLowerCase();
    for (const brand of ['fotocopiator', 'aljaybe', 'copyvending']) {
      expect(texts).not.toContain(brand);
    }
  });

  it('el aviso y el tablón nacen vacíos en las dos portadas', () => {
    // Una tienda recién instalada no debe mostrar una tira de aviso en blanco ni
    // una sección de anuncios sin anuncios.
    for (const c of [DEFAULT_CONTENT_CLARA, DEFAULT_CONTENT_OSCURA]) {
      expect(c.banner).toBe('');
      expect(c.notices).toEqual([]);
    }
  });
});

/**
 * Cada plantilla guarda SUS textos. Lo importante aquí es que cambiar de portada
 * no pise lo escrito en la otra: la tienda tiene que poder probar la oscura y
 * volverse atrás sin haber perdido su tablón.
 */
describe('textos por plantilla', () => {
  const cfg = landingOf({
    landing: {
      template: 'clara',
      clara: { ...DEFAULT_CONTENT_CLARA, claim: 'Copistería del centro' },
      oscura: { ...DEFAULT_CONTENT_OSCURA, claim: 'Sin dramas', notices: [{ title: 'Ojo', text: 'Cerrado' }] },
    } as never,
  });

  it('cada plantilla conserva lo suyo', () => {
    expect(cfg.clara.claim).toBe('Copistería del centro');
    expect(cfg.oscura.claim).toBe('Sin dramas');
    expect(cfg.oscura.notices).toHaveLength(1);
    // Y la clara no se ha contaminado con los anuncios de la oscura.
    expect(cfg.clara.notices).toEqual([]);
  });

  it('activeContent devuelve los de la plantilla puesta', () => {
    expect(activeContent(cfg).claim).toBe('Copistería del centro');
    expect(activeContent({ ...cfg, template: 'oscura' }).claim).toBe('Sin dramas');
  });

  it('por defecto es la clara', () => {
    // Una tienda que no ha elegido nada no debe encontrarse una portada en negro.
    expect(DEFAULT_LANDING.template).toBe('clara');
    expect(landingOf(undefined).template).toBe('clara');
  });

  it('una plantilla desconocida cae en la clara', () => {
    // Un valor viejo o un dedazo en la base de datos no puede dejar sin portada.
    expect(landingOf({ landing: { template: 'neon' } as never }).template).toBe('clara');
  });
});

/**
 * Migración. Las configuraciones guardadas ANTES de que hubiera plantillas tenían
 * los textos sueltos en la raíz. Si no se recogieran, una tienda que ya había
 * escrito su portada y su tablón los vería desaparecer al desplegar.
 */
describe('configuraciones guardadas antes de las plantillas', () => {
  const viejo = landingOf({
    landing: {
      claim: 'Tu copistería de siempre',
      banner: 'Cerrado en agosto',
      notices: [{ title: 'Vuelta al cole', text: 'Ya tenemos material' }],
      showMugs: false,
    } as never,
  });

  it('los textos sueltos pasan a ser los de la clara', () => {
    expect(viejo.clara.claim).toBe('Tu copistería de siempre');
    expect(viejo.clara.banner).toBe('Cerrado en agosto');
    expect(viejo.clara.notices).toHaveLength(1);
  });

  it('no se pierden los ajustes compartidos', () => {
    expect(viejo.showMugs).toBe(false);
  });

  it('la oscura arranca con sus propios valores, no con los heredados', () => {
    expect(viejo.oscura.claim).toBe(DEFAULT_CONTENT_OSCURA.claim);
    expect(viejo.oscura.banner).toBe('');
  });
});

/**
 * El «desde X €» de la portada sale de la tarifa real. Es publicidad: si sale un
 * número inventado (o un cero porque la tienda aún no tiene precios), es
 * publicidad engañosa, no un fallo estético.
 */
describe('precio «desde» de la portada', () => {
  it('es el más bajo de la tarifa', () => {
    expect(cheapestPagePrice({ pagePrices: { a: 0.05, b: 0.019, c: 0.12 } })).toBe(0.019);
  });

  it('sin precios cargados no dice nada, en lugar de anunciar 0 €', () => {
    expect(cheapestPagePrice({ pagePrices: {} })).toBeNull();
    expect(cheapestPagePrice(undefined)).toBeNull();
  });

  it('ignora los ceros y los valores no numéricos', () => {
    // Un 0 en la tarifa suele ser una tarifa a medio rellenar, no impresión gratis.
    expect(cheapestPagePrice({ pagePrices: { a: 0, b: 0.04 } })).toBe(0.04);
    expect(cheapestPagePrice({ pagePrices: { a: Number.NaN, b: 0.04 } })).toBe(0.04);
    expect(cheapestPagePrice({ pagePrices: { a: 0 } })).toBeNull();
  });
});

/**
 * La dirección de la imagen de portada la escribe la tienda a mano, así que hay
 * que mirarla. No es tanto por seguridad —un `src` no ejecuta `javascript:` en los
 * navegadores actuales— como por no dejarlo dependiendo del navegador, y sobre
 * todo por no romper el candado de la página con un http a secas.
 */
describe('dirección de la imagen de portada', () => {
  it('acepta https y rutas del propio sitio', () => {
    expect(isSafeImageUrl('https://fotocopiator.es/portada.jpg')).toBe(true);
    expect(isSafeImageUrl('/imagenes/portada.jpg')).toBe(true);
  });

  it('vacío es válido: significa sin imagen', () => {
    expect(isSafeImageUrl('')).toBe(true);
    expect(isSafeImageUrl('   ')).toBe(true);
  });

  it('rechaza http, javascript y lo que no sea una dirección', () => {
    expect(isSafeImageUrl('http://fotocopiator.es/portada.jpg')).toBe(false);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeImageUrl('portada.jpg')).toBe(false);
  });
});
