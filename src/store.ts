import { useEffect, useRef, useState } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import { collection, doc, getDocsFromServer, getDocFromServer, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';
import { createDemoData, deriveLedger, validateAndAppend, type DayClose, type LedgerData, type LedgerEvent, type Shop } from './domain';
import { agencyId, configured, firebaseAuth, firebaseProjectId, firestore, getDeviceIdentity, watchDeviceIdentity, type DeviceIdentity } from './firebase';

export type LedgerMode = 'demo' | 'live';
export type SyncStatus = 'local' | 'syncing' | 'synced' | 'attention' | 'offline';
type QueueValue = { kind: 'event'; value: LedgerEvent } | { kind: 'shop'; value: Shop } | { kind: 'close'; value: DayClose };
export type PendingOperation = QueueValue & { id: string; state: 'pending' | 'syncing' | 'attention' | 'conflict'; error?: string; attempts: number; createdAt: string };
interface StoredLedger { key: string; server: LedgerData; queue: PendingOperation[]; lastServerSync?: string }
export interface LedgerState {
  data: LedgerData; ready: boolean; error: string | null; syncStatus: SyncStatus; pendingCount: number; attentionCount: number;
  queue: PendingOperation[]; lastServerSync: string | null; online: boolean;
}
const emptyData = (): LedgerData => ({ shops: [], events: [], closes: [] });
const initialState = (): LedgerState => ({ data: emptyData(), ready: false, error: null, syncStatus: 'local', pendingCount: 0, attentionCount: 0, queue: [], lastServerSync: null, online: navigator.onLine });
let databasePromise: Promise<IDBPDatabase> | undefined;
const database = () => databasePromise ||= openDB('si-ledger-ledger-v1', 1, { upgrade(db) { db.createObjectStore('ledgers', { keyPath: 'key' }); } });
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const isPermanent = (error: unknown) => /permission-denied|unauthenticated|invalid-argument|failed-precondition/.test((error as { code?: string })?.code || '');

/** Exposed for tests: server data wins by stable ID; local pending work stays visible. */
export function mergePending(server: LedgerData, queue: PendingOperation[]): LedgerData {
  const shops = new Map(server.shops.map(s => [s.id, s]));
  const events = new Map(server.events.map(e => [e.id, e]));
  const closes = new Map(server.closes.map(c => [c.id, c]));
  for (const operation of queue) {
    if (operation.kind === 'shop') shops.set(operation.value.id, operation.value);
    if (operation.kind === 'event' && !events.has(operation.value.id)) events.set(operation.value.id, operation.state === 'conflict' ? { ...operation.value, disposition: 'conflict', conflictReason: operation.error } : operation.value);
    if (operation.kind === 'close' && !closes.has(operation.value.id)) closes.set(operation.value.id, operation.value);
  }
  return { shops: [...shops.values()], events: [...events.values()], closes: [...closes.values()] };
}

/** A full contiguous canonical snapshot is required before accepting a new money event. */
export function hasCompleteSequence(events: LedgerEvent[], sequence: number): boolean {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || events.length !== sequence) return false;
  const ordered = events.map(e => e.serverSequence).sort((a, b) => (a ?? 0) - (b ?? 0));
  return ordered.every((value, index) => value === index + 1);
}
class RefreshSnapshot extends Error {}

