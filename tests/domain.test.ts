import { describe, it, expect } from 'vitest';
import { addDays, buildReport, businessDate, createDayClose, createDemoData, deriveLedger, MAX_MONEY, reportFigures, shopSummary, toMinor, validateAndAppend, type LedgerData, type LedgerEvent, type InvoiceEvent, type CollectionEvent, type ChequeStatusEvent, type CorrectionEvent } from '../src/domain';

const day = '2026-11-23';
const base = (id: string, date = day, shopId = 's1', minute = 0) => ({ id, date, shopId, createdAt: `${date}T09:${String(minute).padStart(2, '0')}:00+05:30`, operatorId: 'me' as const, deviceId: 'device-a' });
const empty = (): LedgerData => ({ shops: [{ id: 's1', name: 'Shop 1', route: 'Kaduruwela' }, { id: 's2', name: 'Shop 2', route: 'Giritale' }], events: [], closes: [] });
const invoice = (overrides: Partial<InvoiceEvent> = {}): InvoiceEvent => ({ ...base('i1'), kind: 'invoice', reference: 'LKM-001', total: 2_500_000, cash: 1_000_000, cheques: [{ id: 'ch1', bank: 'BOC', number: '123', amount: 500_000, date: day, photoIds: [] }], dueDate: '2026-11-30', photoIds: [], ...overrides });
const collection = (overrides: Partial<CollectionEvent> = {}): CollectionEvent => ({ ...base('p1', day, 's1', 1), kind: 'collection', cash: 300_000, cheques: [], allocations: [{ invoiceId: 'i1', cash: 300_000, chequeAmounts: [] }], photoIds: [], ...overrides });
const change = (id: string, status: ChequeStatusEvent['status'], minute: number, date = day): ChequeStatusEvent => ({ ...base(id, date, 's1', minute), kind: 'cheque-status', chequeId: 'ch1', status });
const append = (data: LedgerData, ...events: LedgerEvent[]) => events.reduce(validateAndAppend, data);

describe('Acceptance scenario: invoices, allocations, cheque lifecycle and reports agree', () => {
  it('records mixed payment and partial old-balance cash without counting another sale', () => {
    const data = append(empty(), invoice(), collection()); const ledger = deriveLedger(data); const report = buildReport(data, day);
    expect(shopSummary(data, 's1').credit).toBe(700_000); expect(shopSummary(data, 's1').pendingCheques).toBe(500_000);
    expect(ledger.cheques[0].allocations).toEqual([{ invoiceId: 'i1', amount: 500_000 }]);
    expect(ledger.totalCash).toBe(1_300_000); expect(report.invoiceValue).toBe(2_500_000); expect(report.newCredit).toBe(1_000_000);
    expect(report.cashFromInvoices).toBe(1_000_000); expect(report.cashFromCollections).toBe(300_000); expect(report.expectedCash).toBe(1_300_000); expect(report.chequesReceived).toBe(500_000);
  });
  it('returns a cheque to the original invoice exactly once without changing cash', () => {
    const returned = change('return1', 'returned', 3); let data = append(empty(), invoice(), collection(), change('deposit1', 'deposited', 2), returned);
    data = validateAndAppend(data, returned); const ledger = deriveLedger(data); const report = buildReport(data, day);
    expect(ledger.creditOutstanding).toBe(1_200_000); expect(ledger.pendingCheques).toBe(0); expect(ledger.totalCash).toBe(1_300_000);
    expect(report.chequesDeposited).toBe(500_000); expect(report.chequesReturned).toBe(500_000); expect(report.expectedCash).toBe(1_300_000);
    expect(() => validateAndAppend(data, change('return-again', 'returned', 4))).toThrow('cannot be');
  });
  it('clears a deposited cheque without counting a second collection', () => {
    const data = append(empty(), invoice(), collection(), change('d1', 'deposited', 2), change('c1', 'cleared', 3));
    expect(deriveLedger(data).creditOutstanding).toBe(700_000); expect(deriveLedger(data).pendingCheques).toBe(0); expect(deriveLedger(data).totalCash).toBe(1_300_000);
    expect(buildReport(data, day).chequesCleared).toBe(500_000); expect(buildReport(data, day).expectedCash).toBe(1_300_000);
    expect(() => validateAndAppend(data, change('r1', 'returned', 4))).toThrow('cannot be');
  });
  it('separates daily cheque transitions and collections over different business dates', () => {
    const next = addDays(day, 1), later = addDays(day, 2); const data = append(empty(), invoice(), collection({ date: next, createdAt: `${next}T09:00:00+05:30` }), change('d1', 'deposited', 1, next), change('r1', 'returned', 1, later));
    expect(buildReport(data, day).expectedCash).toBe(1_000_000); expect(buildReport(data, next).expectedCash).toBe(300_000); expect(buildReport(data, later).expectedCash).toBe(0);
    expect(buildReport(data, next).invoiceValue).toBe(0); expect(buildReport(data, next).chequesDeposited).toBe(500_000); expect(buildReport(data, later).chequesReturned).toBe(500_000);
  });
});

