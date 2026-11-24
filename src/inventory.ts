import { MAX_MONEY, toMinor } from './domain';

export const MAX_STOCK = 99_999_999;
export const MAX_PACKAGE_SIZE = 10_000;

export interface StockDetails {
  name: string;
  sku: string;
  unitsPerPack: number;
  unitsPerBox: number;
  costPrice: number;
  sellingPrice: number;
}

export interface StockItem extends StockDetails {
  id: string;
  quantity: number;
  revision: number;
  lastMovementId: string;
}

export type StockMovementKind = 'in' | 'out' | 'count';
export const stockMovementLabels = { in: 'Stock in', out: 'Stock out', count: 'Stock count' } as const;

export interface StockMovementInput {
  kind: StockMovementKind;
  loose: number;
  packs: number;
  boxes: number;
  note: string;
}

export interface StockMovement extends StockMovementInput {
  id: string;
  unitsPerPack: number;
  unitsPerBox: number;
  units: number;
  before: number;
  after: number;
}

function wholeNumber(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}

export function stockNumber(input: FormDataEntryValue | null, label: string, max = MAX_STOCK): number {
  const value = String(input ?? '').trim();
  if (!value) return 0;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !wholeNumber(number, max)) throw new Error(`Enter a whole number up to ${max.toLocaleString()} for ${label}.`);
  return number;
}

export function stockDetails(form: FormData): StockDetails {
  const details = {
    name: String(form.get('name') ?? '').trim(),
    sku: String(form.get('sku') ?? '').trim(),
    unitsPerPack: stockNumber(form.get('unitsPerPack'), 'units per pack', MAX_PACKAGE_SIZE),
    unitsPerBox: stockNumber(form.get('unitsPerBox'), 'units per box', MAX_PACKAGE_SIZE),
    costPrice: toMinor(String(form.get('costPrice') ?? '')),
    sellingPrice: toMinor(String(form.get('sellingPrice') ?? '')),
  };
  if (!details.name || details.name.length > 120 || details.sku.length > 60) throw new Error('Enter an item name and use up to 60 characters for the SKU.');
  return details;
}

export function newStockItem(id: string, details: StockDetails): StockItem {
  return { id, ...details, quantity: 0, revision: 0, lastMovementId: '' };
}

export function stockUnits(item: Pick<StockItem, 'unitsPerPack' | 'unitsPerBox'>, input: Pick<StockMovementInput, 'loose' | 'packs' | 'boxes'>): number {
  if (![input.loose, input.packs, input.boxes].every(value => wholeNumber(value, MAX_STOCK))) throw new Error('Enter whole quantities.');
  if ((input.packs && !item.unitsPerPack) || (input.boxes && !item.unitsPerBox)) throw new Error('Set the units per pack or box for this item first.');
  const units = input.loose + input.packs * item.unitsPerPack + input.boxes * item.unitsPerBox;
  if (!wholeNumber(units, MAX_STOCK)) throw new Error('The total number of units is too large.');
  return units;
}

export function stockMovement(id: string, item: StockItem, input: StockMovementInput): StockMovement {
  const units = stockUnits(item, input);
  if (input.kind !== 'count' && units === 0) throw new Error('Enter a stock quantity greater than zero.');
  const after = input.kind === 'count' ? units : item.quantity + (input.kind === 'in' ? units : -units);
  if (after < 0) throw new Error(`Only ${item.quantity.toLocaleString()} units are available.`);
  if (!wholeNumber(after, MAX_STOCK)) throw new Error('The stock balance would exceed the supported limit.');
  if (input.note.length > 300) throw new Error('Use up to 300 characters for the note.');
  return { id, ...input, unitsPerPack: item.unitsPerPack, unitsPerBox: item.unitsPerBox, units, before: item.quantity, after };
}

export function stockValue(items: StockItem[]): string {
  const cents = items.reduce((sum, item) => sum + BigInt(item.quantity) * BigInt(item.costPrice), 0n);
  return `Rs. ${(cents / 100n).toLocaleString('en-LK')}.${String(cents % 100n).padStart(2, '0')}`;
}

export function validStockDetails(details: StockDetails): boolean {
  return details.name.trim().length > 0 && details.name.length <= 120 && details.sku.length <= 60
    && [details.unitsPerPack, details.unitsPerBox].every(value => wholeNumber(value, MAX_PACKAGE_SIZE))
    && [details.costPrice, details.sellingPrice].every(value => wholeNumber(value, MAX_MONEY));
}
