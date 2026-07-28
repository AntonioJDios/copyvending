import { describe, expect, it } from 'vitest';
import { computePrice, documentCost, printedSides, sheets } from '../src/domain/priceEngine';
import { projectTotal } from '../src/domain/orderTotal';
import { catalogForSource, type Catalog } from '../src/domain/catalog';
import type { Configuracion } from '../src/domain/types';
import { BASE_CONFIG, TEST_CATALOG } from './fixtures/catalog';

/**
 * The pricing engine is the most expensive thing in this codebase to get wrong:
 * a silent error here under/over-charges every single order. Every expected
 * number below is worked out by hand in the comment above it.
 */

const cfg = (over: Partial<Configuracion> = {}): Configuracion => ({ ...BASE_CONFIG, ...over });
/** A 10-page all-black document. */
const doc = (pages = 10, color: 'no' | 'cover' | 'all' = 'no') => ({ pages, color });
const total = (config: Configuracion, files: { pages: number; color: 'no' | 'cover' | 'all' }[], copias = 1, ring?: string, cover?: string) =>
  computePrice({ config, files, copias, colorAnillas: ring, colorContraportada: cover }, TEST_CATALOG).total;

describe('printedSides / sheets', () => {
  it('one page per side, one side per sheet', () => {
    expect(printedSides(10, 1)).toBe(10);
    expect(sheets(10, 1, '0')).toBe(10);
  });

  it('halves the sheets when printing double-sided', () => {
    expect(sheets(10, 1, '1')).toBe(5);
  });

  it('rounds an odd page count UP to a whole sheet (you cannot print half a sheet)', () => {
    expect(sheets(11, 1, '1')).toBe(6);
  });

  it('reduces sides with n-up, rounding up', () => {
    expect(printedSides(10, 2)).toBe(5);
    expect(printedSides(11, 2)).toBe(6);
    expect(printedSides(10, 4)).toBe(3);
  });

  it('combines n-up and double-sided', () => {
    // 10 pages, 2 per side → 5 sides → 3 sheets (the last one printed on one side)
    expect(sheets(10, 2, '1')).toBe(3);
  });
});

describe('documentCost', () => {
  it('charges per printed side at the size/grammage/colour/duplex price', () => {
    // 10 sides × 0.05 = 0.50
    expect(documentCost(doc(), cfg(), TEST_CATALOG)).toBeCloseTo(0.5, 10);
  });

  it('uses the duplex price list when printing double-sided', () => {
    // 10 sides × 0.04 (A4-90-BN-1) = 0.40 — sides, not sheets, are what is charged
    expect(documentCost(doc(), cfg({ dobleCara: '1' }), TEST_CATALOG)).toBeCloseTo(0.4, 10);
  });

  it('adds the colour surcharge per side for a full-colour document in a B/N job', () => {
    // 0.50 + 10 sides × 0.10 = 1.50
    expect(documentCost(doc(10, 'all'), cfg(), TEST_CATALOG)).toBeCloseTo(1.5, 10);
  });

  it('adds a single flat surcharge for a colour cover only', () => {
    // 0.50 + 0.50 (once, not per side) = 1.00
    expect(documentCost(doc(10, 'cover'), cfg(), TEST_CATALOG)).toBeCloseTo(1, 10);
  });

  it('does not add a colour surcharge when the whole job already prints in colour', () => {
    // 10 × 0.20 (A4-90-Color-0), no surcharge on top
    expect(documentCost(doc(10, 'all'), cfg({ color: 'Color' }), TEST_CATALOG)).toBeCloseTo(2, 10);
  });

  it('charges laminating per SHEET', () => {
    // 0.50 + 10 sheets × 1.00 = 10.50
    expect(documentCost(doc(), cfg({ acabadoFolios: 'plastificar' }), TEST_CATALOG)).toBeCloseTo(10.5, 10);
    // double-sided → 5 sheets → 0.40 + 5.00 = 5.40
    expect(documentCost(doc(), cfg({ acabadoFolios: 'plastificar', dobleCara: '1' }), TEST_CATALOG)).toBeCloseTo(5.4, 10);
  });

  it('charges stickers per SIDE', () => {
    // 0.50 + 10 sides × 0.20 = 2.50
    expect(documentCost(doc(), cfg({ acabadoFolios: 'pegatinas' }), TEST_CATALOG)).toBeCloseTo(2.5, 10);
  });

  it('adds the per-file punch/drill charges', () => {
    // perforado: 0.50 + 0.50
    expect(documentCost(doc(), cfg({ acabado: 'perforado' }), TEST_CATALOG)).toBeCloseTo(1, 10);
    // 2 holes: 0.50 + 0.10
    expect(documentCost(doc(), cfg({ acabado: 'dos_agujeros' }), TEST_CATALOG)).toBeCloseTo(0.6, 10);
    expect(documentCost(doc(), cfg({ acabado: 'cuatro_agujeros' }), TEST_CATALOG)).toBeCloseTo(0.6, 10);
  });

  it('charges 0 for a size/grammage combination with no price set', () => {
    // A5 has no 250 gr price in the fixture → the missing key must not blow up
    expect(documentCost(doc(), cfg({ size: 'A5', grosor: 250 }), TEST_CATALOG)).toBe(0);
  });
});

