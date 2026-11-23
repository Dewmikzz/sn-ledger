/** Financial amounts are integer Sri Lankan cents. No floating-point ledger arithmetic. */
export type OperatorId = 'me' | 'brother';
export type ChequeStatus = 'received' | 'deposited' | 'cleared' | 'returned';
export interface Shop {
  id: string; name: string; contact?: string; phone?: string; village?: string; route?: string;
  latitude?: number; longitude?: number; photoIds?: string[]; notes?: string; createdAt?: string;
}
export interface ChequeInput { id: string; bank: string; number: string; amount: number; date: string; photoIds: string[] }
export interface EventBase {
  id: string; date: string; createdAt: string; operatorId: OperatorId; deviceId: string; shopId: string;
  disposition?: 'applied' | 'conflict'; conflictReason?: string; serverSequence?: number;
}
export interface InvoiceEvent extends EventBase {
  kind: 'invoice'; reference: string; total: number; cash: number; cheques: ChequeInput[]; dueDate?: string; photoIds: string[];
}
export interface Allocation { invoiceId: string; cash: number; chequeAmounts: { chequeId: string; amount: number }[] }
export interface CollectionEvent extends EventBase { kind: 'collection'; cash: number; cheques: ChequeInput[]; allocations: Allocation[]; photoIds: string[] }
export interface ChequeStatusEvent extends EventBase { kind: 'cheque-status'; chequeId: string; status: Exclude<ChequeStatus, 'received'> }
/** Revisions retain the original invoice and every later correction. Cheques are changed through their lifecycle. */
export interface CorrectionEvent extends EventBase { kind: 'correction'; targetId: string; reason: string; total: number; cash: number }
export type LedgerEvent = InvoiceEvent | CollectionEvent | ChequeStatusEvent | CorrectionEvent;
export interface ReportFigures {
  invoiceValue: number; newCredit: number; cashFromInvoices: number; cashFromCollections: number; expectedCash: number;
  chequesReceived: number; chequesDeposited: number; chequesCleared: number; chequesReturned: number;
}
export interface DayClose {
  id: string; date: string; createdAt: string; operatorId: OperatorId; deviceId: string; countedCash: number;
  route?: string; filterOperatorId?: OperatorId; snapshot: ReportFigures; note?: string;
}
export interface LedgerData { shops: Shop[]; events: LedgerEvent[]; closes: DayClose[] }
export interface InvoiceView {
  id: string; shopId: string; reference: string; date: string; dueDate?: string; operatorId: OperatorId;
  total: number; cash: number; chequeTotal: number; initialCredit: number; credit: number; pendingCheques: number;
  collectedCash: number; photoIds: string[]; event: InvoiceEvent; corrections: CorrectionEvent[];
}
export interface ChequeView extends ChequeInput {
  shopId: string; receivedDate: string; operatorId: OperatorId; sourceEventId: string; status: ChequeStatus;
  allocations: { invoiceId: string; amount: number }[];
  history: { eventId: string; status: ChequeStatus; date: string; createdAt: string; operatorId: OperatorId }[];
}
export interface EventDisposition { status: 'applied' | 'conflict'; reason?: string }
export interface DerivedLedger {
  invoices: InvoiceView[]; cheques: ChequeView[]; statuses: Record<string, EventDisposition>; events: LedgerEvent[];
  creditOutstanding: number; pendingCheques: number; totalCash: number;
}
export interface ReportFilters { route?: string; operatorId?: OperatorId }
export interface DailyReport extends ReportFigures {
  date: string; invoiceCount: number; collectionCount: number; physicalCash: number | null; difference: number | null;
  entries: LedgerEvent[]; overdueInvoices: InvoiceView[]; missingPhotos: InvoiceView[]; conflicts: LedgerEvent[];
  corrections: CorrectionEvent[]; originalClose?: DayClose; revised: boolean;
}
export const EMPTY_DATA: LedgerData = { shops: [], events: [], closes: [] };
export const MAX_MONEY = 99_999_999_999;
export function businessDate(value: Date | string | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)!.value).join('-');
}
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function money(amount: number): string { return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', currencyDisplay: 'code', minimumFractionDigits: 2 }).format(amount / 100).replace('LKR', 'Rs.'); }
export function toMinor(value: string | number): number {
  const raw = String(value).trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Enter an amount with up to two decimal places.');
  const [whole, fraction = ''] = raw.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assertMoney(result); return result;
}
export function newId(): string { return crypto.randomUUID(); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function assertMoney(value: number, positive = false): void { assert(Number.isSafeInteger(value) && value >= (positive ? 1 : 0) && value <= MAX_MONEY, 'Amounts must be non-negative integer cents within the supported limit.'); }
function isDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value; }
function sum(values: number[]): number { const result = values.reduce((a, b) => a + b, 0); assertMoney(result); return result; }
function text(value: unknown, name: string, max = 300): void { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${name} is required and must be ${max} characters or fewer.`); }
function validateBase(event: LedgerEvent, data: LedgerData): void {
  text(event.id, 'Entry ID', 128); text(event.deviceId, 'Device ID', 128); text(event.shopId, 'Shop ID', 128);
  assert(event.operatorId === 'me' || event.operatorId === 'brother', 'Choose an authorised operator.');
  assert(isDate(event.date), 'Choose a valid business date.');
  assert(!Number.isNaN(Date.parse(event.createdAt)), 'Entry timestamp is invalid.');
  assert(data.shops.some(s => s.id === event.shopId), 'Select an existing shop.');
}
function validatePhotos(ids: string[]): void { assert(Array.isArray(ids) && ids.length <= 5 && new Set(ids).size === ids.length, 'Use up to five distinct photos.'); ids.forEach(id => text(id, 'Photo ID', 128)); }
function validateCheques(cheques: ChequeInput[], existing: Map<string, ChequeView>): void {
  assert(Array.isArray(cheques) && cheques.length <= 5, 'Too many cheques in one entry.');
  const ids = new Set<string>();
  for (const cheque of cheques) {
    text(cheque.id, 'Cheque ID', 128); text(cheque.bank, 'Bank'); text(cheque.number, 'Cheque number', 100); assertMoney(cheque.amount, true);
    assert(isDate(cheque.date), 'Choose a valid cheque date.');
    validatePhotos(cheque.photoIds);
    assert(!ids.has(cheque.id) && !existing.has(cheque.id), 'This cheque has already been recorded.'); ids.add(cheque.id);
    assert(![...existing.values()].some(c => c.bank.trim().toLowerCase() === cheque.bank.trim().toLowerCase() && c.number.trim().toLowerCase() === cheque.number.trim().toLowerCase()), 'This bank and cheque number have already been recorded.');
    assert(!cheques.some(c => c !== cheque && c.bank.trim().toLowerCase() === cheque.bank.trim().toLowerCase() && c.number.trim().toLowerCase() === cheque.number.trim().toLowerCase()), 'Duplicate cheque number in this entry.');
  }
}
function orderedEvents(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => {
    if (a.serverSequence !== undefined || b.serverSequence !== undefined) {
      const d = (a.serverSequence ?? Number.MAX_SAFE_INTEGER) - (b.serverSequence ?? Number.MAX_SAFE_INTEGER); if (d) return d;
    }
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}
function addCheque(cheques: Map<string, ChequeView>, cheque: ChequeInput, event: InvoiceEvent | CollectionEvent, allocations: { invoiceId: string; amount: number }[]): void {
  cheques.set(cheque.id, { ...cheque, shopId: event.shopId, receivedDate: event.date, operatorId: event.operatorId, sourceEventId: event.id, status: 'received', allocations,
    history: [{ eventId: event.id, status: 'received', date: event.date, createdAt: event.createdAt, operatorId: event.operatorId }] });
}
/** Replays immutable events. Invalid/concurrent submissions remain visible and never partially alter balances. */
export function deriveLedger(data: LedgerData): DerivedLedger {
  const invoices = new Map<string, InvoiceView>(); const cheques = new Map<string, ChequeView>();
  const statuses: Record<string, EventDisposition> = Object.create(null); let totalCash = 0;
  const events = orderedEvents(data.events).filter((event, index, all) => all.findIndex(e => e.id === event.id) === index);
  for (const event of events) {
    if (statuses[event.id]) continue; // Stable IDs make replay/retries idempotent.
    if (event.disposition === 'conflict') { statuses[event.id] = { status: 'conflict', reason: event.conflictReason || 'Review this entry before applying it.' }; continue; }
    try {
      validateBase(event, data);
      if (event.kind === 'invoice') {
        text(event.reference, 'Invoice reference', 100); assertMoney(event.total, true); assertMoney(event.cash); validateCheques(event.cheques, cheques);
        validatePhotos(event.photoIds);
        assert(![...invoices.values()].some(i => i.reference.trim().toLowerCase() === event.reference.trim().toLowerCase()), 'This invoice reference has already been recorded.');
        const chequeTotal = sum(event.cheques.map(c => c.amount)); const paid = sum([event.cash, chequeTotal]);
        assert(paid <= event.total, 'Cash and cheques exceed the invoice total.'); const credit = event.total - paid;
        assert(!credit || (!!event.dueDate && isDate(event.dueDate)), 'Choose a due date for the remaining credit.');
        if (event.dueDate) assert(isDate(event.dueDate), 'Choose a valid due date.');
        const nextCash = sum([totalCash, event.cash]);
        invoices.set(event.id, { id: event.id, shopId: event.shopId, reference: event.reference, date: event.date, dueDate: event.dueDate, operatorId: event.operatorId, total: event.total, cash: event.cash, chequeTotal, initialCredit: credit, credit, pendingCheques: chequeTotal, collectedCash: 0, photoIds: [...event.photoIds], event, corrections: [] });
        event.cheques.forEach(c => addCheque(cheques, c, event, [{ invoiceId: event.id, amount: c.amount }])); totalCash = nextCash;
      } else if (event.kind === 'collection') {
        assertMoney(event.cash); validateCheques(event.cheques, cheques); validatePhotos(event.photoIds); assert(Array.isArray(event.allocations) && event.allocations.length > 0 && event.allocations.length <= 10, 'Allocate the collection to at least one invoice.');
        assert(sum([event.cash, ...event.cheques.map(c => c.amount)]) > 0, 'Enter cash or a cheque to collect.');
        assert(sum(event.allocations.map(a => { assertMoney(a.cash); return a.cash; })) === event.cash, 'Cash allocations must equal cash received.');
        const ids = new Set<string>(); const knownCheques = new Map(event.cheques.map(c => [c.id, c]));
        for (const allocation of event.allocations) {
          assert(!ids.has(allocation.invoiceId), 'Combine allocations for the same invoice.'); ids.add(allocation.invoiceId);
          const invoice = invoices.get(allocation.invoiceId); assert(invoice && invoice.shopId === event.shopId, 'The allocated invoice does not belong to this shop.');
          assert(Array.isArray(allocation.chequeAmounts) && allocation.chequeAmounts.length <= 5, 'Use up to five cheque allocations per invoice.'); const seen = new Set<string>();
          for (const a of allocation.chequeAmounts) { assertMoney(a.amount, true); assert(knownCheques.has(a.chequeId) && !seen.has(a.chequeId), 'Invalid or duplicate cheque allocation.'); seen.add(a.chequeId); }
          const amount = sum([allocation.cash, ...allocation.chequeAmounts.map(a => a.amount)]);
          assert(amount > 0, 'Each selected invoice needs a payment allocation.');
          assert(amount <= invoice.credit, `Collection exceeds the remaining credit on ${invoice.reference}. Both submissions are retained; review this conflict.`);
        }
        for (const cheque of event.cheques) assert(sum(event.allocations.flatMap(a => a.chequeAmounts.filter(c => c.chequeId === cheque.id).map(c => c.amount))) === cheque.amount, 'Cheque allocations must equal the cheque amount.');
        const nextCash = sum([totalCash, event.cash]);
        for (const a of event.allocations) { const invoice = invoices.get(a.invoiceId)!; const pending = sum(a.chequeAmounts.map(c => c.amount)); invoice.credit -= a.cash + pending; invoice.collectedCash += a.cash; invoice.pendingCheques += pending; }
        event.cheques.forEach(c => addCheque(cheques, c, event, event.allocations.flatMap(a => a.chequeAmounts.filter(x => x.chequeId === c.id).map(x => ({ invoiceId: a.invoiceId, amount: x.amount }))))); totalCash = nextCash;
      } else if (event.kind === 'cheque-status') {
        const cheque = cheques.get(event.chequeId); assert(cheque && cheque.shopId === event.shopId, 'Select a cheque belonging to this shop.');
        const allowed = cheque.status === 'received' ? ['deposited', 'returned'] : cheque.status === 'deposited' ? ['cleared', 'returned'] : [];
        assert(allowed.includes(event.status), `A ${cheque.status} cheque cannot be marked ${event.status}.`);
        assert(event.date >= cheque.history.at(-1)!.date, 'A cheque status cannot be dated before its preceding status.');
        if (event.status === 'cleared' || event.status === 'returned') {
          for (const a of cheque.allocations) { const invoice = invoices.get(a.invoiceId)!; invoice.pendingCheques -= a.amount; if (event.status === 'returned') invoice.credit += a.amount; }
        }
        cheque.status = event.status; cheque.history.push({ eventId: event.id, status: event.status, date: event.date, createdAt: event.createdAt, operatorId: event.operatorId });
      } else if (event.kind === 'correction') {
        const invoice = invoices.get(event.targetId); assert(invoice && invoice.shopId === event.shopId, 'Only an invoice belonging to this shop can be corrected.');
        text(event.reason, 'Correction reason', 1000); assertMoney(event.total, true); assertMoney(event.cash);
        const revisedCredit = event.total - event.cash - invoice.chequeTotal;
        assert(revisedCredit >= 0, 'Corrected cash and original cheques exceed the invoice total.');
        const deltaCredit = revisedCredit - invoice.initialCredit; const deltaCash = event.cash - invoice.cash;
        assert(invoice.credit + deltaCredit >= 0, 'This correction would overpay the invoice. Review its later collections first.');
        assert(revisedCredit === 0 || !!invoice.dueDate, 'An invoice without a credit due date cannot be corrected to add credit.');
        assertMoney(totalCash + deltaCash);
        invoice.credit += deltaCredit; invoice.total = event.total; invoice.cash = event.cash; invoice.initialCredit = revisedCredit; invoice.corrections.push(event); totalCash += deltaCash;
      } else { throw new Error('Unknown ledger event type.'); }
      statuses[event.id] = { status: 'applied' };
    } catch (error) { statuses[event.id] = { status: 'conflict', reason: error instanceof Error ? error.message : 'Entry needs attention.' }; }
  }
  return { invoices: [...invoices.values()], cheques: [...cheques.values()], statuses, events, creditOutstanding: sum([...invoices.values()].map(i => i.credit)), pendingCheques: sum([...invoices.values()].map(i => i.pendingCheques)), totalCash };
}
/** Strict local submission; imported concurrent events should be merged and replayed with deriveLedger. */
export function validateAndAppend(data: LedgerData, event: LedgerEvent): LedgerData {
  const existing = data.events.find(e => e.id === event.id);
  if (existing) { assert(JSON.stringify(existing) === JSON.stringify(event), 'An entry with this ID already exists.'); return data; }
  const next = { ...data, events: [...data.events, event] }; const result = deriveLedger(next).statuses[event.id];
  assert(result?.status === 'applied', result?.reason || 'Entry could not be applied.'); return next;
}
export function shopSummary(data: LedgerData, shopId: string, derived = deriveLedger(data)) {
  const invoices = derived.invoices.filter(i => i.shopId === shopId); const cheques = derived.cheques.filter(c => c.shopId === shopId);
  return { credit: sum(invoices.map(i => i.credit)), pendingCheques: sum(invoices.map(i => i.pendingCheques)), nextDueDate: invoices.filter(i => i.credit > 0 && i.dueDate).map(i => i.dueDate!).sort()[0], invoices, cheques };
}
export function reportFigures(report: ReportFigures): ReportFigures {
  const { invoiceValue, newCredit, cashFromInvoices, cashFromCollections, expectedCash, chequesReceived, chequesDeposited, chequesCleared, chequesReturned } = report;
  return { invoiceValue, newCredit, cashFromInvoices, cashFromCollections, expectedCash, chequesReceived, chequesDeposited, chequesCleared, chequesReturned };
}
export function buildReport(data: LedgerData, date: string, filters: ReportFilters = {}): DailyReport {
  const ledger = deriveLedger(data); const shops = new Map(data.shops.map(s => [s.id, s]));
  const match = (e: { shopId: string; operatorId: OperatorId }) => (!filters.route || shops.get(e.shopId)?.route === filters.route) && (!filters.operatorId || e.operatorId === filters.operatorId);
  const entries = ledger.events.filter(e => e.date === date && match(e) && ledger.statuses[e.id]?.status === 'applied');
  const invoices = ledger.invoices.filter(i => i.date === date && match(i));
  const collections = entries.filter((e): e is CollectionEvent => e.kind === 'collection');
  const cashFromInvoices = sum(invoices.map(i => i.cash)); const cashFromCollections = sum(collections.map(e => e.cash));
  const transitions = (status: ChequeStatus) => sum(ledger.cheques.flatMap(c => c.history.filter(h => h.status === status && h.date === date && match({ shopId: c.shopId, operatorId: h.operatorId })).map(() => c.amount)));
  const figures: ReportFigures = { invoiceValue: sum(invoices.map(i => i.total)), newCredit: sum(invoices.map(i => i.initialCredit)), cashFromInvoices, cashFromCollections, expectedCash: sum([cashFromInvoices, cashFromCollections]), chequesReceived: transitions('received'), chequesDeposited: transitions('deposited'), chequesCleared: transitions('cleared'), chequesReturned: transitions('returned') };
  const originalClose = data.closes.filter(c => c.date === date && (c.route || '') === (filters.route || '') && (c.filterOperatorId || '') === (filters.operatorId || '')).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const corrections = ledger.events.filter((e): e is CorrectionEvent => e.kind === 'correction' && ledger.statuses[e.id]?.status === 'applied' && match(e) && (e.date === date || ledger.invoices.find(i => i.id === e.targetId)?.date === date));
  // Current open balances are intentionally shown alongside a selected historical day's figures.
  return { date, ...figures, invoiceCount: invoices.length, collectionCount: collections.length, physicalCash: originalClose?.countedCash ?? null, difference: originalClose ? originalClose.countedCash - figures.expectedCash : null,
    entries, overdueInvoices: ledger.invoices.filter(i => i.credit > 0 && i.dueDate && i.dueDate < date && match(i)), missingPhotos: invoices.filter(i => !i.photoIds.length),
    conflicts: ledger.events.filter(e => e.date === date && match(e) && ledger.statuses[e.id]?.status === 'conflict'), corrections, originalClose,
    revised: !!originalClose && (Object.keys(figures) as (keyof ReportFigures)[]).some(key => originalClose.snapshot[key] !== figures[key]) };
}
export const report = buildReport;
export function createDayClose(data: LedgerData, input: Omit<DayClose, 'snapshot'>): DayClose {
  assertMoney(input.countedCash); assert(isDate(input.date), 'Choose a valid close date.');
  assert(!data.closes.some(c => c.date === input.date && (c.route || '') === (input.route || '') && (c.filterOperatorId || '') === (input.filterOperatorId || '')), 'This report already has an original close. It is retained permanently.');
  return { ...input, snapshot: reportFigures(buildReport(data, input.date, { route: input.route, operatorId: input.filterOperatorId })) };
}
/** Explicitly demo-only seed; never use it to initialise an enrolled live agency. */
export function createDemoData(today = businessDate()): LedgerData {
  const yesterday = addDays(today, -1), older = addDays(today, -8);
  const shops: Shop[] = [
    { id: 'demo-shop-1', name: 'Rathna Stores', contact: 'Sunil Rathnayake', phone: '077 234 5678', village: 'Kaduruwela', route: 'Kaduruwela', latitude: 7.9412, longitude: 81.0097, notes: 'Deliveries on Monday and Thursday.' },
    { id: 'demo-shop-2', name: 'New Wijaya Super', contact: 'Kamal', phone: '071 456 7890', village: 'New Town', route: 'Polonnaruwa', notes: 'Call before the afternoon collection.' },
    { id: 'demo-shop-3', name: 'Lanka Grocery', phone: '076 345 6789', village: 'Giritale', route: 'Giritale' },
    { id: 'demo-shop-4', name: 'Nimal Food City', phone: '077 987 6543', village: 'Jayanthipura', route: 'Giritale' },
    { id: 'demo-shop-5', name: 'Sampath Traders', phone: '070 123 4567', village: 'Kaduruwela', route: 'Kaduruwela' },
    { id: 'demo-shop-6', name: 'Araliya Mini Mart', phone: '078 222 3344', village: 'Polonnaruwa', route: 'Polonnaruwa' },
  ];
  const base = (id: string, date: string, shopId: string, hour: string, operatorId: OperatorId = 'me'): EventBase => ({ id, date, shopId, createdAt: `${date}T${hour}:00+05:30`, operatorId, deviceId: 'demo-device' });
  const events: LedgerEvent[] = [
    { ...base('demo-invoice-old-1', older, 'demo-shop-2', '09:00'), kind: 'invoice', reference: 'LKM-24105', total: 4200000, cash: 1200000, cheques: [], dueDate: yesterday, photoIds: [] },
    { ...base('demo-invoice-old-2', older, 'demo-shop-4', '10:00', 'brother'), kind: 'invoice', reference: 'LKM-24112', total: 1850000, cash: 500000, cheques: [], dueDate: addDays(today, -2), photoIds: [] },
    { ...base('demo-invoice-1', today, 'demo-shop-1', '08:35'), kind: 'invoice', reference: 'LKM-24186', total: 2500000, cash: 1000000, cheques: [{ id: 'demo-cheque-1', bank: 'Bank of Ceylon', number: '028491', amount: 500000, date: addDays(today, 2), photoIds: [] }], dueDate: addDays(today, 7), photoIds: [] },
    { ...base('demo-invoice-2', today, 'demo-shop-3', '09:20', 'brother'), kind: 'invoice', reference: 'LKM-24187', total: 1875000, cash: 1875000, cheques: [], photoIds: [] },
    { ...base('demo-collection-1', today, 'demo-shop-2', '10:05'), kind: 'collection', cash: 1250000, cheques: [], allocations: [{ invoiceId: 'demo-invoice-old-1', cash: 1250000, chequeAmounts: [] }], photoIds: [] },
    { ...base('demo-invoice-3', today, 'demo-shop-5', '10:40'), kind: 'invoice', reference: 'LKM-24188', total: 3240000, cash: 1500000, cheques: [{ id: 'demo-cheque-2', bank: 'People’s Bank', number: '392817', amount: 1000000, date: today, photoIds: [] }], dueDate: addDays(today, 5), photoIds: [] },
    { ...base('demo-invoice-4', today, 'demo-shop-6', '11:15', 'brother'), kind: 'invoice', reference: 'LKM-24189', total: 1285000, cash: 0, cheques: [], dueDate: addDays(today, 3), photoIds: [] },
  ];
  return { shops, events, closes: [] };
}
