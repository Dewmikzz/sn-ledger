import {useMemo,useState} from 'react';
import {BarChart3,Printer} from 'lucide-react';
import {businessDate,deriveLedger,money,addDays,salesFigures} from './domain';
import type {DailyReport,LedgerData,OperatorId} from './domain';

export function estimateGrossProfit(sales: number): number {
  return Number((BigInt(sales)*7n+50n)/100n);
}

export function summarizeSales(data:LedgerData,from:string,to:string,route:string,operator:string){
  const ledger=deriveLedger(data);
  const shops=new Map(data.shops.map(s=>[s.id,s]));
  const matches=(shopId:string,operatorId:OperatorId)=> (!route||shops.get(shopId)?.route===route)&&(!operator||operatorId===operator);
  const totals=new Map<string,{sales:number,saleCash:number,collectionCash:number,newCredit:number,salesCheques:number}>();
  const bucket=(date:string)=>{
    if(!totals.has(date))totals.set(date,{sales:0,saleCash:0,collectionCash:0,newCredit:0,salesCheques:0});
    return totals.get(date)!;
  };
  let count=0;
  for(const invoice of ledger.invoices){
    if(invoice.date<from||invoice.date>to||!matches(invoice.shopId,invoice.operatorId))continue;
    const day=bucket(invoice.date);
    day.sales+=invoice.total;
    day.saleCash+=invoice.cash;
    day.newCredit+=invoice.initialCredit;
    day.salesCheques+=invoice.chequeTotal;
    count++;
  }
  for(const entry of ledger.events){
    if(entry.kind!=='collection'||ledger.statuses[entry.id]?.status!=='applied'||entry.date<from||entry.date>to||!matches(entry.shopId,entry.operatorId))continue;
    bucket(entry.date).collectionCash+=entry.cash;
  }
  if(!route&&!operator)for(const date of ledger.dailySales.keys())if(date>=from&&date<=to)bucket(date);
  let reviewDays=0;
  const days=[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([date,day])=>{
    const figures=salesFigures(day.sales,day.saleCash,route||operator?undefined:ledger.dailySales.get(date));
    if(figures.salesTotalTooLow)reviewDays++;
    return [date,{...day,sales:figures.invoiceValue,saleCash:figures.cashFromInvoices,cash:figures.cashFromInvoices+day.collectionCash}] as const;
  });
  const sales=days.reduce((sum,[,day])=>sum+day.sales,0);
  const cash=days.reduce((sum,[,day])=>sum+day.cash,0);
  const saleCash=days.reduce((sum,[,day])=>sum+day.saleCash,0);
  const salesCheques=days.reduce((sum,[,day])=>sum+day.salesCheques,0);
  const newCredit=days.reduce((sum,[,day])=>sum+day.newCredit,0);
  return {sales,cash,saleCash,salesCheques,newCredit,count,reviewDays,profit:estimateGrossProfit(sales),days};
}

export function Analytics({data,route,warning}:{data:LedgerData;route:string;warning:string}){
  const [from,setFrom]=useState(()=>addDays(businessDate(),-6));
  const [to,setTo]=useState(businessDate);
  const valid=Boolean(from&&to&&from<=to);
  const result=useMemo(()=>summarizeSales(data,from,to,route,''),[data,from,to,route]);
  const max=Math.max(1,...result.days.map(([,d])=>d.sales));
  return <div className="modal-body analytics">
    <div className="field-grid">
      <label className="field">From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="field">Through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>
    <p>{route ? `${route} · Recorded invoices only` : 'All routes'} · Asia/Colombo</p>
    {warning&&<p className="notice amber">{warning}</p>}
    {!valid?<p role="alert">Choose a valid date range.</p>:<>
      {result.reviewDays>0&&<p role="alert" className="notice amber">Review {result.reviewDays} daily sales total(s) below the recorded invoice value. Those days show recorded invoice figures.</p>}
      <div className="analytics-kpis">
        <div><span>Total sales</span><strong>{money(result.sales)}</strong><small>{result.count} itemized invoices</small></div>
        <div><span>Estimated gross profit · 7%</span><strong>{money(result.profit)}</strong><small>Before operating expenses</small></div>
        <div><span>Cash collected</span><strong>{money(result.cash)}</strong><small>Invoices and old balances</small></div>
        <div><span>Cash from sales</span><strong>{money(result.saleCash)}</strong></div>
        <div><span>Cheques from sales</span><strong>{money(result.salesCheques)}</strong></div>
        <div><span>New credit</span><strong>{money(result.newCredit)}</strong></div>
        <div><span>Old balances collected in cash</span><strong>{money(result.cash-result.saleCash)}</strong></div>
      </div>
      <h3><BarChart3 size={17}/> Daily sales</h3>
      {result.days.length?<ul className="sales-bars">{result.days.map(([day,row])=><li key={day}><span>{day}</span><div className="sales-track" aria-hidden="true"><div style={{width:`${row.sales/max*100}%`}}/></div><strong>{money(row.sales)}</strong></li>)}</ul>:<p>No activity in this period.</p>}
    </>}
  </div>;
}

export function ThermalReport({report,agency,route,warning}:{report:DailyReport;agency:string;route:string;warning:string}){
  const [width,setWidth]=useState('80');
  const rows:[string,number|null][]=[
    [report.dailySales&&!report.salesTotalTooLow?'Total sales':'Recorded invoice value',report.invoiceValue],['New credit',report.newCredit],
    ['Cash from sales',report.cashFromInvoices],['Cheques from sales',report.salesCheques],['Old balance cash',report.cashFromCollections],
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
        <header>
          <strong style={{fontSize:'1.05rem',display:'block'}}>HG Saman Indika Wimalaratna</strong>
          <div style={{fontSize:'0.82rem',fontWeight:'bold'}}>Authorized Distributor for Lakmee Export Lanka PVT LTD</div>
          <div style={{fontSize:'0.78rem'}}>No 207/1, Palugasdamana, Polonnaruwa</div>
          <div style={{fontSize:'0.82rem',fontWeight:'bold'}}>Contact : 0765496411</div>
          <div style={{margin:'6px 0 2px',borderTop:'1px dashed #000',paddingTop:'4px'}}><strong>{agency}</strong></div>
          <div style={{fontSize:'0.8rem'}}>Daily collections report · {report.date}</div>
        </header>
        <p>{route ? `${route} · Recorded invoices only` : 'All routes'}</p>
        {report.salesTotalTooLow&&<p>Daily sales total needs review. Figures use recorded invoices.</p>}
        {warning&&<p>{warning}</p>}
        <dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===null?'—':money(value)}</dd></div>)}</dl>
        {report.originalClose&&<p>Original expected cash {money(report.originalClose.snapshot.expectedCash)}{report.revised?' · revised figures above':''}</p>}
        <footer>
          <div style={{marginBottom:'4px'}}>{report.invoiceCount} invoices · {report.collectionCount} collections</div>
          <div style={{borderTop:'1px dashed #000',paddingTop:'4px',fontWeight:'bold'}}>System Develop By : Dewmika Anusara</div>
          <div>www.dew.pshycolab.com | 0765496411</div>
        </footer>
      </article>
    </div>
    <div className="modal-footer"><button className="button primary" onClick={()=>window.print()}><Printer size={17}/>Print thermal report</button></div>
  </>;
}
