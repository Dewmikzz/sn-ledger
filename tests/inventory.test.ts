import { expect, it } from 'vitest';
import { newStockItem, stockMovement, stockValue } from '../src/inventory';

const item = newStockItem('item', { name: 'Sample', sku: '', unitsPerPack: 6, unitsPerBox: 24, costPrice: 100_50, sellingPrice: 125_00 });
const input = { loose: 5, packs: 3, boxes: 2, note: '' };

it('adds mixed boxes, packs, and loose units and values the received stock at cost', () => {
  const receipt = stockMovement('in', item, { ...input, kind: 'in' });
  expect(receipt).toMatchObject({ units: 71, before: 0, after: 71, unitsPerPack: 6, unitsPerBox: 24 });
  expect(stockValue([{ ...item, quantity: receipt.after }])).toBe('Rs. 7,135.50');
});

it('rejects negative stock, fractional quantities and unconfigured packaging', () => {
  expect(() => stockMovement('out', item, { ...input, kind: 'out' })).toThrow('Only 0 units are available on the lorry');
  expect(() => stockMovement('in', item, { ...input, loose: 1.5, kind: 'in' })).toThrow('whole quantities');
  expect(() => stockMovement('in', { ...item, unitsPerBox: 0 }, { ...input, kind: 'in' })).toThrow('units per pack or box');
});

it('transfers warehouse stock to the lorry, returns unsold stock and delivers from the lorry', () => {
  const load = stockMovement('load', { ...item, quantity: 100 }, { ...input, kind: 'load' });
  expect(load).toMatchObject({ before: 100, after: 29, lorryBefore: 0, lorryAfter: 71, boxes: 2, packs: 3, loose: 5 });
  const returned = stockMovement('return', { ...item, quantity: 29, lorryQuantity: 71 }, { loose: 2, boxes: 0, packs: 1, note: '', kind: 'return' });
  expect(returned).toMatchObject({ after: 37, lorryAfter: 63 });
  expect(stockMovement('delivery', { ...item, quantity: 37, lorryQuantity: 63 }, { loose: 3, boxes: 1, packs: 0, note: '', kind: 'out' })).toMatchObject({ after: 37, lorryAfter: 36 });
  expect(() => stockMovement('load', item, { ...input, kind: 'load' })).toThrow('warehouse');
});

it('records a count as the actual quantity on hand, including zero', () => {
  const counted = stockMovement('count', { ...item, quantity: 80 }, { ...input, loose: 0, boxes: 0, kind: 'count' });
  expect(counted).toMatchObject({ before: 80, after: 18 });
  expect(stockMovement('empty', item, { loose: 0, packs: 0, boxes: 0, kind: 'count', note: '' }).after).toBe(0);
});
