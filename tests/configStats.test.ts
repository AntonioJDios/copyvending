import { describe, expect, it } from 'vitest';
import { aggregate, pivotItemAgg, type ItemAggRow } from '../src/lib/stats';
import type { Order } from '../src/store/useOrders';
import { BASE_CONFIG } from './fixtures/catalog';

/**
 * The Configuraciones tab used to be computed in the browser over the latest 2000
 * orders, which silently under-reported older history. It now comes from a SQL
 * aggregation over the whole period.
 *
 * These tests pin the pivot AND check it against the original local aggregation:
 * both must produce the same buckets for the same data, or the figures would
 * change meaning the day we switched.
 */

const row = (over: Partial<ItemAggRow> = {}): ItemAggRow => ({
  kind: 'copias',
  size: 'A4',
  color: 'BN',
  grosor: '90',
  acabado: 'sinencuadernacion',
  doble_cara: '0',
  copias: '1',
  count: 1,
  revenue: 10,
  ...over,
});

describe('pivotItemAgg', () => {
  it('accumulates by the row count, not one per row', () => {
    const s = pivotItemAgg([row({ count: 7, revenue: 70 })]);
    expect(s.byConfig.size[0]).toEqual({ key: 'A4', count: 7, revenue: 70 });
  });

  it('merges rows that share a bucket', () => {
    const s = pivotItemAgg([
      row({ size: 'A4', grosor: '90', count: 2, revenue: 20 }),
      row({ size: 'A4', grosor: '250', count: 3, revenue: 60 }),
    ]);
    expect(s.byConfig.size).toEqual([{ key: 'A4', count: 5, revenue: 80 }]);
    expect(s.byConfig.grosor.map((b) => b.key).sort()).toEqual(['250', '90']);
  });

  it('builds the paper combination label like the local aggregation does', () => {
    const s = pivotItemAgg([row({ size: 'A3', color: 'Color', doble_cara: '1', grosor: '100' })]);
    expect(s.byCombo[0].key).toBe('A3 · Color · 2 caras · 100g');
  });

  it('buckets the copy count into ranges', () => {
    const s = pivotItemAgg([
      row({ copias: '1', count: 1 }),
      row({ copias: '4', count: 1 }),
      row({ copias: '30', count: 1 }),
      row({ copias: '500', count: 1 }),
    ]);
    // Compared as a set: sorting these labels alphabetically is misleading
    // ("21–50" sorts before "2–5" because '1' < the en dash).
    expect(new Set(s.byCopies.map((b) => b.key))).toEqual(
      new Set(['1 copia', '2–5 copias', '21–50 copias', '51+ copias'])
    );
  });

  it('counts products by type but gives them no print configuration', () => {
    const s = pivotItemAgg([
      row({ kind: 'taza', size: null, color: null, grosor: null, acabado: null, doble_cara: null, copias: '2', count: 2, revenue: 20 }),
      row({ kind: 'copias', count: 1, revenue: 5 }),
    ]);
    expect(s.byType.find((b) => b.key === 'taza')).toEqual({ key: 'taza', count: 2, revenue: 20 });
    // The mug must not appear in any paper breakdown.
    expect(s.byConfig.size.reduce((n, b) => n + b.count, 0)).toBe(1);
    expect(s.byCombo).toHaveLength(1);
  });

  it('skips missing configuration fields instead of inventing buckets', () => {
    const s = pivotItemAgg([row({ size: null, color: null, doble_cara: null, grosor: null })]);
    expect(s.byConfig.size).toEqual([]);
    expect(s.byCombo).toEqual([]); // no label without all four parts
    expect(s.byConfig.acabado).toHaveLength(1); // the one field still present
  });

  it('sorts buckets by revenue, highest first', () => {
    const s = pivotItemAgg([
      row({ size: 'A5', revenue: 5, count: 1 }),
      row({ size: 'A3', revenue: 50, count: 1 }),
      row({ size: 'A4', revenue: 20, count: 1 }),
    ]);
    expect(s.byConfig.size.map((b) => b.key)).toEqual(['A3', 'A4', 'A5']);
  });

  it('survives empty input and non-numeric figures', () => {
    expect(pivotItemAgg([]).byCombo).toEqual([]);
    const s = pivotItemAgg([row({ count: NaN as unknown as number, revenue: NaN })]);
    expect(s.byConfig.size[0]).toEqual({ key: 'A4', count: 0, revenue: 0 });
  });
});

describe('pivotItemAgg matches the local aggregate for the same data', () => {
  // Two print projects + a mug, exactly as an order stores them.
  const order = {
    id: 'P-TEST',
    createdAt: Date.now(),
    source: 'online',
    customer: { nombre: 'A', apellidos: 'B' },
    total: 35,
    status: 'nuevo',
    items: [
      { id: '1', kind: 'copias', nombre: 'x', config: { ...BASE_CONFIG }, docs: [], copias: 3, comentario: '', colorAnillas: '', colorContraportada: '', total: 10 },
      { id: '2', kind: 'copias', nombre: 'y', config: { ...BASE_CONFIG, size: 'A3', color: 'Color', grosor: 100, dobleCara: '1' }, docs: [], copias: 1, comentario: '', colorAnillas: '', colorContraportada: '', total: 20 },
      { id: '3', kind: 'taza', nombre: 'z', preview: '', cantidad: 2, total: 5 },
    ],
  } as unknown as Order;

  // The same thing as the server would group it.
  const rows: ItemAggRow[] = [
    row({ size: 'A4', color: 'BN', grosor: '90', doble_cara: '0', copias: '3', count: 1, revenue: 10 }),
    row({ size: 'A3', color: 'Color', grosor: '100', doble_cara: '1', copias: '1', count: 1, revenue: 20 }),
    row({ kind: 'taza', size: null, color: null, grosor: null, acabado: null, doble_cara: null, copias: '2', count: 1, revenue: 5 }),
  ];

  const local = aggregate([order], 0, Number.MAX_SAFE_INTEGER, 'all');
  const server = pivotItemAgg(rows);

  it('agrees on the type breakdown', () => {
    expect(server.byType).toEqual(local.byType);
  });

  it('agrees on every configuration breakdown', () => {
    expect(server.byConfig.color).toEqual(local.byConfig.color);
    expect(server.byConfig.size).toEqual(local.byConfig.size);
    expect(server.byConfig.grosor).toEqual(local.byConfig.grosor);
    expect(server.byConfig.acabado).toEqual(local.byConfig.acabado);
    expect(server.byConfig.dobleCara).toEqual(local.byConfig.dobleCara);
  });

  it('agrees on the paper combinations and the copy ranges', () => {
    expect(server.byCombo).toEqual(local.byCombo);
    expect(server.byCopies).toEqual(local.byCopies);
  });
});
