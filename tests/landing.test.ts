import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, landingOf } from '../src/domain/catalog';

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
});
