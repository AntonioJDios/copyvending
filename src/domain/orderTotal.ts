// Authoritative order pricing, shared by client and server. Structural project
// types (kind + priced fields) so it doesn't depend on the store's CartProject.
import type { Catalog } from './catalog';
import type { Configuracion } from './types';
import { computePrice, type PricedFile } from './priceEngine';

export type PricedProject =
  | { kind: 'copias'; config: Configuracion; docs: PricedFile[]; copias: number }
  | { kind: 'taza'; cantidad: number }
  | { kind: 'chapa'; cantidad: number };

/** Price of one project using the given (Neon-persisted) catalog. */
export function projectTotal(p: PricedProject, catalog: Catalog): number {
  if (p.kind === 'copias') return computePrice({ config: p.config, files: p.docs, copias: p.copias }, catalog).total;
  if (p.kind === 'taza') return catalog.mugPrice * Math.max(1, p.cantidad || 1);
  if (p.kind === 'chapa') return catalog.badgePrice * Math.max(1, p.cantidad || 1);
  return 0;
}

export function orderTotal(items: PricedProject[], catalog: Catalog): number {
  return items.reduce((s, p) => s + projectTotal(p, catalog), 0);
}

/** Round to cents for comparisons/storage. */
export function toCents(n: number): number {
  return Math.round(n * 100);
}
