import { describe, expect, it } from 'vitest';
import { parseBackup } from '../src/lib/catalogBackup';
import { TEST_CATALOG } from './fixtures/catalog';

/**
 * The backup file is the only way back if the shop's prices are lost, and
 * restoring it OVERWRITES the live catalog. So the validation is a safety device:
 * it must refuse anything that would leave the shop unable to charge.
 */

const goodFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'copisteria-backup',
    formatVersion: 1,
    exportedAt: '2026-07-28T10:00:00.000Z',
    catalog: TEST_CATALOG,
    coupons: [{ code: 'VERANO', type: 'percent', value: 10, active: true }],
    ...over,
  });

describe('parseBackup', () => {
  it('accepts a well-formed backup and reports what it contains', () => {
    const p = parseBackup(goodFile());
    expect(p.priceCount).toBe(Object.keys(TEST_CATALOG.pagePrices).length);
    expect(p.coupons).toHaveLength(1);
    expect(p.exportedAt).toBe('2026-07-28T10:00:00.000Z');
    expect(p.catalog.mugPrice).toBe(TEST_CATALOG.mugPrice);
  });

  it('rejects a file that is not JSON', () => {
    expect(() => parseBackup('no soy json')).toThrow(/JSON/i);
  });

  it('rejects some other JSON file the owner picked by mistake', () => {
    expect(() => parseBackup('{"hola":1}')).toThrow(/copia de seguridad/i);
    expect(() => parseBackup('[]')).toThrow();
  });

  it('rejects a backup from a different catalog version', () => {
    expect(() => parseBackup(goodFile({ catalog: { ...TEST_CATALOG, version: 5 } }))).toThrow(/versión/i);
  });

  it('rejects a backup with no catalog at all', () => {
    expect(() => parseBackup(goodFile({ catalog: null }))).toThrow(/catálogo/i);
  });

  it('REFUSES a price-less backup (restoring it would stop the shop charging)', () => {
    expect(() => parseBackup(goodFile({ catalog: { ...TEST_CATALOG, pagePrices: {} } }))).toThrow(/precios/i);
  });

  it('tolerates a backup without coupons', () => {
    expect(parseBackup(goodFile({ coupons: undefined })).coupons).toEqual([]);
    expect(parseBackup(goodFile({ coupons: 'nope' })).coupons).toEqual([]);
  });
});
