import { describe, expect, it } from 'vitest';
import { itemTotal as serverItemTotal, applySource as serverApplySource } from '../api/orders';
import { projectTotal, toCents, type PricedProject } from '../src/domain/orderTotal';
import { catalogForSource, type Catalog, type SourceKey } from '../src/domain/catalog';
import type { Acabado, AcabadoFolios, Configuracion, DobleCara, Grosor, PaginasPorHoja, Size } from '../src/domain/types';
import { BASE_CONFIG, TEST_CATALOG } from './fixtures/catalog';

/**
 * THE MOST IMPORTANT TEST IN THIS REPO.
 *
 * The pricing MATH exists twice: once in src/domain/priceEngine.ts (what the
 * customer sees) and once, hand-copied, inside api/orders.ts (what actually gets
 * charged, since the server never trusts the browser's price). The duplication is
 * forced by Vercel's requirement that functions be self-contained; it disappears
 * with the move to Cloudflare, where routes can share code.
 *
 * Until then, this test is what keeps the two honest: it runs the same catalogs
 * and the same orders through both and demands they agree TO THE CENT. If they
 * ever drift, every order silently gets a total the customer didn't agree to —
 * and the server would flag it as `price_mismatch`, blaming the customer for our
 * bug. When the duplication goes away, so can this file.
 */

// The server's PriceCatalog is a structural subset of the client's Catalog (same
// fields, looser key types), so the same fixture drives both engines.
const asServerCatalog = (c: Catalog) => c as unknown as Parameters<typeof serverItemTotal>[1];

/** The item shape the server receives in the order payload. */
function serverItem(p: {
  config: Configuracion;
  docs: { pages: number; color: string }[];
  copias: number;
  colorAnillas?: string;
  colorContraportada?: string;
}): Record<string, unknown> {
  return {
    kind: 'copias',
    config: p.config,
    docs: p.docs,
    copias: p.copias,
    colorAnillas: p.colorAnillas,
    colorContraportada: p.colorContraportada,
  };
}

/** Same order, both engines, compared in cents. */
function expectParity(label: string, p: Parameters<typeof serverItem>[0], catalog: Catalog): void {
  const client = projectTotal(
    {
      kind: 'copias',
      config: p.config,
      docs: p.docs.map((d) => ({ pages: d.pages, color: d.color as 'no' | 'cover' | 'all' })),
      copias: p.copias,
      colorAnillas: p.colorAnillas,
      colorContraportada: p.colorContraportada,
    },
    catalog
  );
  const server = serverItemTotal(serverItem(p), asServerCatalog(catalog));
  expect(toCents(server), `${label}: cliente ${client.toFixed(4)} € vs servidor ${server.toFixed(4)} €`).toBe(toCents(client));
}

// Exercise the whole option space rather than a couple of happy paths: any
// divergence tends to hide in one specific combination.
const SIZES: Size[] = ['A4', 'A3', 'A5'];
const GROSORES: Grosor[] = [90, 100, 250];
const CARAS: DobleCara[] = ['0', '1'];
const NUP: PaginasPorHoja[] = [1, 2, 4];
const ACABADOS: Acabado[] = ['sinencuadernacion', 'grapado', 'AnillasColores', 'dos_agujeros', 'cuatro_agujeros', 'perforado'];
const FOLIOS: AcabadoFolios[] = ['normal', 'plastificar', 'pegatinas'];
const DOC_COLORS = ['no', 'cover', 'all'];

