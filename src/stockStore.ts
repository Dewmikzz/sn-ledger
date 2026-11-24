import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { agencyId, firebaseAuth, firestore } from './firebase';
import { newStockItem, stockMovement, validStockDetails, type StockDetails, type StockItem, type StockMovement, type StockMovementInput } from './inventory';
import type { LedgerMode } from './store';

type StockActivity = StockMovement & { recordedAt: string };
type DemoStock = { items: StockItem[]; history: Record<string, StockActivity[]> };
const demoKey = 'si-ledger:demo-stock:v1';
const demoChange = 'si-ledger-demo-stock-change';
const historyLimit = 30;

function readDemo(): DemoStock {
  const saved = localStorage.getItem(demoKey);
  return saved ? JSON.parse(saved) as DemoStock : { items: [], history: {} };
}

function saveDemo(data: DemoStock): void {
  localStorage.setItem(demoKey, JSON.stringify(data));
  window.dispatchEvent(new Event(demoChange));
}

function watchDemo<T>(select: (data: DemoStock) => T, onData: (data: T) => void, onError: (error: Error) => void) {
  const refresh = () => {
    try { onData(select(readDemo())); }
    catch { onError(new Error('Could not open demo inventory on this device.')); }
  };
  const onStorage = (event: StorageEvent) => { if (event.key === demoKey) refresh(); };
  refresh();
  window.addEventListener(demoChange, refresh);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(demoChange, refresh);
    window.removeEventListener('storage', onStorage);
  };
}

function stockCollection() {
  if (!firestore) throw new Error('Live inventory requires Firebase.');
  return collection(firestore, 'agencies', agencyId, 'stockItems');
}

function requireOnlineStock() {
  const authUid = firebaseAuth?.currentUser?.uid;
  if (!firestore || !authUid) throw new Error('Sign in to the live workspace to change stock.');
  if (!navigator.onLine) throw new Error('Reconnect to update inventory.');
  return { db: firestore, authUid };
}

export function watchStock(mode: LedgerMode, onData: (items: StockItem[]) => void, onError: (error: Error) => void) {
  if (mode === 'demo') return watchDemo(data => data.items, onData, onError);
  return onSnapshot(stockCollection(), { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.metadata.fromCache || !snapshot.empty) onData(snapshot.docs.map(entry => entry.data() as StockItem));
  }, onError);
}

export function watchStockHistory(mode: LedgerMode, itemId: string, onData: (history: StockActivity[]) => void, onError: (error: Error) => void) {
  if (mode === 'demo') return watchDemo(data => (data.history[itemId] ?? []).slice(0, historyLimit), onData, onError);
  const movements = collection(doc(stockCollection(), itemId), 'movements');
  return onSnapshot(query(movements, orderBy('createdAt', 'desc'), limit(historyLimit)), snapshot => onData(snapshot.docs.map(entry => {
    const { createdAt, ...movement } = entry.data() as StockMovement & { createdAt: Timestamp };
    return { ...movement, recordedAt: createdAt?.toDate().toISOString() ?? '' };
  })), onError);
}

function checkItem(current: StockItem | undefined, revision: number): StockItem {
  if (!current) throw new Error('This item is unavailable. Refresh the stock list.');
  if (current.revision !== revision) throw new Error('The item details changed on another device. Reopen the form and try again.');
  return current;
}

export async function saveStockItem(mode: LedgerMode, id: string, details: StockDetails, revision?: number): Promise<void> {
  if (!validStockDetails(details)) throw new Error('Check the item name, prices, and package quantities.');
  if (mode === 'demo') {
    const data = readDemo();
    const current = data.items.find(item => item.id === id);
    const item = revision === undefined
      ? current ?? newStockItem(id, details)
      : { ...checkItem(current, revision), ...details, revision: revision + 1 };
    saveDemo({ ...data, items: [...data.items.filter(entry => entry.id !== id), item] });
    return;
  }
  const { db, authUid } = requireOnlineStock();
  const ref = doc(stockCollection(), id);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const audit = { updatedAt: serverTimestamp(), authUid };
    if (revision === undefined) {
      if (!snapshot.exists()) transaction.set(ref, { ...newStockItem(id, details), ...audit });
      return;
    }
    checkItem(snapshot.data() as StockItem | undefined, revision);
    transaction.update(ref, { ...details, revision: revision + 1, ...audit });
  });
}

function prepareMovement(id: string, current: StockItem | undefined, shown: StockItem, input: StockMovementInput) {
  const item = checkItem(current, shown.revision);
  if (input.kind === 'count' && item.quantity !== shown.quantity) throw new Error('Stock changed on another device. Reopen the stock count and check the quantity.');
  return stockMovement(id, item, input);
}

export async function saveStockMovement(mode: LedgerMode, shown: StockItem, id: string, input: StockMovementInput): Promise<void> {
  if (mode === 'demo') {
    const data = readDemo();
    const history = data.history[shown.id] ?? [];
    if (history.some(movement => movement.id === id)) return;
    const movement = prepareMovement(id, data.items.find(item => item.id === shown.id), shown, input);
    saveDemo({
      items: data.items.map(item => item.id === shown.id ? { ...item, quantity: movement.after, lastMovementId: id } : item),
      history: { ...data.history, [shown.id]: [{ ...movement, recordedAt: new Date().toISOString() }, ...history] },
    });
    return;
  }
  const { db, authUid } = requireOnlineStock();
  const itemRef = doc(stockCollection(), shown.id);
  const moveRef = doc(collection(itemRef, 'movements'), id);
  await runTransaction(db, async transaction => {
    const [item, existing] = await Promise.all([transaction.get(itemRef), transaction.get(moveRef)]);
    if (existing.exists()) return;
    const movement = prepareMovement(id, item.data() as StockItem | undefined, shown, input);
    transaction.set(moveRef, { ...movement, authUid, createdAt: serverTimestamp() });
    transaction.update(itemRef, { quantity: movement.after, lastMovementId: id, updatedAt: serverTimestamp(), authUid });
  });
}