describe('Validation and conflict preservation', () => {
  it('preserves both concurrent offline collections and excludes excess before applying it', () => {
    const initial = append(empty(), invoice()); const first = collection({ cash: 700_000, allocations: [{ invoiceId: 'i1', cash: 700_000, chequeAmounts: [] }] });
    const second = collection({ ...base('p2', day, 's1', 2), cash: 700_000, allocations: [{ invoiceId: 'i1', cash: 700_000, chequeAmounts: [] }] });
    const merged = { ...initial, events: [...initial.events, first, second] }; const ledger = deriveLedger(merged);
    expect(merged.events).toHaveLength(3); expect(ledger.creditOutstanding).toBe(300_000); expect(ledger.totalCash).toBe(1_700_000); expect(ledger.statuses.p2.status).toBe('conflict');
    expect(buildReport(merged, day).conflicts).toEqual([second]); expect(buildReport(merged, day).expectedCash).toBe(1_700_000);
  });
  it('uses canonical server ordering ahead of local wall clocks', () => {
    const inv = invoice({ serverSequence: 1 }); const p1 = collection({ id: 'later-server', serverSequence: 3, cash: 700_000, allocations: [{ invoiceId: 'i1', cash: 700_000, chequeAmounts: [] }] });
    const p2 = collection({ id: 'earlier-server', serverSequence: 2, createdAt: `${day}T10:00:00+05:30`, cash: 700_000, allocations: [{ invoiceId: 'i1', cash: 700_000, chequeAmounts: [] }] });
    const ledger = deriveLedger({ ...empty(), events: [inv, p1, p2] }); expect(ledger.statuses['earlier-server'].status).toBe('applied'); expect(ledger.statuses['later-server'].status).toBe('conflict');
  });
  it('revalidates an event claiming applied status and never trusts that flag', () => {
    const data = append(empty(), invoice()); const invalid = collection({ disposition: 'applied', cash: 1_100_000, allocations: [{ invoiceId: 'i1', cash: 1_100_000, chequeAmounts: [] }] });
    const ledger = deriveLedger({ ...data, events: [...data.events, invalid] }); expect(ledger.statuses.p1.status).toBe('conflict'); expect(ledger.creditOutstanding).toBe(1_000_000);
  });
  it('honours a server conflict permanently even when a future return increases credit', () => {
    const conflicting = collection({ disposition: 'conflict', conflictReason: 'Collected on another device' });
    const data = { ...empty(), events: [invoice(), conflicting, change('r1', 'returned', 3)] }; expect(deriveLedger(data).totalCash).toBe(1_000_000); expect(buildReport(data, day).conflicts).toEqual([conflicting]);
  });
  it('does not partially apply multi-invoice collections when one allocation exceeds credit', () => {
    const data = append(empty(), invoice(), invoice({ ...base('i2', day, 's1', 1), reference: 'LKM-002', total: 200_000, cash: 0, cheques: [] }));
    const event = collection({ ...base('p2', day, 's1', 2), cash: 600_000, allocations: [{ invoiceId: 'i1', cash: 300_000, chequeAmounts: [] }, { invoiceId: 'i2', cash: 300_000, chequeAmounts: [] }] });
    const ledger = deriveLedger({ ...data, events: [...data.events, event] }); expect(ledger.invoices[0].credit).toBe(1_000_000); expect(ledger.invoices[1].credit).toBe(200_000); expect(ledger.totalCash).toBe(1_000_000);
  });
  it('rejects over-allocation, mismatched cash, duplicate references, and invalid cents', () => {
    expect(() => validateAndAppend(empty(), invoice({ cash: 2_100_000 }))).toThrow('exceed'); expect(() => validateAndAppend(empty(), invoice({ cash: 10.2 }))).toThrow('integer');
    const data = append(empty(), invoice()); expect(() => validateAndAppend(data, collection({ cash: 200_000 }))).toThrow('allocations');
    expect(() => validateAndAppend(data, invoice({ id: 'i2', cheques: [], reference: ' lkm-001 ' }))).toThrow('reference');
  });
  it('rejects cross-shop allocations and skipping deposited before cleared', () => {
    const data = append(empty(), invoice()); expect(() => validateAndAppend(data, collection({ shopId: 's2' }))).toThrow('belong'); expect(() => validateAndAppend(data, change('c1', 'cleared', 3))).toThrow('cannot be');
  });
  it('deduplicates replayed stable IDs in balances and reports', () => {
    const data = append(empty(), invoice(), collection()); data.events.push(data.events[1]); expect(deriveLedger(data).totalCash).toBe(1_300_000); expect(buildReport(data, day).cashFromCollections).toBe(300_000);
  });
  it('requires a valid due date for credit and a cheque number/bank', () => {
    expect(() => validateAndAppend(empty(), invoice({ dueDate: undefined }))).toThrow('due date'); expect(() => validateAndAppend(empty(), invoice({ dueDate: '2026-02-30' }))).toThrow('due date');
    expect(() => validateAndAppend(empty(), invoice({ cheques: [{ id: 'c1', bank: '', number: '1', amount: 100, date: day, photoIds: [] }] }))).toThrow('Bank');
  });
});

