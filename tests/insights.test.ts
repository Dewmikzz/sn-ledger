import {expect,it} from 'vitest';
import {estimateGrossProfit,summarizeSales} from '../src/Insights';
import {createDemoData,buildReport,validateAndAppend,type LedgerData,type InvoiceEvent,type CollectionEvent,type CorrectionEvent} from '../src/domain';

it('estimates 7% of sales in integer cents, rounding once',()=>{
  expect(estimateGrossProfit(2_500_000)).toBe(175_000);
  expect(estimateGrossProfit(7)).toBe(0);
  expect(estimateGrossProfit(8)).toBe(1);
});
it('reconciles a date range with daily reports and keeps old collections out of sales',()=>{
  const date='2026-11-23';
  const data=createDemoData(date);
  for(const [route,operator] of [['',''],['Giritale','brother']] as const){
    const summary=summarizeSales(data,date,date,route,operator);
    const daily=buildReport(data,date,{route:route||undefined,operatorId:operator||undefined});
    expect(summary.sales).toBe(daily.invoiceValue);
    expect(summary.cash).toBe(daily.expectedCash);
    expect(summary.count).toBe(daily.invoiceCount);
  }
  expect(summarizeSales(data,'2026-11-22',date,'','').sales).toBe(
    buildReport(data,'2026-11-22').invoiceValue+buildReport(data,date).invoiceValue
  );
  expect(buildReport(data,date).cashFromCollections).toBeGreaterThan(0);
});

it('verifies Rs. 25,000 invoice sales yields Rs. 1,750 profit, old collections only change cash, and corrections revise totals', () => {
  const date = '2026-11-23';
  const initialData: LedgerData = {
    shops: [{ id: 's1', name: 'Rathna Stores', route: 'Kaduruwela' }],
    events: [],
    closes: []
  };
  // 1. Rs. 25,000 invoice with 10,000 cash, 5,000 cheque, 10,000 credit
  const invoiceEvent: InvoiceEvent = {
    id: 'inv-1', kind: 'invoice', date, createdAt: `${date}T08:00:00+05:30`,
    operatorId: 'me', deviceId: 'dev-1', shopId: 's1', reference: 'LKM-25000',
    total: 2_500_000, cash: 1_000_000, cheques: [{ id: 'ch-1', bank: 'BOC', number: '1001', amount: 500_000, date, photoIds: [] }],
    dueDate: '2026-11-30', photoIds: []
  };
  const step1 = validateAndAppend(initialData, invoiceEvent);
  const summary1 = summarizeSales(step1, date, date, '', '');
  expect(summary1.sales).toBe(2_500_000); // Rs. 25,000
  expect(summary1.profit).toBe(175_000);  // Rs. 1,750 estimated gross profit
  expect(summary1.cash).toBe(1_000_000);  // Rs. 10,000 cash
  expect(summary1.count).toBe(1);

  // 2. Collect Rs. 3,000 old balance
  const collectionEvent: CollectionEvent = {
    id: 'col-1', kind: 'collection', date, createdAt: `${date}T10:00:00+05:30`,
    operatorId: 'me', deviceId: 'dev-1', shopId: 's1',
    cash: 300_000, cheques: [], photoIds: [],
    allocations: [{ invoiceId: 'inv-1', cash: 300_000, chequeAmounts: [] }]
  };
  const step2 = validateAndAppend(step1, collectionEvent);
  const summary2 = summarizeSales(step2, date, date, '', '');
  // Old balance collection changes ONLY collected cash; sales and profit remain identical!
  expect(summary2.sales).toBe(2_500_000);
  expect(summary2.profit).toBe(175_000);
  expect(summary2.cash).toBe(1_300_000); // 10,000 + 3,000
  expect(summary2.count).toBe(1);

  // 3. Confirm filters (route and operator)
  const routeMatch = summarizeSales(step2, date, date, 'Kaduruwela', '');
  expect(routeMatch.sales).toBe(2_500_000);
  expect(routeMatch.cash).toBe(1_300_000);

  const routeMismatch = summarizeSales(step2, date, date, 'NonExistentRoute', '');
  expect(routeMismatch.sales).toBe(0);
  expect(routeMismatch.cash).toBe(0);

  const operatorMatch = summarizeSales(step2, date, date, '', 'me');
  expect(operatorMatch.sales).toBe(2_500_000);
  expect(operatorMatch.cash).toBe(1_300_000);

  const operatorMismatch = summarizeSales(step2, date, date, '', 'brother');
  expect(operatorMismatch.sales).toBe(0);
  expect(operatorMismatch.cash).toBe(0);

  // 4. Confirm correction updates revised totals
  const correctionEvent: CorrectionEvent = {
    id: 'cor-1', kind: 'correction', date, createdAt: `${date}T11:00:00+05:30`,
    operatorId: 'me', deviceId: 'dev-1', shopId: 's1', targetId: 'inv-1',
    reason: 'Receipt revision: total is Rs. 26,000 with 9,000 cash',
    total: 2_600_000, cash: 900_000
  };
  const step3 = validateAndAppend(step2, correctionEvent);
  const summary3 = summarizeSales(step3, date, date, '', '');
  expect(summary3.sales).toBe(2_600_000); // Revised to Rs. 26,000
  expect(summary3.profit).toBe(182_000);  // 7% of 26,000 = Rs. 1,820
  expect(summary3.cash).toBe(1_200_000);  // Revised invoice cash (9,000) + collection cash (3,000) = 12,000
});
