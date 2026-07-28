import type { Catalog } from './catalog';
import type { Configuracion } from './types';
import * as engine from './priceEngine';
import type { PriceInput, PricedFile } from './priceEngine';

// The math lives in priceEngine (shared with the server). These wrappers keep
// the client's existing API.
//
// The `catalog` argument is REQUIRED: there is no built-in fallback, because
// prices only exist in the DB catalog. A missing catalog must surface as "no
// price yet", never as a silently wrong number from a hardcoded default.
export type { PriceInput, PriceBreakdown, PricedFile } from './priceEngine';

export const pagePrice = engine.pagePrice;
export const printedSides = engine.printedSides;
export const sheets = engine.sheets;

export function documentCost(doc: PricedFile, config: Configuracion, catalog: Catalog): number {
  return engine.documentCost(doc, config, catalog);
}
export function bindingExtraCost(config: Configuracion, catalog: Catalog): number {
  return engine.bindingExtraCost(config, catalog);
}
export function computePrice(input: PriceInput, catalog: Catalog): engine.PriceBreakdown {
  return engine.computePrice(input, catalog);
}