describe('Split cheque allocation, close history, and corrections', () => {
  it('returns exact allocations of one old-balance cheque across multiple invoices', () => {
    const data = append(empty(), invoice({ cash: 0, cheques: [] }), invoice({ ...base('i2', day, 's1', 1), reference: 'LKM-002', total: 600_000, cash: 0, cheques: [] }));
    const payment: CollectionEvent = { ...base('p2', day, 's1', 2), kind: 'collection', cash: 100_000, cheques: [{ id: 'ch1', bank: 'BOC', number: '333', date: day, amount: 800_000, photoIds: [] }], allocations: [{ invoiceId: 'i1', cash: 100_000, chequeAmounts: [{ chequeId: 'ch1', amount: 300_000 }] }, { invoiceId: 'i2', cash: 0, chequeAmounts: [{ chequeId: 'ch1', amount: 500_000 }] }], photoIds: [] };
    const paid = append(data, payment); expect(deriveLedger(paid).invoices.map(i => i.credit)).toEqual([2_100_000, 100_000]);
    const returned = append(paid, change('r1', 'returned', 3)); expect(deriveLedger(returned).invoices.map(i => i.credit)).toEqual([2_400_000, 600_000]); expect(deriveLedger(returned).totalCash).toBe(100_000);
  });
  it('retains original close figures while displaying a reasoned revision', () => {
    let data = append(empty(), invoice(), collection()); const close = createDayClose(data, { id: 'close1', date: day, createdAt: `${day}T18:00:00+05:30`, operatorId: 'me', deviceId: 'device-a', countedCash: 1_300_000 }); data = { ...data, closes: [close] };
    const correction: CorrectionEvent = { ...base('fix1', addDays(day, 1)), kind: 'correction', targetId: 'i1', reason: 'Cash counted as 10,000; receipt confirms 9,000.', total: 2_500_000, cash: 900_000 };
    data = append(data, correction); const report = buildReport(data, day); expect(report.expectedCash).toBe(1_200_000); expect(report.originalClose?.snapshot.expectedCash).toBe(1_300_000); expect(report.difference).toBe(100_000); expect(report.revised).toBe(true); expect(report.corrections).toEqual([correction]); expect(deriveLedger(data).creditOutstanding).toBe(800_000);
    expect(() => createDayClose(data, { ...close, id: 'close2' })).toThrow('already');
  });
  it('uses latest correction baseline and rejects corrections overpaying an invoice', () => {
    const initial = append(empty(), invoice(), collection()); const correction: CorrectionEvent = { ...base('fix1', day, 's1', 2), kind: 'correction', targetId: 'i1', reason: 'Corrected receipt total', total: 2_600_000, cash: 900_000 };
    const corrected = append(initial, correction); const twice = append(corrected, { ...correction, id: 'fix2', createdAt: `${day}T09:03:00+05:30`, total: 2_500_000, cash: 1_000_000 }); expect(deriveLedger(twice).creditOutstanding).toBe(700_000); expect(deriveLedger(twice).totalCash).toBe(1_300_000);
    expect(() => validateAndAppend(twice, { ...correction, id: 'bad', createdAt: `${day}T09:04:00+05:30`, total: 1_500_000, cash: 1_000_000 })).toThrow('overpay');
  });
  it('filters invoice/collection operator and each cheque transition operator independently', () => {
    const deposited = { ...change('d1', 'deposited', 2), operatorId: 'brother' as const }; const data = append(empty(), invoice(), collection(), deposited);
    expect(buildReport(data, day, { operatorId: 'brother' }).expectedCash).toBe(0); expect(buildReport(data, day, { operatorId: 'brother' }).chequesDeposited).toBe(500_000); expect(buildReport(data, day, { operatorId: 'me' }).chequesDeposited).toBe(0);
    expect(buildReport(data, day, { route: 'Giritale' }).invoiceValue).toBe(0);
  });
});

describe('Currency, dates and demo', () => {
  it('converts decimal user inputs exactly, without fractional cent rounding', () => {
    expect(toMinor('1,234.56')).toBe(123456); expect(toMinor('0.1')).toBe(10); expect(() => toMinor('1.001')).toThrow(); expect(() => toMinor('-1')).toThrow(); expect(() => toMinor('Infinity')).toThrow(); expect(() => toMinor(String(MAX_MONEY))).toThrow();
  });
  it('uses Colombo midnight independent of host timezone', () => {
    expect(businessDate('2026-11-22T18:29:59Z')).toBe('2026-11-22'); expect(businessDate('2026-11-22T18:30:00Z')).toBe('2026-11-23'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('has a valid explicit demo seed and a stable report snapshot', () => {
    const data = createDemoData(day); expect(Object.values(deriveLedger(data).statuses).every(s => s.status === 'applied')).toBe(true); expect(buildReport(data, day).invoiceCount).toBe(4); expect(reportFigures(buildReport(data, day)).expectedCash).toBe(5_625_000);
  });
});
