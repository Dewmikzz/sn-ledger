import {useMemo,useState} from 'react';
import {BarChart3,Printer} from 'lucide-react';
import {businessDate,deriveLedger,money,addDays} from './domain';
import type {DailyReport,LedgerData,OperatorId} from './domain';

export function estimateGrossProfit(sales: number): number {
  return Number((BigInt(sales)*7n+50n)/100n);
}

export function summarizeSales(data:LedgerData,from:string,to:string,route:string,operator:string){
  const ledger=deriveLedger(data);
  const shops=new Map(data.shops.map(s=>[s.id,s]));
  const matches=(shopId:string,operatorId:OperatorId)=> (!route||shops.get(shopId)?.route===route)&&(!operator||operatorId===operator);
  const totals=new Map<string,{sales:number,cash:number}>();
  const bucket=(date:string)=>{
    if(!totals.has(date))totals.set(date,{sales:0,cash:0});
    return totals.get(date)!;
  };
  let count=0;
  for(const invoice of ledger.invoices){
    if(invoice.date<from||invoice.date>to||!matches(invoice.shopId,invoice.operatorId))continue;
    const day=bucket(invoice.date);day.sales+=invoice.total;day.cash+=invoice.cash;count++;
  }
  for(const entry of ledger.events){
    if(entry.kind!=='collection'||ledger.statuses[entry.id]?.status!=='applied'||entry.date<from||entry.date>to||!matches(entry.shopId,entry.operatorId))continue;
    bucket(entry.date).cash+=entry.cash;
  }
  const days=[...totals].sort(([a],[b])=>a.localeCompare(b));
  const sales=days.reduce((sum,[,day])=>sum+day.sales,0);
  const cash=days.reduce((sum,[,day])=>sum+day.cash,0);
  return {sales,cash,count,profit:estimateGrossProfit(sales),days};
}

export function Analytics({data,route,operator,warning}:{data:LedgerData;route:string;operator:string;warning:string}){
  const [from,setFrom]=useState(()=>addDays(businessDate(),-6));
  const [to,setTo]=useState(businessDate);
  const valid=Boolean(from&&to&&from<=to);
  const result=useMemo(()=>summarizeSales(data,from,to,route,operator),[data,from,to,route,operator]);
  const max=Math.max(1,...result.days.map(([,d])=>d.sales));
  return <div className="modal-body analytics">
    <div className="field-grid">
      <label className="field">From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="field">Through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>
    <p>{route||'All routes'} · {operator==='me'?'Me':operator==='brother'?'Brother':'Both operators'} · Asia/Colombo</p>
    {warning&&<p className="notice amber">{warning}</p>}
    {!valid?<p role="alert">Choose a valid date range.</p>:<>
      <div className="analytics-kpis">
        <div><span>Recorded invoice sales</span><strong>{money(result.sales)}</strong><small>{result.count} invoices</small></div>
        <div><span>Estimated gross profit · 7%</span><strong>{money(result.profit)}</strong><small>Before operating expenses</small></div>
        <div><span>Cash collected</span><strong>{money(result.cash)}</strong><small>Invoices and old balances</small></div>
      </div>
      <h3><BarChart3 size={17}/> Daily sales</h3>
      {result.days.length?<ul className="sales-bars">{result.days.map(([day,row])=><li key={day}><span>{day}</span><div className="sales-track" aria-hidden="true"><div style={{width:`${row.sales/max*100}%`}}/></div><strong>{money(row.sales)}</strong></li>)}</ul>:<p>No activity in this period.</p>}
    </>}
  </div>;
}

export function ThermalReport({report,agency,route,operator,warning}:{report:DailyReport;agency:string;route:string;operator:string;warning:string}){
  const [width,setWidth]=useState('80');
  const rows:[string,number|null][]=[
    ['Invoice sales',report.invoiceValue],['New credit',report.newCredit],
    ['Invoice cash',report.cashFromInvoices],['Old balance cash',report.cashFromCollections],
    ['Expected cash',report.expectedCash],['Counted cash',report.physicalCash],['Cash difference',report.difference],
    ['Cheques received',report.chequesReceived],['Cheques deposited',report.chequesDeposited],
    ['Cheques cleared',report.chequesCleared],['Cheques returned',report.chequesReturned],
    ['Est. gross profit (7%)',estimateGrossProfit(report.invoiceValue)]
  ];
  return <>
    <div className="modal-body thermal-body">
      <div className="thermal-options">
        <label className="field">Paper roll<select value={width} onChange={e=>setWidth(e.target.value)}><option value="80">80 mm</option><option value="58">58 mm</option></select></label>
        <p>Pair the printer and enable its print service or driver. In the print dialog, select the printer and matching roll size. Turn off headers and footers if shown.</p>
      </div>
      <style media="print">{`@page{margin:0} .thermal-slip{width:${width==='80'?72:48}mm}`}</style>
      <article className={`thermal-slip thermal-${width}`}>
        <header><strong>Saman Indika Ledger</strong>{agency!=='Saman Indika Ledger'&&<div>{agency}</div>}<div>Daily collections report</div><div>{report.date} · Asia/Colombo</div></header>
        <p>{route||'All routes'} · {operator||'Both operators'}</p>
        {warning&&<p>{warning}</p>}
        <dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===null?'—':money(value)}</dd></div>)}</dl>
        {report.originalClose&&<p>Original expected cash {money(report.originalClose.snapshot.expectedCash)}{report.revised?' · revised figures above':''}</p>}
        <footer>{report.invoiceCount} invoices · {report.collectionCount} collections<br/>Polonnaruwa, Sri Lanka</footer>
      </article>
    </div>
    <div className="modal-footer"><button className="button primary" onClick={()=>window.print()}><Printer size={17}/>Print thermal report</button></div>
  </>;
}
