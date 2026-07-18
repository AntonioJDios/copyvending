// Pure pricing core, shared by the client (via pricing.ts) and the server
// (Vercel functions). Only TYPE imports (erased at runtime), so it is safe to
// import from a serverless function without runtime module-resolution issues.
import type { Catalog } from './catalog';
import type { ColorMode, Configuracion, DobleCara, DocFile, Grosor, Size } from './types';

/** Only the fields pricing actually needs from a document. */
export type PricedFile = Pick<DocFile, 'pages' | 'color'>;

/** pagePrices key (kept in sync with catalog.priceKey). */
function key(size: Size, grosor: Grosor, color: ColorMode, cara: DobleCara): string {
  return `${size}-${grosor}-${color}-${cara}`;
}

export function pagePrice(catalog: Catalog, size: Size, grosor: Grosor, color: ColorMode, dobleCara: DobleCara): number {
  return catalog.pagePrices[key(size, grosor, color, dobleCara)] ?? 0;
}

/** Printed sides for a document: ceil(pages / pagesPerSheet). */
export function printedSides(pages: number, paginasPorHoja: number): number {
  return Math.ceil(pages / paginasPorHoja);
}

/** Physical sheets for a document, accounting for double-sided printing. */
export function sheets(pages: number, paginasPorHoja: number, dobleCara: DobleCara): number {
  return Math.ceil(printedSides(pages, paginasPorHoja) / (1 + Number(dobleCara)));
}

/**
 * Cost of a single document for ONE copy: printing + colour + sheet finishing
 * (laminate/stickers) + per-file finishing (perforate/holes). Excludes the
 * binding (a per-binding cost shared across grouped documents).
 */
export function documentCost(doc: PricedFile, config: Configuracion, catalog: Catalog): number {
  const { size, grosor, color, dobleCara, paginasPorHoja } = config;
  const sides = printedSides(doc.pages, paginasPorHoja);
  const sheetsN = sheets(doc.pages, paginasPorHoja, dobleCara);

  let c = sides * pagePrice(catalog, size, grosor, color, dobleCara);
  if (color === 'BN') {
    if (doc.color === 'all') c += sides * catalog.colorSurcharge[size];
    else if (doc.color === 'cover') c += catalog.coverColorSurcharge;
  }
  if (config.acabadoFolios === 'plastificar') c += sheetsN * catalog.laminateSurcharge[size];
  if (config.acabadoFolios === 'pegatinas') c += sides * catalog.stickerPrice;
  if (config.acabado === 'perforado') c += catalog.perforatePrice;
  if (config.acabado === 'dos_agujeros' || config.acabado === 'cuatro_agujeros') c += catalog.holesPrice;
  return c;
}

/** Cost added by ONE binding: finishing price + per-binding surcharges. */
export function bindingExtraCost(config: Configuracion, catalog: Catalog): number {
  const noMargins = config.sinMargenes ? catalog.noMarginsPrice : 0;
  const extraFolios = config.acabado === 'sinencuadernacion' ? 0 : config.foliosDelante + config.foliosDetras;
  return catalog.bindingPrices[config.acabado] + noMargins + extraFolios * catalog.extraFolioPrice;
}

export interface PriceInput {
  config: Configuracion;
  files: PricedFile[];
  copias: number;
}

export interface PriceBreakdown {
  totalPrintedSides: number;
  totalSheets: number;
  colorSides: number;
  colorCovers: number;
  bindings: number;
  perUnit: number;
  total: number;
}

/** Faithful port of CalculoPrecioTotal × copias, driven by the Catalog. */
export function computePrice({ config, files, copias }: PriceInput, catalog: Catalog): PriceBreakdown {
  const { paginasPorHoja, dobleCara } = config;

  const totalPrintedSides = files.reduce((s, f) => s + printedSides(f.pages, paginasPorHoja), 0);
  const totalSheets = files.reduce((s, f) => s + sheets(f.pages, paginasPorHoja, dobleCara), 0);
  const colorSides = files.filter((f) => f.color === 'all').reduce((s, f) => s + printedSides(f.pages, paginasPorHoja), 0);
  const colorCovers = files.filter((f) => f.color === 'cover').length;

  const bindings = config.juntos === 'agrupados' ? (files.length > 0 ? 1 : 0) : files.length;
  const noMargins = config.sinMargenes ? catalog.noMarginsPrice : 0;

  const docsCost = files.reduce((s, f) => s + documentCost(f, config, catalog), 0);
  const bindingCost = (catalog.bindingPrices[config.acabado] + noMargins) * bindings;
  const extraFolios = config.acabado === 'sinencuadernacion' ? 0 : config.foliosDelante + config.foliosDetras;
  const extraFoliosCost = extraFolios * catalog.extraFolioPrice * bindings;
  const perUnit = docsCost + bindingCost + extraFoliosCost;

  return { totalPrintedSides, totalSheets, colorSides, colorCovers, bindings, perUnit, total: perUnit * copias };
}
