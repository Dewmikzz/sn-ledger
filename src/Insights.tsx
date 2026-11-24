import {useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Banknote,BarChart3,CalendarDays,ChartPie,Printer,TrendingUp,Wallet} from 'lucide-react';
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

const periods = [{value:'month',label:'Month'},{value:1,label:'Day'},{value:7,label:'7 days'},{value:30,label:'30 days'},{value:'custom',label:'Custom'}] as const;
type Period = (typeof periods)[number]['value'];

export function calendarMonth(date: string) {
  const from = date.slice(0,7)+'-01';
  const end = new Date(from+'T12:00:00Z');
  const label = new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(end);
  end.setUTCMonth(end.getUTCMonth()+1,0);
  return {from,to:end.toISOString().slice(0,10),label};
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'Asia/Colombo'}).format(new Date(date+'T12:00:00Z'));
}

export function SalesDashboard({data,date,route,warning}:{data:LedgerData;date:string;route:string;warning:string}){
  const [period,setPeriod]=useState<Period>('month');
  const month=calendarMonth(date);
  const [customFrom,setCustomFrom]=useState(month.from);
  const [customTo,setCustomTo]=useState(date);
  const from=period==='month'?month.from:period==='custom'?customFrom:addDays(date,1-period);
  const to=period==='month'?month.to:period==='custom'?customTo:date;
  const valid=Boolean(from&&to&&from<=to);
  const result=useMemo(()=>summarizeSales(data,from,to,route,''),[data,from,to,route]);
  const dayCount=valid?Math.round((Date.parse(to)-Date.parse(from))/86400000)+1:0;
  const groupSize=Math.max(1,Math.ceil(dayCount/31));
  const amounts=Array.from({length:Math.ceil(dayCount/groupSize)},()=>0);
  for(const [day,figures] of result.days){
    const index=Math.floor((Date.parse(day)-Date.parse(from))/86400000/groupSize);
    if(index>=0&&index<amounts.length)amounts[index]+=figures.sales;
  }
  const chartPoints=amounts.map((sales,index)=>{
    const start=addDays(from,index*groupSize);
    const end=addDays(from,Math.min((index+1)*groupSize,dayCount)-1);
    return {date:start,label:start===end?shortDate(start):shortDate(start)+' – '+shortDate(end),sales};
  });
  const highest=chartPoints.reduce((max,point)=>Math.max(max,point.sales),1);
  const axisLabels=valid?[from,...(dayCount>7?[addDays(from,Math.floor((dayCount-1)/2))]:[]),...(from===to?[]:[to])]:[];
  const mix=[
    {label:'Cash from sales',value:result.saleCash,color:'var(--dashboard-mint)'},
    {label:'Cheques from sales',value:result.salesCheques,color:'var(--dashboard-orange)'},
    {label:'New credit',value:result.newCredit,color:'var(--dashboard-slate)'},
  ];
  const cashAngle=result.sales?result.saleCash/result.sales*100:0;
  const chequeAngle=result.sales?(result.saleCash+result.salesCheques)/result.sales*100:0;
  const split=result.sales?`conic-gradient(var(--dashboard-mint) 0 ${cashAngle}%, var(--dashboard-orange) ${cashAngle}% ${chequeAngle}%, var(--dashboard-slate) ${chequeAngle}% 100%)`:undefined;

  return <section className="sales-dashboard" aria-label="Sales dashboard">
    <div className="dashboard-heading">
      <div className="dashboard-periods" role="group" aria-label="Dashboard period">
        {periods.map(option=><button key={option.value} type="button" aria-pressed={period===option.value} onClick={()=>setPeriod(option.value)}>{option.label}</button>)}
      </div>
    </div>
    {period==='custom'&&<div className="dashboard-dates">
      <label className="field">From<input type="date" value={customFrom} onChange={event=>setCustomFrom(event.target.value)}/></label>
      <label className="field">Through<input type="date" value={customTo} onChange={event=>setCustomTo(event.target.value)}/></label>
    </div>}
    {!valid?<p role="alert">Choose a valid date range.</p>:<>
      {warning&&<p className="dashboard-status"><span/>{warning}</p>}
      {result.reviewDays>0&&<p role="alert" className="notice amber">{result.reviewDays} daily sales {result.reviewDays===1?'total needs':'totals need'} review. Those days show recorded invoice figures.</p>}
      <div className="sales-summary">
        <div className="sales-summary-header">
          <div><h2>Sales overview</h2><p>{period==='month'?month.label:from===to?shortDate(to):`${shortDate(from)} – ${shortDate(to)}`} · {route?`${route}, itemized sales`:'All routes'}</p></div>
          <TrendingUp size={23} aria-hidden="true"/>
        </div>
        <div className="sales-total"><span>Total sales</span><strong>{money(result.sales)}</strong><small>{result.count} itemized {result.count===1?'invoice':'invoices'}</small></div>
        <div className="sales-metrics">
          <div><span><ChartPie size={16}/>Est. gross profit</span><strong>{money(result.profit)}</strong><small>7% of sales</small></div>
          <div><span><Wallet size={16}/>Cash collected</span><strong>{money(result.cash)}</strong><small>{money(result.cash-result.saleCash)} from old balances</small></div>
          <div><span><Banknote size={16}/>New credit</span><strong>{money(result.newCredit)}</strong></div>
        </div>
      </div>
      <div className="dashboard-charts">
        <section className="dashboard-panel">
          <div className="dashboard-panel-heading"><div><h3>Sales trend</h3><p>{groupSize>1?'Grouped sales totals in LKR':'Daily totals in LKR'}</p></div><span className="dashboard-icon"><BarChart3 size={18}/></span></div>
          {result.sales>0?<div className="dashboard-trend" role="group" aria-label="Sales chart">
            <div className="dashboard-scale" aria-hidden="true"><span>{money(highest)}</span><span>0</span></div>
            <div className="dashboard-plot">
              <div className="dashboard-columns" style={{gridTemplateColumns:`repeat(${chartPoints.length}, minmax(0, 1fr))`}}>
                {chartPoints.map(point=><div className="dashboard-bar-slot" key={point.date} title={`${point.label} · ${money(point.sales)}`} aria-label={`${point.label}: ${money(point.sales)}`} role="img"><span className="dashboard-bar" style={{height:`${point.sales/highest*100}%`}}/></div>)}
              </div>
              <div className="dashboard-axis" aria-hidden="true">{axisLabels.map(day=><span key={day}>{shortDate(day)}</span>)}</div>
            </div>
          </div>:<p className="dashboard-empty"><CalendarDays size={21}/>No sales recorded for these dates.</p>}
        </section>
        <section className="dashboard-panel">
          <div className="dashboard-panel-heading"><div><h3>Sales breakdown</h3><p>Cash, cheques, and credit</p></div><span className="dashboard-icon"><ChartPie size={18}/></span></div>
          <div className="dashboard-mix">
            <div className="dashboard-donut" style={split?{background:split}:undefined} aria-hidden="true"><span>Sales</span></div>
            <ul>{mix.map(item=><li key={item.label}><span style={{background:item.color}}/><span>{item.label}</span><strong>{money(item.value)}</strong></li>)}</ul>
          </div>
        </section>
      </div>
    </>}
  </section>;
}

