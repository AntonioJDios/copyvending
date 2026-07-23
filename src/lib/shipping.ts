import type { ShippingConfig } from '../domain/catalog';

export type Zone = 'peninsula' | 'baleares' | 'canarias';

/** Zone from a Spanish postal code (first two digits). Baleares = 07,
 *  Canarias = 35/38 (not served). Everything else → peninsula. */
export function zoneForCP(cp: string): Zone | null {
  const p = (cp || '').trim().slice(0, 2);
  if (!/^\d{2}$/.test(p)) return null;
  if (p === '35' || p === '38') return 'canarias';
  if (p === '07') return 'baleares';
  return 'peninsula';
}

export interface ShippingQuote {
  allowed: boolean;
  zone: Zone | null;
  cost: number;
  free: boolean;
  /** € left to reach free shipping (0 if already free or no threshold). */
  toFree: number;
}

/** Compute the shipping quote for a postal code and an order subtotal. */
export function shippingQuote(cfg: ShippingConfig, cp: string, subtotal: number): ShippingQuote {
  const zone = zoneForCP(cp);
  if (!zone || zone === 'canarias') return { allowed: false, zone, cost: 0, free: false, toFree: 0 };
  const base = zone === 'baleares' ? cfg.baleares : cfg.peninsula;
  const threshold = cfg.freeThreshold || 0;
  const free = threshold > 0 && subtotal >= threshold;
  const toFree = threshold > 0 && subtotal < threshold ? Math.round((threshold - subtotal) * 100) / 100 : 0;
  return { allowed: true, zone, cost: free ? 0 : base, free, toFree };
}
