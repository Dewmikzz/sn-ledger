import { expect, it } from 'vitest';
import { createDemoData, deriveLedger } from '../src/domain';
import { dueAlerts } from '../src/notifications';

const date = '2026-11-24';
const data = createDemoData(date);
const cheques = deriveLedger(data).cheques;
const at = (time: string) => Date.parse(`${date}T${time}:00+05:30`);

it('sends one monthly profit notification per Sri Lanka hour', () => {
  const profit = dueAlerts(at('06:59'), data, cheques, new Set(), false);
  expect(profit).toHaveLength(1);
  expect(profit[0]).toMatchObject({ id: `profit:${date}:6`, title: 'November 2026 estimated profit' });
  expect(profit[0].message).toContain('10,465.00');
  expect(dueAlerts(at('06:59'), data, cheques, new Set([profit[0].id]), false)).toEqual([]);
});

it('reminds at 7, 8, 9 and 10 for undeposited cheques due that day', () => {
  const seen = new Set<string>();
  for (const hour of [7, 8, 9, 10]) {
    const now = at(`0${hour}`.slice(-2)+':00');
    const reminders = dueAlerts(now, data, cheques, seen, false).filter(alert => alert.kind === 'cheque');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].id).toBe(`cheque:${date}:${hour}`);
    seen.add(reminders[0].id);
  }
  expect(dueAlerts(at('11:00'), data, cheques, seen, false).some(alert => alert.kind === 'cheque')).toBe(false);
  const deposited = cheques.map(cheque => ({ ...cheque, status: 'deposited' as const }));
  expect(dueAlerts(at('08:00'), data, deposited, new Set(), false).some(alert => alert.kind === 'cheque')).toBe(false);
});