describe('pricing parity: client engine vs the copy inside api/orders.ts', () => {
  it('agrees on the baseline order', () => {
    expectParity('base', { config: BASE_CONFIG, docs: [{ pages: 10, color: 'no' }], copias: 1 }, TEST_CATALOG);
  });

  it('agrees across every paper size, grammage and duplex mode', () => {
    for (const size of SIZES) {
      for (const grosor of GROSORES) {
        for (const dobleCara of CARAS) {
          for (const color of ['BN', 'Color'] as const) {
            const config = { ...BASE_CONFIG, size, grosor, dobleCara, color };
            expectParity(`${size}/${grosor}/${color}/cara-${dobleCara}`, { config, docs: [{ pages: 7, color: 'no' }], copias: 1 }, TEST_CATALOG);
          }
        }
      }
    }
  });

  it('agrees across every finish, sheet treatment and grouping', () => {
    for (const acabado of ACABADOS) {
      for (const acabadoFolios of FOLIOS) {
        for (const juntos of ['agrupados', 'individual'] as const) {
          const config = { ...BASE_CONFIG, acabado, acabadoFolios, juntos };
          expectParity(
            `${acabado}/${acabadoFolios}/${juntos}`,
            { config, docs: [{ pages: 10, color: 'no' }, { pages: 3, color: 'no' }], copias: 2, colorAnillas: 'Lila', colorContraportada: 'Plástico Rojo' },
            TEST_CATALOG
          );
        }
      }
    }
  });

  it('agrees on per-document colour choices', () => {
    for (const docColor of DOC_COLORS) {
      for (const color of ['BN', 'Color'] as const) {
        expectParity(
          `doc-${docColor}/job-${color}`,
          { config: { ...BASE_CONFIG, color }, docs: [{ pages: 9, color: docColor }], copias: 1 },
          TEST_CATALOG
        );
      }
    }
  });

  it('agrees with n-up, blank sheets, borderless and multiple copies combined', () => {
    for (const paginasPorHoja of NUP) {
      for (const sinMargenes of [false, true]) {
        const config = { ...BASE_CONFIG, acabado: 'AnillasColores' as Acabado, paginasPorHoja, sinMargenes, foliosDelante: 2, foliosDetras: 1 };
        expectParity(
          `nup-${paginasPorHoja}/sinMargenes-${String(sinMargenes)}`,
          { config, docs: [{ pages: 33, color: 'all' }], copias: 3, colorAnillas: 'Lila', colorContraportada: 'Plástico Rojo' },
          TEST_CATALOG
        );
      }
    }
  });

  it('agrees on odd page counts (the rounding-up boundaries)', () => {
    for (const pages of [1, 2, 3, 5, 11, 99, 100, 101]) {
      for (const dobleCara of CARAS) {
        expectParity(
          `${pages}p/cara-${dobleCara}`,
          { config: { ...BASE_CONFIG, dobleCara, paginasPorHoja: 2 }, docs: [{ pages, color: 'no' }], copias: 1 },
          TEST_CATALOG
        );
      }
    }
  });

  it('agrees on an empty document list', () => {
    expectParity('sin documentos', { config: { ...BASE_CONFIG, acabado: 'AnillasColores' }, docs: [], copias: 1 }, TEST_CATALOG);
  });

  it('agrees on prices that are not configured (missing catalog keys)', () => {
    // A5 + 250 gr has no price in the fixture: both engines must fall back the same way.
    expectParity('precio inexistente', { config: { ...BASE_CONFIG, size: 'A5', grosor: 250 }, docs: [{ pages: 10, color: 'all' }], copias: 1 }, TEST_CATALOG);
  });

  it('agrees on products (mug / badge)', () => {
    for (const kind of ['taza', 'chapa'] as const) {
      for (const cantidad of [0, 1, 5]) {
        const client = projectTotal({ kind, cantidad } as PricedProject, TEST_CATALOG);
        const server = serverItemTotal({ kind, cantidad }, asServerCatalog(TEST_CATALOG));
        expect(toCents(server), `${kind} ×${cantidad}`).toBe(toCents(client));
      }
    }
  });
});

describe('per-channel price resolution parity', () => {
  const catalog: Catalog = {
    ...TEST_CATALOG,
    sources: {
      mostrador: {
        pagePrices: { 'A4-90-BN-0': 0.03 },
        bindingPrices: { AnillasColores: 1.5 },
        colorSurcharge: { A4: 0.05 },
        laminateSurcharge: { A4: 0.8 },
        coverColorSurcharge: 0.4,
        perforatePrice: 0.4,
        holesPrice: 0.05,
        stickerPrice: 0.15,
        noMarginsPrice: 0.9,
        extraFolioPrice: 0.08,
        mugPrice: 8,
        badgePrice: 2,
        ringExtras: { Lila: 0.1 },
        coverExtras: { 'Plástico Rojo': 0.2 },
      },
      online: {},
    },
  };

  it('resolves the same effective catalog on both sides', () => {
    for (const source of ['online', 'mostrador', 'email'] as SourceKey[]) {
      const client = catalogForSource(catalog, source);
      const server = serverApplySource(asServerCatalog(catalog), source);
      // Compare through the engines: the field-by-field shapes differ slightly
      // (the client also resolves module flags), the PRICES must not.
      const config: Configuracion = { ...BASE_CONFIG, acabado: 'AnillasColores', acabadoFolios: 'plastificar', sinMargenes: true, foliosDelante: 1 };
      const item = serverItem({ config, docs: [{ pages: 12, color: 'all' }], copias: 2, colorAnillas: 'Lila', colorContraportada: 'Plástico Rojo' });
      const clientTotal = projectTotal(
        { kind: 'copias', config, docs: [{ pages: 12, color: 'all' }], copias: 2, colorAnillas: 'Lila', colorContraportada: 'Plástico Rojo' },
        client
      );
      expect(toCents(serverItemTotal(item, server)), `canal ${source}`).toBe(toCents(clientTotal));
    }
  });

  it('actually charges the counter tariff for the counter channel', () => {
    const counter = serverApplySource(asServerCatalog(catalog), 'mostrador');
    const web = serverApplySource(asServerCatalog(catalog), 'online');
    const item = serverItem({ config: BASE_CONFIG, docs: [{ pages: 10, color: 'no' }], copias: 1 });
    expect(serverItemTotal(item, counter)).toBeCloseTo(0.3, 10);
    expect(serverItemTotal(item, web)).toBeCloseTo(0.5, 10);
  });
});
