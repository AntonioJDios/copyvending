import { describe, expect, it } from 'vitest';
import { cheapestPagePrice, DEFAULT_LANDING, landingOf } from '../src/domain/catalog';

/**
 * The home page reads its texts from the shop's configuration. A catalogue saved
 * before this feature existed has no `landing` key at all, and a shop that saved
 * only one field has a partial one — in both cases the page must still render, so
 * the accessor has to fill the gaps rather than hand back `undefined`.
 */
describe('textos de la portada', () => {
  it('un catálogo sin portada usa los valores por defecto', () => {
    expect(landingOf(undefined)).toEqual(DEFAULT_LANDING);
    expect(landingOf({ landing: undefined })).toEqual(DEFAULT_LANDING);
  });

  it('completa los campos que falten sin perder los guardados', () => {
    const partial = landingOf({ landing: { claim: 'Imprime en Málaga' } as never });
    expect(partial.claim).toBe('Imprime en Málaga');
    expect(partial.subclaim).toBe(DEFAULT_LANDING.subclaim);
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
    const texts = `${DEFAULT_LANDING.claim} ${DEFAULT_LANDING.subclaim} ${DEFAULT_LANDING.trust}`.toLowerCase();
    for (const brand of ['fotocopiator', 'aljaybe', 'copyvending']) {
      expect(texts).not.toContain(brand);
    }
  });

  it('el aviso y el tablón nacen vacíos', () => {
    // Una tienda recién instalada no debe mostrar una tira de aviso en blanco ni
    // una sección de anuncios sin anuncios.
    expect(DEFAULT_LANDING.banner).toBe('');
    expect(DEFAULT_LANDING.notices).toEqual([]);
  });

  it('conserva los anuncios guardados', () => {
    const notices = [{ title: 'Vuelta al cole', text: 'Ya tenemos el material.' }];
    expect(landingOf({ landing: { ...DEFAULT_LANDING, notices } }).notices).toEqual(notices);
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
 * Las plantillas son un juego cerrado y las dos leen los MISMOS datos. Lo que se
 * vigila aquí es que un valor raro en la base de datos (una plantilla de una
 * versión futura, o un dedazo) no deje la tienda sin portada.
 */
describe('plantillas de portada', () => {
  it('por defecto es la clara', () => {
    // Una tienda que no ha elegido nada no debe encontrarse una portada en negro.
    expect(DEFAULT_LANDING.template).toBe('clara');
    expect(landingOf(undefined).template).toBe('clara');
  });

  it('respeta la plantilla guardada', () => {
    expect(landingOf({ landing: { ...DEFAULT_LANDING, template: 'oscura' } }).template).toBe('oscura');
  });

  it('un valor desconocido no rompe la configuración', () => {
    // El componente cae en la clara ante cualquier cosa que no sea 'oscura'; aquí
    // solo se comprueba que el valor llega tal cual y no revienta al leerlo.
    const raro = landingOf({ landing: { ...DEFAULT_LANDING, template: 'neon' as never } });
    expect(raro.claim).toBe(DEFAULT_LANDING.claim);
    expect(raro.template).toBe('neon');
  });
});