class LedgerController {
  readonly key: string;
  private row: StoredLedger;
  private state: LedgerState = initialState();
  private listeners = new Set<(state: LedgerState) => void>();
  private stopListeners: Unsubscribe[] = [];
  private channel?: BroadcastChannel;
  private flushing = false;
  private disposed = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private mutationChain: Promise<unknown> = Promise.resolve();
  constructor(readonly mode: LedgerMode, readonly identity: DeviceIdentity | null) {
    this.key = mode === 'demo' ? 'demo:v1' : `live:${firebaseProjectId}:${agencyId}:${identity!.uid}`;
    this.row = { key: this.key, server: emptyData(), queue: [] };
  }
  async initialise() {
    const db = await database();
    const existing = await db.get('ledgers', this.key) as StoredLedger | undefined;
    if (existing) this.row = existing;
    else {
      this.row.server = this.mode === 'demo' ? createDemoData() : emptyData();
      await db.put('ledgers', this.row);
    }
    this.row.queue.forEach(op => { if (op.state === 'syncing') op.state = 'pending'; });
    this.state.ready = true;
    this.publish();
    if ('BroadcastChannel' in globalThis) {
      this.channel = new BroadcastChannel('si-ledger-changes');
      this.channel.onmessage = event => { if (event.data === this.key) void this.reload(); };
    }
    window.addEventListener('online', this.connectionChanged);
    window.addEventListener('offline', this.connectionChanged);
    if (this.mode === 'live') this.startListeners();
    void this.flush();
    return this;
  }
  private connectionChanged = () => { this.publish(); if (navigator.onLine) void this.flush(); };
  private publish(error: string | null = this.state.error) {
    const data = mergePending(this.row.server, this.row.queue);
    const conflicts = Object.values(deriveLedger(data).statuses).filter(s => s.status === 'conflict').length;
    const attentionCount = conflicts + this.row.queue.filter(op => op.state === 'attention').length;
    const pendingCount = this.row.queue.filter(op => op.state !== 'conflict').length;
    const online = navigator.onLine;
    const syncStatus: SyncStatus = !online ? 'offline' : this.flushing ? 'syncing' : attentionCount ? 'attention' : pendingCount || this.mode === 'demo' ? 'local' : 'synced';
    this.state = { data, ready: this.state.ready, error, syncStatus, pendingCount, attentionCount, queue: this.row.queue, lastServerSync: this.row.lastServerSync || null, online };
    this.listeners.forEach(listener => listener(this.state));
  }
  subscribe(listener: (state: LedgerState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private async reload() {
    const row = await (await database()).get('ledgers', this.key) as StoredLedger | undefined;
    if (row && !this.disposed) { this.row = row; this.publish(); }
  }
  private mutate(change: (row: StoredLedger) => void): Promise<void> {
    const operation = this.mutationChain.catch(() => {}).then(async () => {
      const db = await database();
      const transaction = db.transaction('ledgers', 'readwrite');
      const row = (await transaction.store.get(this.key) as StoredLedger | undefined) || this.row;
      change(row);
      await transaction.store.put(clean(row));
      await transaction.done;
      this.row = row; this.publish(); this.channel?.postMessage(this.key);
    });
    this.mutationChain = operation;
    return operation;
  }
  private assertWritable() {
    if (!this.state.ready) throw new Error('The ledger is still opening. Try again in a moment.');
    if (this.mode === 'live' && (!this.identity || firebaseAuth?.currentUser?.uid !== this.identity.uid)) throw new Error('This device is not enrolled. Ask the owner to authorise it.');
  }
  async submitEvent(event: LedgerEvent) {
    this.assertWritable();
    const stable = clean(event);
    // Authoritative sequence and disposition are assigned only during sync.
    delete stable.serverSequence; delete stable.disposition; delete stable.conflictReason;
    await this.mutate(row => {
      const data = mergePending(row.server, row.queue);
      if (data.events.some(existing => existing.id === stable.id)) return;
      validateAndAppend(data, stable);
      if (this.mode === 'demo') row.server.events.push(stable);
      else row.queue.push({ id: stable.id, kind: 'event', value: stable, state: 'pending', attempts: 0, createdAt: new Date().toISOString() });
    });
    void this.flush();
  }
  async saveShop(shop: Shop) {
    this.assertWritable();
    if (!shop.id || !shop.name.trim()) throw new Error('Give the shop a name.');
    const stable = clean(shop);
    await this.mutate(row => {
      if (this.mode === 'demo') row.server.shops = [...row.server.shops.filter(s => s.id !== stable.id), stable];
      else row.queue.push({ id: crypto.randomUUID(), kind: 'shop', value: stable, state: 'pending', attempts: 0, createdAt: new Date().toISOString() });
    });
    void this.flush();
  }
  async closeDay(close: DayClose) {
    this.assertWritable();
    if (!Number.isSafeInteger(close.countedCash) || close.countedCash < 0) throw new Error('Enter a valid cash count.');
    await this.mutate(row => {
      const data = mergePending(row.server, row.queue);
      if (data.closes.some(c => c.id === close.id)) return;
      if (data.closes.some(c => c.date === close.date && (c.route || '') === (close.route || '') && (c.filterOperatorId || '') === (close.filterOperatorId || ''))) throw new Error('This report already has an original close.');
      if (this.mode === 'demo') row.server.closes.push(clean(close));
      else row.queue.push({ id: close.id, kind: 'close', value: clean(close), state: 'pending', attempts: 0, createdAt: new Date().toISOString() });
    });
    void this.flush();
  }
  async retrySync() {
    await this.mutate(row => row.queue.forEach(operation => { if (operation.state === 'attention') { operation.state = 'pending'; delete operation.error; } }));
    this.publish(null); await this.flush();
  }
  async resetDemo() {
    if (this.mode !== 'demo') throw new Error('Live data cannot be reset from the app.');
    await this.mutate(row => { row.server = createDemoData(); row.queue = []; });
  }
  private startListeners() {
    if (!firestore || !this.identity) return;
    for (const name of ['shops', 'events', 'closes'] as const) {
      const stop = onSnapshot(collection(firestore, 'agencies', agencyId, name), { includeMetadataChanges: true }, snapshot => {
        if (this.disposed || snapshot.metadata.fromCache) return;
        const values = snapshot.docs.map(document => document.data());
        void this.mutate(row => {
          if (name === 'shops') row.server.shops = values as Shop[];
          if (name === 'events') row.server.events = values as LedgerEvent[];
          if (name === 'closes') row.server.closes = values as DayClose[];
          row.lastServerSync = new Date().toISOString();
        }).then(() => { this.publish(null); void this.flush(); }).catch(error => this.publish(errorText(error)));
      }, error => this.publish(error.code === 'permission-denied' ? 'Cloud access is denied. Ask the owner to check this device’s enrolment.' : error.message));
      this.stopListeners.push(stop);
    }
  }
  private async refreshCanonical(): Promise<void> {
    if (!firestore) return;
    const [events, shops, closes] = await Promise.all(['events', 'shops', 'closes'].map(name => getDocsFromServer(collection(firestore!, 'agencies', agencyId, name))));
    await this.mutate(row => {
      row.server = { events: events.docs.map(d => d.data() as LedgerEvent), shops: shops.docs.map(d => d.data() as Shop), closes: closes.docs.map(d => d.data() as DayClose) };
      row.lastServerSync = new Date().toISOString();
    });
  }
  private async sendEvent(event: LedgerEvent): Promise<LedgerEvent> {
    if (!firestore || !this.identity) throw new Error('Firebase is not configured.');
    for (let attempt = 0; attempt < 6; attempt++) {
      const canonical = clean(this.row.server);
      try {
        return await runTransaction(firestore, async transaction => {
          const eventRef = doc(firestore!, 'agencies', agencyId, 'events', event.id);
          const headRef = doc(firestore!, 'agencies', agencyId, 'sync', 'head');
          const [existing, head] = await Promise.all([transaction.get(eventRef), transaction.get(headRef)]);
          if (existing.exists()) return existing.data() as LedgerEvent;
          const sequence = head.exists() ? head.data().sequence as number : 0;
          if (!hasCompleteSequence(canonical.events, sequence)) throw new RefreshSnapshot();
          const outgoing: LedgerEvent & { authUid: string } = { ...event, serverSequence: sequence + 1, disposition: 'applied', authUid: this.identity!.uid };
          try { validateAndAppend(canonical, outgoing); }
          catch (error) { outgoing.disposition = 'conflict'; outgoing.conflictReason = errorText(error).slice(0, 1000); }
          transaction.set(eventRef, clean(outgoing));
          transaction.set(headRef, { sequence: sequence + 1, lastEventId: event.id });
          return outgoing;
        });
      } catch (error) {
        if (!(error instanceof RefreshSnapshot)) {
          if ((error as { code?: string }).code !== 'permission-denied') throw error;
          const head = await getDocFromServer(doc(firestore, 'agencies', agencyId, 'sync', 'head'));
          if (hasCompleteSequence(canonical.events, head.data()?.sequence ?? 0)) throw error;
        }
        await this.refreshCanonical();
      }
    }
    throw new Error('Other devices are syncing. Your entry is safely queued; retry shortly.');
  }
  private async sendOperation(operation: PendingOperation) {
    if (!firestore || !this.identity) throw new Error('Firebase is not configured.');
    if (operation.kind === 'event') {
      const event = await this.sendEvent(operation.value);
      await this.mutate(row => {
        row.server.events = [...row.server.events.filter(e => e.id !== event.id), event];
        if (event.disposition === 'conflict') {
          const queued = row.queue.find(o => o.id === operation.id);
          if (queued) { queued.state = 'conflict'; queued.error = event.conflictReason; }
        } else row.queue = row.queue.filter(o => o.id !== operation.id);
      });
      return;
    }
    const name = operation.kind === 'shop' ? 'shops' : 'closes';
    const documentRef = doc(firestore, 'agencies', agencyId, name, operation.value.id);
    const value = { ...operation.value, authUid: this.identity.uid };
    await runTransaction(firestore, async transaction => {
      const existing = await transaction.get(documentRef);
      if (operation.kind === 'close' && existing.exists()) return;
      transaction.set(documentRef, clean(value));
    });
    await this.mutate(row => {
      if (operation.kind === 'shop') row.server.shops = [...row.server.shops.filter(s => s.id !== value.id), value as Shop];
      else row.server.closes = [...row.server.closes.filter(c => c.id !== value.id), value as DayClose];
      row.queue = row.queue.filter(o => o.id !== operation.id);
    });
  }
  async flush(): Promise<void> {
    if (this.flushing || this.mode === 'demo' || !navigator.onLine || !this.state.ready || this.disposed || firebaseAuth?.currentUser?.uid !== this.identity?.uid) return;
    this.flushing = true; this.publish();
    let shouldRetry = false;
    try {
      for (;;) {
        const operation = this.row.queue.find(o => o.state === 'pending' || o.state === 'syncing');
        if (!operation || !navigator.onLine || this.disposed) break;
        await this.mutate(row => { const item = row.queue.find(o => o.id === operation.id); if (item) { item.state = 'syncing'; item.attempts++; delete item.error; } });
        try { await this.sendOperation(operation); this.publish(null); }
        catch (error) {
          await this.mutate(row => { const item = row.queue.find(o => o.id === operation.id); if (item) { item.state = isPermanent(error) ? 'attention' : 'pending'; item.error = errorText(error); } });
          this.publish(isPermanent(error) ? 'An entry needs attention before it can sync. Open Settings to review.' : 'Saved on this phone. Sync will retry when the connection is available.');
          shouldRetry = !isPermanent(error); break;
        }
      }
    } finally {
      this.flushing = false; this.publish();
      if (shouldRetry && !this.disposed) { clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => void this.flush(), 15000); }
    }
  }
  entryStatus(id: string): SyncStatus {
    const event = this.state.data.events.find(e => e.id === id);
    if (event && deriveLedger(this.state.data).statuses[id]?.status === 'conflict') return 'attention';
    const operation = this.row.queue.find(o => o.kind === 'event' && o.value.id === id);
    if (operation?.state === 'attention' || operation?.state === 'conflict') return 'attention';
    if (operation?.state === 'syncing') return 'syncing';
    if (operation || this.mode === 'demo') return 'local';
    return 'synced';
  }
  dispose() {
    this.disposed = true; this.stopListeners.forEach(stop => stop()); this.channel?.close(); clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.connectionChanged); window.removeEventListener('offline', this.connectionChanged);
  }
}