describe('computePrice — bindings', () => {
  it('charges ONE binding when the documents are bound together', () => {
    // 2 docs × 0.50 + 1 binding × 2.00 = 3.00
    expect(total(cfg({ acabado: 'AnillasColores', juntos: 'agrupados' }), [doc(), doc()])).toBeCloseTo(3, 10);
  });

  it('charges one binding PER document when bound separately', () => {
    // 2 docs × 0.50 + 2 bindings × 2.00 = 5.00
    expect(total(cfg({ acabado: 'AnillasColores', juntos: 'individual' }), [doc(), doc()])).toBeCloseTo(5, 10);
  });

  it('charges nothing at all with no documents', () => {
    expect(total(cfg({ acabado: 'AnillasColores' }), [])).toBe(0);
  });

  it('adds the ring and back-cover colour surcharges once per binding', () => {
    // 0.50 + 2.00 + (0.50 Lila + 0.25 rojo) = 3.25
    expect(total(cfg({ acabado: 'AnillasColores' }), [doc()], 1, 'Lila', 'Plástico Rojo')).toBeCloseTo(3.25, 10);
    // …twice with two separate bindings: 1.00 + 4.00 + 1.50 = 6.50
    expect(total(cfg({ acabado: 'AnillasColores', juntos: 'individual' }), [doc(), doc()], 1, 'Lila', 'Plástico Rojo')).toBeCloseTo(6.5, 10);
  });

  it('ignores colour surcharges for a finish that has no rings', () => {
    // grapado: 0.50 + 0.10, the Lila surcharge must NOT apply
    expect(total(cfg({ acabado: 'grapado' }), [doc()], 1, 'Lila', 'Plástico Rojo')).toBeCloseTo(0.6, 10);
  });

  it('charges the blank sheets added before/after each binding', () => {
    // 0.50 + 2.00 + (1+1) × 0.10 = 2.70
    expect(total(cfg({ acabado: 'AnillasColores', foliosDelante: 1, foliosDetras: 1 }), [doc()])).toBeCloseTo(2.7, 10);
  });

  it('ignores blank sheets when there is no binding to add them to', () => {
    // sinencuadernacion → just the printing
    expect(total(cfg({ foliosDelante: 5, foliosDetras: 5 }), [doc()])).toBeCloseTo(0.5, 10);
  });

  it('adds the borderless surcharge per binding', () => {
    // 0.50 + (2.00 + 1.00) = 3.50
    expect(total(cfg({ acabado: 'AnillasColores', sinMargenes: true }), [doc()])).toBeCloseTo(3.5, 10);
  });

  it('multiplies the whole unit price by the number of copies', () => {
    // (0.50 + 2.00 + 0.20 + 0.75) × 2 = 6.90
    const t = total(cfg({ acabado: 'AnillasColores', foliosDelante: 1, foliosDetras: 1 }), [doc()], 2, 'Lila', 'Plástico Rojo');
    expect(t).toBeCloseTo(6.9, 10);
  });

  it('treats 0 or a missing copy count as one copy', () => {
    const one = total(cfg(), [doc()], 1);
    expect(computePrice({ config: cfg(), files: [doc()], copias: 0 }, TEST_CATALOG).total).toBe(0);
    expect(one).toBeCloseTo(0.5, 10);
  });
});

describe('computePrice — breakdown reported to the customer', () => {
  it('reports sides, sheets, colour counts and bindings', () => {
    const b = computePrice(
      { config: cfg({ dobleCara: '1', acabado: 'AnillasColores' }), files: [doc(10, 'all'), doc(4, 'cover')], copias: 1 },
      TEST_CATALOG
    );
    expect(b.totalPrintedSides).toBe(14); // 10 + 4
    expect(b.totalSheets).toBe(7); // 5 + 2
    expect(b.colorSides).toBe(10); // only the 'all' document
    expect(b.colorCovers).toBe(1); // only the 'cover' document
    expect(b.bindings).toBe(1); // grouped
    expect(b.total).toBeCloseTo(b.perUnit, 10); // one copy
  });
});

describe('projectTotal — products', () => {
  it('prices mugs and badges per unit', () => {
    expect(projectTotal({ kind: 'taza', cantidad: 3 }, TEST_CATALOG)).toBeCloseTo(30, 10);
    expect(projectTotal({ kind: 'chapa', cantidad: 4 }, TEST_CATALOG)).toBeCloseTo(10, 10);
  });

  it('never charges less than one unit', () => {
    expect(projectTotal({ kind: 'taza', cantidad: 0 }, TEST_CATALOG)).toBeCloseTo(10, 10);
  });
});

describe('catalogForSource — per-channel prices', () => {
  const withCounterPrices: Catalog = {
    ...TEST_CATALOG,
    sources: {
      mostrador: { pagePrices: { 'A4-90-BN-0': 0.03 }, mugPrice: 8, ringExtras: { Lila: 0.1 } },
    },
  };

  it('applies the channel override and leaves the rest at the base price', () => {
    const counter = catalogForSource(withCounterPrices, 'mostrador');
    expect(counter.pagePrices['A4-90-BN-0']).toBe(0.03);
    expect(counter.pagePrices['A4-90-BN-1']).toBe(0.04); // untouched
    expect(counter.mugPrice).toBe(8);
    expect(counter.ringColors.find((c) => c.name === 'Lila')?.extra).toBe(0.1);
  });

  it('leaves a channel without overrides on the base prices', () => {
    const web = catalogForSource(withCounterPrices, 'online');
    expect(web.pagePrices['A4-90-BN-0']).toBe(0.05);
    expect(web.mugPrice).toBe(10);
  });

  it('makes the same job cheaper at the counter than on the web', () => {
    const web = computePrice({ config: cfg(), files: [doc()], copias: 1 }, catalogForSource(withCounterPrices, 'online')).total;
    const counter = computePrice({ config: cfg(), files: [doc()], copias: 1 }, catalogForSource(withCounterPrices, 'mostrador')).total;
    expect(web).toBeCloseTo(0.5, 10);
    expect(counter).toBeCloseTo(0.3, 10);
    // This gap is exactly why the server, not the browser, decides the channel.
    expect(counter).toBeLessThan(web);
  });
});
