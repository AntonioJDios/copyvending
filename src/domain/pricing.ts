import { DEFAULT_CATALOG, type Catalog } from './catalog';
import type { Configuracion } from './types';
import * as engine from './priceEngine';
import type { PriceInput, PricedFile } from './priceEngine';

// The math lives in priceEngine (shared with the server). These wrappers keep
// the client's existing API and default to DEFAULT_CATALOG for convenience.
export type { PriceInput, PriceBreakdown, PricedFile } from './priceEngine';

export const pagePrice = engine.pagePrice;
export const printedSides = engine.printedSides;
export const sheets = engine.sheets;

export function documentCost(doc: PricedFile, config: Configuracion, catalog: Catalog = DEFAULT_CATALOG): number {
  return engine.documentCost(doc, config, catalog);
}
export function bindingExtraCost(config: Configuracion, catalog: Catalog = DEFAULT_CATALOG): number {
  return engine.bindingExtraCost(config, catalog);
}
export function computePrice(input: PriceInput, catalog: Catalog = DEFAULT_CATALOG): engine.PriceBreakdown {
  return engine.computePrice(input, catalog);
}