type RollWidth = '80' | '58';
type ThermalProps = {report:DailyReport;agency:string;route:string;warning:string};

export function printThermalReport(width:RollWidth='80'){
  const source=document.querySelector<HTMLElement>('.thermal-print-source');
  if(!source)return;
  const root=document.documentElement;
  root.dataset.ledgerPrint=width;
  const heightMm=Math.ceil(source.getBoundingClientRect().height*25.4/96)+2;
  const style=document.createElement('style');
  style.media='print';
  style.textContent=`@page { size: ${width}mm ${heightMm}mm; margin: 0; }`;
  document.head.append(style);
  const cleanup=()=>{
    delete root.dataset.ledgerPrint;
    style.remove();
    window.removeEventListener('afterprint',cleanup);
  };
  window.addEventListener('afterprint',cleanup,{once:true});
  try { window.print(); } catch(error) { cleanup(); throw error; }
}

export function ThermalPrintSource(props:ThermalProps){
  return createPortal(<div className="thermal-print-source" aria-hidden="true"><ThermalSlip {...props} width="80"/></div>,document.body);
}

export function ThermalReport(props:ThermalProps){
  const [width,setWidth]=useState<RollWidth>('80');
  return <>
    <div className="modal-body thermal-body">
      <div className="thermal-options">
        <label className="field">Paper roll<select value={width} onChange={event=>setWidth(event.target.value==='58'?'58':'80')}><option value="80">80 mm</option><option value="58">58 mm</option></select></label>
        <p>In the print dialog, choose your printer and the matching roll size. Use 100% scale and turn off headers and footers if those controls are available.</p>
      </div>
      <ThermalSlip {...props} width={width}/>
    </div>
    <div className="modal-footer"><button className="button primary" onClick={()=>printThermalReport(width)}><Printer size={17}/>Print {width} mm</button></div>
  </>;
}

function ThermalSlip({report,agency,route,warning,width}:ThermalProps&{width:RollWidth}){
  const rows:[string,number|null][]=[
    [report.dailySales&&!report.salesTotalTooLow?'Total sales':'Recorded invoice value',report.invoiceValue],['New credit',report.newCredit],
    ['Cash from sales',report.cashFromInvoices],['Cheques from sales',report.salesCheques],['Old balance cash',report.cashFromCollections],
    ['Expected cash',report.expectedCash],['Counted cash',report.physicalCash],['Cash difference',report.difference],
    ['Cheques received',report.chequesReceived],['Cheques deposited',report.chequesDeposited],
    ['Cheques cleared',report.chequesCleared],['Cheques returned',report.chequesReturned],
    ['Est. gross profit (7%)',estimateGrossProfit(report.invoiceValue)]
  ];
  return <article className={`thermal-slip thermal-${width}`}>
        <header>
          <strong>HG Saman Indika Wimalaratna</strong>
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
          <div style={{borderTop:'1px dashed #000',paddingTop:'4px',fontWeight:'bold'}}>System Developed By : Dewmika Anusara</div>
          <div>www.dew.pshycolab.com | 0763107113</div>
        </footer>
  </article>;
}