/** Mounted once by the app. A successful save resolves only AFTER IndexedDB commits. */
export function useLedger(mode: LedgerMode) {
  const [state, setState] = useState<LedgerState>(initialState);
  const controller = useRef<LedgerController | null>(null);
  useEffect(() => {
    let stopped = false;
    let stopState: (() => void) | undefined;
    let selectedUid: string | null | undefined;
    let generation = 0;
    const attach = async (identity: DeviceIdentity | null, error?: string) => {
      const uid = mode === 'demo' ? 'demo' : identity?.uid || null;
      if (uid === selectedUid) { if (error) setState(s => ({ ...s, error })); return; }
      selectedUid = uid; const currentGeneration = ++generation;
      stopState?.(); controller.current?.dispose(); controller.current = null;
      if (mode === 'live' && !identity) {
        setState({ ...initialState(), ready: true, error: error || (configured ? 'Enrol this device to open your agency ledger.' : 'Firebase is not configured. Demo data is separate from your live ledger.') });
        return;
      }
      const next = new LedgerController(mode, identity);
      try {
        await next.initialise();
        if (stopped || currentGeneration !== generation) { next.dispose(); return; }
        controller.current = next; stopState = next.subscribe(setState);
      } catch (error) { next.dispose(); if (!stopped) setState({ ...initialState(), ready: true, error: `Could not open local storage: ${errorText(error)}. Your entry has not been saved.` }); }
    };
    setState(initialState());
    let stopIdentity: (() => void) | undefined;
    if (mode === 'demo') void attach(null);
    else {
      void getDeviceIdentity().then(identity => attach(identity)).catch(error => attach(null, errorText(error)));
      stopIdentity = watchDeviceIdentity((identity, error) => void attach(identity, error));
    }
    return () => { stopped = true; generation++; stopIdentity?.(); stopState?.(); controller.current?.dispose(); controller.current = null; };
  }, [mode]);
  const current = () => { if (!controller.current) throw new Error('Open the demo or enrol this device before saving.'); return controller.current; };
  return {
    ...state,
    submitEvent: (event: LedgerEvent) => current().submitEvent(event),
    saveShop: (shop: Shop) => current().saveShop(shop),
    closeDay: (close: DayClose) => current().closeDay(close),
    retrySync: () => current().retrySync(),
    resetDemo: () => current().resetDemo(),
    entryStatus: (id: string) => controller.current?.entryStatus(id) || 'local' as SyncStatus,
  };
}
