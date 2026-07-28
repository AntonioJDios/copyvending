import { describe, expect, it } from 'vitest';
import { allowedGrosores, defaultGrosor, doubleSidedAllowed, normalize, validate } from '../src/domain/rules';
import type { Configuracion, DocFile } from '../src/domain/types';
import { BASE_CONFIG, TEST_CATALOG } from './fixtures/catalog';

/**
 * These rules stop the shop from accepting jobs it physically cannot print
 * (250 gr through the duplexer, 400 sheets in one spiral, stickers in A3…).
 * `normalize` runs on every option change, so a mistake here silently produces
 * unprintable orders.
 */

const cfg = (over: Partial<Configuracion> = {}): Configuracion => ({ ...BASE_CONFIG, ...over });
const file = (pages: number): DocFile => ({ id: 'f1', name: 'doc.pdf', pages, color: 'no' }) as DocFile;

describe('allowedGrosores / defaultGrosor', () => {
  it('lists only the grammages offered for that size', () => {
    expect(allowedGrosores(TEST_CATALOG, 'A4')).toEqual([80, 90, 100, 120, 250]);
    expect(allowedGrosores(TEST_CATALOG, 'A3')).toEqual([100, 250]);
    expect(allowedGrosores(TEST_CATALOG, 'A5')).toEqual([90]);
  });

  it('prefers 90 gr as the default, else the first available', () => {
    expect(defaultGrosor(TEST_CATALOG, 'A4')).toBe(90);
    expect(defaultGrosor(TEST_CATALOG, 'A3')).toBe(100); // no 90 gr in A3
  });
});

describe('doubleSidedAllowed', () => {
  it('refuses double-sided on 250 gr card', () => {
    expect(doubleSidedAllowed({ grosor: 250 })).toBe(false);
    expect(doubleSidedAllowed({ grosor: 90 })).toBe(true);
  });
});

describe('normalize', () => {
  it('moves an impossible grammage to the size default', () => {
    // A5 only offers 90 gr in the fixture
    expect(normalize(cfg({ size: 'A5', grosor: 120 }), TEST_CATALOG).grosor).toBe(90);
  });

  it('keeps a valid grammage untouched', () => {
    expect(normalize(cfg({ size: 'A4', grosor: 120 }), TEST_CATALOG).grosor).toBe(120);
  });

  it('drops back to one side when the paper is too thick to duplex', () => {
    expect(normalize(cfg({ grosor: 250, dobleCara: '1' }), TEST_CATALOG).dobleCara).toBe('0');
  });

  it('forces separate handling for punched/drilled finishes', () => {
    for (const acabado of ['perforado', 'dos_agujeros', 'cuatro_agujeros'] as const) {
      expect(normalize(cfg({ acabado, juntos: 'agrupados' }), TEST_CATALOG).juntos).toBe('individual');
    }
  });

  it('clears the blank sheets when there is no binding to add them to', () => {
    const out = normalize(cfg({ acabado: 'sinencuadernacion', foliosDelante: 3, foliosDetras: 2 }), TEST_CATALOG);
    expect(out.foliosDelante).toBe(0);
    expect(out.foliosDetras).toBe(0);
  });

  it('keeps the blank sheets when there IS a binding', () => {
    const out = normalize(cfg({ acabado: 'AnillasColores', foliosDelante: 3, foliosDetras: 2 }), TEST_CATALOG);
    expect(out.foliosDelante).toBe(3);
  });

  it('never mutates the configuration it was given', () => {
    const input = cfg({ grosor: 250, dobleCara: '1' });
    normalize(input, TEST_CATALOG);
    expect(input.dobleCara).toBe('1');
  });

  it('is idempotent (normalising twice changes nothing more)', () => {
    const once = normalize(cfg({ size: 'A5', grosor: 250, dobleCara: '1', acabado: 'perforado', foliosDelante: 2 }), TEST_CATALOG);
    expect(normalize(once, TEST_CATALOG)).toEqual(once);
  });
});

describe('validate', () => {
  it('warns when a binding exceeds its physical sheet limit', () => {
    // AnillasColores caps at 350 sheets
    const w = validate(cfg({ acabado: 'AnillasColores' }), [file(400)], TEST_CATALOG);
    expect(w.map((x) => x.code)).toContain('binding-max');
  });

  it('does not warn just below the limit', () => {
    expect(validate(cfg({ acabado: 'AnillasColores' }), [file(350)], TEST_CATALOG)).toEqual([]);
  });

  it('counts SHEETS, not pages, against the limit', () => {
    // 400 pages double-sided = 200 sheets → fits in a 350-sheet spiral
    expect(validate(cfg({ acabado: 'AnillasColores', dobleCara: '1' }), [file(400)], TEST_CATALOG)).toEqual([]);
  });

  it('adds up the sheets of every document', () => {
    const w = validate(cfg({ acabado: 'grapado' }), [file(60), file(60)], TEST_CATALOG); // cap 100
    expect(w.map((x) => x.code)).toContain('binding-max');
  });

  it('rejects the sticker combinations the machine cannot do', () => {
    const codes = validate(
      cfg({ acabadoFolios: 'pegatinas', size: 'A3', acabado: 'grapado', dobleCara: '1', grosor: 250 }),
      [file(2)],
      TEST_CATALOG
    ).map((w) => w.code);
    expect(codes).toContain('sticker-size');
    expect(codes).toContain('sticker-binding');
    expect(codes).toContain('sticker-side');
    expect(codes).toContain('sticker-gsm');
  });

  it('accepts stickers in the supported setup', () => {
    expect(validate(cfg({ acabadoFolios: 'pegatinas', size: 'A4', grosor: 90 }), [file(2)], TEST_CATALOG)).toEqual([]);
  });
});
