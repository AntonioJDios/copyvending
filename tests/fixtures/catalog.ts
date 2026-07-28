import { EMPTY_CATALOG, type Catalog } from '../../src/domain/catalog';
import type { Configuracion } from '../../src/domain/types';

/**
 * TEST FIXTURE — these are NOT the shop's prices.
 *
 * The real prices live only in the database (`settings.catalog`); the code has
 * none. Tests still need *some* numbers, so we take the structure from
 * EMPTY_CATALOG and put deliberately round, easy-to-reason-about values on top.
 * Round numbers make the expected totals verifiable by hand, which is the whole
 * point: if the engine changes behaviour, the arithmetic below stops matching.
 *
 * To pin the real tariff instead, drop a catalog exported from the admin panel
 * (Herramientas → Descargar copia) into this folder and load it here.
 */
export const TEST_CATALOG: Catalog = {
  ...structuredClone(EMPTY_CATALOG),
  pagePrices: {
    'A4-90-BN-0': 0.05,
    'A4-90-BN-1': 0.04,
    'A4-90-Color-0': 0.2,
    'A4-90-Color-1': 0.18,
    'A4-250-BN-0': 0.3,
    'A4-250-Color-0': 0.5,
    'A3-100-BN-0': 0.1,
    'A5-90-BN-0': 0.03,
  },
  bindingPrices: {
    sinencuadernacion: 0,
    grapado: 0.1,
    AnillasColores: 2,
    dos_agujeros: 0.25,
    cuatro_agujeros: 0.25,
    perforado: 0,
  },
  bindingMaxSheets: { AnillasColores: 350, grapado: 100 },
  colorSurcharge: { A4: 0.1, A5: 0.1, A3: 0.2 },
  laminateSurcharge: { A4: 1, A5: 1, A3: 1.5 },
  coverColorSurcharge: 0.5,
  perforatePrice: 0.5,
  holesPrice: 0.1,
  stickerPrice: 0.2,
  noMarginsPrice: 1,
  extraFolioPrice: 0.1,
  mugPrice: 10,
  badgePrice: 2.5,
  // Two colours carry a surcharge so the per-binding colour extra is exercised.
  ringColors: EMPTY_CATALOG.ringColors.map((c) => ({ ...c, extra: c.name === 'Lila' ? 0.5 : 0 })),
  coverColors: EMPTY_CATALOG.coverColors.map((c) => ({ ...c, extra: c.name === 'Plástico Rojo' ? 0.25 : 0 })),
  shipping: { enabled: true, peninsula: 4.95, baleares: 8.95, freeThreshold: 30, info: '' },
};

/** Baseline print configuration: A4, 90 gr, B/N, one side, no finishing. */
export const BASE_CONFIG: Configuracion = {
  size: 'A4',
  color: 'BN',
  grosor: 90,
  dobleCara: '0',
  orientacion: 'vertical',
  paginasPorHoja: 1,
  acabado: 'sinencuadernacion',
  acabadoFolios: 'normal',
  juntos: 'agrupados',
  sinMargenes: false,
  ladoEncuadernacion: 'largo',
  foliosDelante: 0,
  foliosDetras: 0,
};
