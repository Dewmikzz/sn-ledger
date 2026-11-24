import { useEffect, useState } from 'react';
import { ArrowUpRight, Bell, CreditCard, TrendingUp, X } from 'lucide-react';
import { businessDate, money, type ChequeView, type LedgerData } from './domain';
import { calendarMonth, summarizeSales } from './Insights';

type AlertKind = 'profit' | 'cheque';
export interface LedgerAlert { id: string; kind: AlertKind; title: string; message: string; at: number; read: boolean }
const retention = 48;
const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', hourCycle: 'h23' });
const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const blank: LedgerAlert[] = [];
const storageKey = (scope: string) => `si-ledger:alerts:v1:${scope}`;

function readAlerts(scope: string): LedgerAlert[] {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey(scope)) ?? '[]');
    return Array.isArray(list) ? list.slice(0, retention) : [];
  } catch { return []; }
}

function writeAlerts(scope: string, list: LedgerAlert[]) {
  try { localStorage.setItem(storageKey(scope), JSON.stringify(list)); } catch { /* Alerts remain available in the current window. */ }
}

export function dueAlerts(now: number, data: LedgerData, cheques: ChequeView[], seen: Set<string>, incomplete: boolean): LedgerAlert[] {
  const date = businessDate(now);
  const hour = Number(hourFormatter.format(now));
  const profitId = `profit:${date}:${hour}`;
  const chequeId = `cheque:${date}:${Math.min(hour, 10)}`;
  const alerts: LedgerAlert[] = [];
  if (!seen.has(profitId)) {
    const month = calendarMonth(date);
    const { profit } = summarizeSales(data, month.from, month.to, '', '');
    alerts.push({ id: profitId, kind: 'profit', at: now, read: false, title: `${month.label} estimated profit`, message: `${money(profit)} gross profit at 7% of sales.${incomplete ? ' Includes the records available on this device.' : ''}` });
  }
  if (hour >= 7 && !seen.has(chequeId)) {
    const due = cheques.filter(cheque => cheque.date === date && cheque.status === 'received');
    if (due.length) alerts.push({ id: chequeId, kind: 'cheque', at: now, read: false, title: `Deposit ${due.length === 1 ? '1 cheque' : `${due.length} cheques`} due today`, message: `${money(due.reduce((sum, cheque) => sum + cheque.amount, 0))} still to deposit. Open the cheque register to review.` });
  }
  return alerts;
}

export function useLedgerAlerts(scope: string | null, data: LedgerData, cheques: ChequeView[], ready: boolean, incomplete: boolean) {
  const [state, setState] = useState<{ scope: string; alerts: LedgerAlert[]; latest?: LedgerAlert }>();
  useEffect(() => {
    if (!scope || !ready) return;
    let local = readAlerts(scope);
    setState(previous => previous?.scope === scope ? previous : { scope, alerts: local });
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      const saved = readAlerts(scope);
      const known = saved.length ? saved : local;
      const fresh = dueAlerts(Date.now(), data, cheques, new Set(known.map(alert => alert.id)), incomplete);
      local = [...fresh].reverse().concat(known).slice(0, retention);
      if (fresh.length) writeAlerts(scope, local);
      setState(previous => ({
        scope,
        alerts: local,
        latest: fresh.at(-1) ?? (previous?.scope === scope ? previous.latest : undefined),
      }));
    };
    check();
    const timer = setInterval(check, 10_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [scope, ready, data, cheques, incomplete]);
  const current = state?.scope === scope ? state : undefined;
  const markRead = () => {
    if (!scope || !current) return;
    const alerts = current.alerts.map(alert => ({ ...alert, read: true }));
    writeAlerts(scope, alerts);
    setState({ scope, alerts });
  };
  const closeLatest = () => setState(previous => previous && { ...previous, latest: undefined });
  return { alerts: current?.alerts ?? blank, latest: current?.latest, markRead, closeLatest };
}

export function NotificationTray({ alerts, latest, onClear, onDismiss, onCheques, onHome }: {
  alerts: LedgerAlert[]; latest?: LedgerAlert; onClear: () => void; onDismiss: () => void; onCheques: () => void; onHome: () => void;
}) {
  const [open, setOpen] = useState(false);
  const unread = alerts.filter(alert => !alert.read).length;
  useEffect(() => {
    if (!latest) return;
    const timer = setTimeout(onDismiss, 8500);
    return () => clearTimeout(timer);
  }, [latest?.id]);
  function visit(kind: AlertKind) {
    setOpen(false);
    onDismiss();
    if (kind === 'cheque') onCheques();
    else onHome();
  }
  return <div className="notification-center">
    <button type="button" className="icon-button notification-button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => {setOpen(!open);onDismiss();}}>
      <Bell size={20}/>{unread>0&&<span className="notification-count" aria-hidden="true">{Math.min(unread,99)}</span>}
    </button>
    {open&&<section className="notification-tray" aria-label="Notifications">
      <header><div><h2>Notifications</h2><small>Sri Lanka time</small></div><button className="icon-button" aria-label="Close notifications" onClick={()=>setOpen(false)}><X size={18}/></button></header>
      {alerts.length?<><button type="button" className="text-button notification-read" onClick={onClear}>Mark all as read</button><ul>{alerts.map(alert=><li key={alert.id} className={alert.read?'':'unread'}>
        <button type="button" onClick={()=>visit(alert.kind)}><span className={`notification-symbol ${alert.kind}`}>{alert.kind==='cheque'?<CreditCard size={17}/>:<TrendingUp size={17}/>}</span><span><strong>{alert.title}</strong><span>{alert.message}</span><small>{timeFormatter.format(alert.at)}</small></span><ArrowUpRight size={14}/></button>
      </li>)}</ul></>:<p className="notification-empty">No notifications yet.</p>}
    </section>}
    {latest&&!open&&<div className={`notification-popup ${latest.kind}`} role="status">
      <span className={`notification-symbol ${latest.kind}`}>{latest.kind==='cheque'?<CreditCard size={19}/>:<TrendingUp size={19}/>}</span>
      <button type="button" className="notification-popup-content" onClick={()=>visit(latest.kind)}><strong>{latest.title}</strong><span>{latest.message}</span></button>
      <button type="button" className="icon-button" aria-label="Dismiss notification" onClick={onDismiss}><X size={17}/></button>
    </div>}
  </div>;
}
