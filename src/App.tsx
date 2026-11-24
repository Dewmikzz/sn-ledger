import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpDown, ArrowUpRight, Banknote, BookOpen, CalendarDays, Camera, Maximize, Minimize, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Boxes, Clock3, CreditCard, Download, Ellipsis, FileCheck2, FileText, Fingerprint, HelpCircle, Image, Landmark, LayoutDashboard, ListFilter, LockKeyhole, MapPin, Menu, MoreHorizontal, Pencil, Plus, Printer, RefreshCw, Route, Search, Settings, Shield, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Store, Trash2, Upload, Wallet, Wifi, WifiOff, X } from 'lucide-react';
import { businessDate, buildReport, createDayClose, deriveLedger, money, newId, parseLocationInput, shopSummary, toMinor } from './domain';
import type { ChequeView, DailySalesEvent, InvoiceView, LedgerData, LedgerEvent, OperatorId, Shop, ShopLedgerEvent } from './domain';
import { useLedger } from './store';
import { configured, enrollDevice, enrollWithOwnerPin, openOwnerPinSetup, watchDeviceIdentity, revokeLocalSession } from './firebase';
import { hasPin, setPin, verifyPin, changePin, resetPinAfterOwnerEnrollment } from './pin';
import { isBiometricsAvailable, isBiometricsEnrolled, registerBiometrics, verifyBiometrics, removeBiometrics } from './biometrics';
import { clearPhotos, exportPhotos, restorePhotos, getPhoto, listPhotos, savePhoto } from './photos';
import type { PhotoRecord } from './photos';
import { EntryForm } from './EntryForm';
import { ActionForm, Field, Modal } from './forms';
import { Stock } from './Stock';
import { SalesDashboard, ThermalPrintSource, ThermalReport, printThermalReport } from './Insights';
import { clearOwnerSession, ownerSessionRemaining, touchOwnerSession } from './ownerSession';
import { NotificationTray, useLedgerAlerts } from './notifications';

type Page='today'|'shops'|'cheques'|'reports'|'stock'|'settings';
type Mode='demo'|'live';
const navItems=[{id:'today',label:'Home',icon:LayoutDashboard},{id:'shops',label:'Shops',icon:Store},{id:'cheques',label:'Cheques',icon:CreditCard},{id:'stock',label:'Stock',icon:Boxes},{id:'reports',label:'Reports',icon:FileText}] as const;
const defaultSettings={agency:'Saman Indika Ledger',me:'Saman Indika',brother:'Brother',lockMinutes:5};
function readSettings(mode:Mode){try{return {...defaultSettings,...JSON.parse(localStorage.getItem(`si-settings-${mode}`)||'{}')}}catch{return defaultSettings}}
function pinProfile(mode:Mode):OperatorId {
 return !hasPin(mode,'me') && hasPin(mode,'brother') ? 'brother' : 'me';
}
function formatDate(date:string,short=false){return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',short?{day:'numeric',month:'short'}:{weekday:'long',day:'numeric',month:'long',year:'numeric'});}
function amountCompact(n:number){return new Intl.NumberFormat('en-LK',{maximumFractionDigits:n%100?2:0,minimumFractionDigits:n%100?2:0}).format(n/100)}
function initials(name?:string|null){if(!name||typeof name!=='string')return 'SI';const parts=name.trim().split(/\s+/).filter(Boolean).slice(0,2);return parts.length?parts.map(x=>x[0]||'').join('').toUpperCase():'SI'}
function Badge({children,tone='neutral'}:{children:ReactNode;tone?:string}){return <span className={`badge ${tone}`}>{children}</span>}
function Empty({title,body,action}:{title:string;body:string;action?:ReactNode}){return <div className="empty"><BookOpen size={30}/><h3>{title}</h3><p>{body}</p>{action}</div>}
function getEventPhotoIds(e: LedgerEvent): string[] {
 const ids: string[] = [];
 if ('photoIds' in e && Array.isArray(e.photoIds)) ids.push(...e.photoIds);
 if ('cheques' in e && Array.isArray(e.cheques)) {
  for (const c of e.cheques) if (Array.isArray(c.photoIds)) ids.push(...c.photoIds);
 }
 return ids;
}

function PinModal({title,subtitle,operator,mode,onClose,onSuccess}:{title:string;subtitle?:string;operator:OperatorId;mode:Mode;onClose:()=>void;onSuccess:()=>void}){
 const [pin,setPin]=useState('');
 const [error,setError]=useState('');
 async function handleSubmit(e:React.FormEvent){
  e.preventDefault();
  try{
   if(hasPin(mode,operator)){
    const res=await verifyPin(mode,operator,pin);
    if(!res.ok)throw new Error(res.retryAfterSeconds?('Try again in '+res.retryAfterSeconds+'s'):'Incorrect PIN.');
   }
   onSuccess();
  }catch(err){
   setError((err as Error).message);
  }
 }
 return <Modal title={title} subtitle={subtitle} onClose={onClose}><form className="action-form" onSubmit={handleSubmit}><div className="modal-body"><Field label="Personal 6-digit PIN"><input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={pin} onChange={e=>setPin(e.target.value)} autoFocus/></Field>{error&&<p role="alert" className="error-text">{error}</p>}</div><div className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Confirm PIN</button></div></form></Modal>;
}

export default function App(){
 const [mode,setMode]=useState<Mode>(()=>localStorage.getItem('si-mode')==='live'?'live':'demo');
 const [settings,setSettings]=useState(()=>readSettings(mode));
 const [operator,setOperator]=useState<OperatorId|null>(()=>mode==='demo'&&(!hasPin('demo',pinProfile('demo'))||ownerSessionRemaining('demo',settings.lockMinutes)>0)?'me':null);
 const [identity,setIdentity]=useState<{uid:string}|null>(null);
 const ownerScope=mode==='demo'?'demo':identity?.uid??null;
 const ownerActivity=useRef(0);
 const [fullscreen,setFullscreen]=useState(false);
 const [page,setPage]=useState<Page>('today'); const [date,setDate]=useState(businessDate()); const [route,setRoute]=useState('');
 const [search,setSearch]=useState('');
 const [selectedShop,setSelectedShop]=useState<string|null>(null);
 const [entry,setEntry]=useState<{kind:'invoice'|'collection';shopId?:string}|null>(null); const [addChoice,setAddChoice]=useState(false);
 const [salesDraft,setSalesDraft]=useState<{date:string;previous?:DailySalesEvent}|null>(null);
 const [shopEditor,setShopEditor]=useState<Shop|'new'|null>(null); const [photos,setPhotos]=useState<{ids:string[];title:string}|null>(null);
 const [thermalOpen,setThermalOpen]=useState(false);
 const [closeOpen,setCloseOpen]=useState(false); const [correction,setCorrection]=useState<InvoiceView|null>(null);
 const [toast,setToast]=useState(''); const [online,setOnline]=useState(navigator.onLine); const [enrolOpen,setEnrolOpen]=useState(false);
 const [pinPrompt,setPinPrompt]=useState<{title:string;subtitle?:string;onSuccess:()=>void}|null>(null);
 const requirePin=(title:string,onSuccess:()=>void)=>{if(operator&&hasPin(mode,pinProfile(mode)))setPinPrompt({title,onSuccess});else onSuccess()};
 const [installPrompt,setInstallPrompt]=useState<any>(null); const [installOpen,setInstallOpen]=useState(false); const [menuOpen,setMenuOpen]=useState(false);
 const [localPhotos,setLocalPhotos]=useState<PhotoRecord[]>([]); const [photoVersion,setPhotoVersion]=useState(0);
 const [preloader,setPreloader]=useState<{title?:string;subtitle?:string}|null>(null);
 const [selectedRoute,setSelectedRoute]=useState('');
 const [shopSort,setShopSort]=useState<'name'|'credit-desc'|'credit-asc'|'due-date'|'route'>('name');
 const [activitySort,setActivitySort]=useState<'time-desc'|'time-asc'|'amount-desc'|'shop'>('time-desc');
 const [showRoutesDeck,setShowRoutesDeck]=useState(false);
 const ledgerStore=useLedger(mode); const {data,ready,pendingCount,attentionCount,syncStatus}=ledgerStore;
 const shopName=(id?:string|null)=>data.shops.find(s=>s.id===id)?.name||'Unknown shop';
 const deviceId=useMemo(()=>{let id=localStorage.getItem('si-device-id');if(!id){id=newId();localStorage.setItem('si-device-id',id)}return id},[]);
 const derived=useMemo(()=>deriveLedger(data),[data]);
 const ledgerAlerts=useLedgerAlerts(mode==='live'&&operator?ownerScope:null,data,derived.cheques,ready,!online||pendingCount>0);
 const routes=useMemo(()=>[...new Set(data.shops.map(s=>s.route).filter(Boolean))].sort() as string[],[data.shops]);
 const today=businessDate();
 const daily=useMemo(()=>buildReport(data,date,{route:route||undefined}),[data,date,route]);
 const routeSummaries=useMemo<RouteSummary[]>(()=>{
  const routesMap=new Map<string,RouteSummary>();
  const shops=data?.shops||[];
  for(const s of shops){
   const routeName=String(s.route||s.village||'Other').trim()||'Other';
   if(!routesMap.has(routeName))routesMap.set(routeName,{name:routeName,shopCount:0,credit:0,pendingCheques:0,overdueInvoices:0});
   const sum=routesMap.get(routeName)!;
   sum.shopCount+=1;
   const sSummary=shopSummary(data,s.id,derived);
   sum.credit+=(sSummary?.credit||0);
   sum.pendingCheques+=(sSummary?.pendingCheques||0);
  }
  for(const inv of (derived?.invoices||[])){
   if(inv.credit>0&&inv.dueDate&&inv.dueDate<today){
    const s=shops.find(shop=>shop.id===inv.shopId);
    const routeName=String(s?.route||s?.village||'Other').trim()||'Other';
    if(!routesMap.has(routeName))routesMap.set(routeName,{name:routeName,shopCount:0,credit:0,pendingCheques:0,overdueInvoices:0});
    const sum=routesMap.get(routeName)!;
    sum.overdueInvoices+=1;
   }
  }
  return Array.from(routesMap.values()).sort((a,b)=>b.credit-a.credit||a.name.localeCompare(b.name));
 },[data?.shops,derived,today]);
 const sortedShops=useMemo(()=>{
  const list=(data?.shops||[]).filter(s=>{
   const matchesSearch=[s.name,s.phone,s.village,s.route].filter(Boolean).join(' ').toLowerCase().includes((search||'').toLowerCase());
   const routeName=String(s.route||s.village||'Other').trim();
   const matchesRoute=!selectedRoute||routeName.toLowerCase()===selectedRoute.trim().toLowerCase();
   return matchesSearch&&matchesRoute;
  });
  list.sort((a,b)=>{
   if(shopSort==='credit-desc')return (shopSummary(data,b.id,derived)?.credit||0)-(shopSummary(data,a.id,derived)?.credit||0);
   if(shopSort==='credit-asc')return (shopSummary(data,a.id,derived)?.credit||0)-(shopSummary(data,b.id,derived)?.credit||0);
   if(shopSort==='due-date'){
    const dA=shopSummary(data,a.id,derived)?.nextDueDate||'9999-99-99';
    const dB=shopSummary(data,b.id,derived)?.nextDueDate||'9999-99-99';
    return dA.localeCompare(dB);
   }
   if(shopSort==='route')return String(a.route||a.village||'').localeCompare(String(b.route||b.village||''));
   return String(a.name||'').localeCompare(String(b.name||''));
  });
  return list;
 },[data?.shops,derived,search,selectedRoute,shopSort]);
 const sortedDailyEntries=useMemo(()=>{
  const entries=daily?.entries||[];
  const list=entries.filter(e=>{
   const sName=shopName(e.shopId);
   const ref=e.kind==='invoice'?(e.reference||''):e.kind;
   return `${sName} ${ref}`.toLowerCase().includes((search||'').toLowerCase());
  });
  list.sort((a,b)=>{
   if(activitySort==='time-asc')return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
   if(activitySort==='amount-desc'){
    const getAmt=(ev:LedgerEvent)=>{
     if(ev.kind==='invoice')return ev.total||0;
     if(ev.kind==='collection')return (ev.cash||0)+(('cheques' in ev && Array.isArray(ev.cheques))?ev.cheques:[]).reduce((s,c)=>s+(c?.amount||0),0);
     if(ev.kind==='correction')return ev.total||0;
     return 0;
    };
    return getAmt(b)-getAmt(a);
   }
   if(activitySort==='shop')return shopName(a.shopId).localeCompare(shopName(b.shopId));
   return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
  });
  return list;
 },[daily?.entries,data?.shops,search,activitySort]);
 const notify=(message:string)=>setToast(message);
 const lock=()=>{
  if(ownerScope)clearOwnerSession(ownerScope);
  ownerActivity.current=0;
  setOperator(null);
 };
 const toggleFullscreen=async()=>{
  try {
   if(document.fullscreenElement)await document.exitFullscreen();
   else if(document.fullscreenEnabled)await document.documentElement.requestFullscreen({navigationUI:'hide'});
   else notify('Install SI Ledger from your browser menu to open it full screen.');
  } catch { notify('Install SI Ledger from your browser menu to open it full screen.'); }
 };
 const handleUnlock=()=>{
  if(ownerScope){ownerActivity.current=Date.now();touchOwnerSession(ownerScope);}
  setPreloader({
   title:`Welcome, ${settings.me||defaultSettings.me}`,
   subtitle:'Authorized Distributor for Lakmee Export Lanka PVT LTD'
  });
  setTimeout(()=>{
   setOperator('me');
   setPreloader(null);
  },850);
 };
 const switchMode=(next:Mode)=>{lock();setMode(next);localStorage.setItem('si-mode',next);setSettings(readSettings(next));setOperator(next==='demo'&&!hasPin(next,pinProfile(next))?'me':null);setPage('today');setRoute('');setSearch('');setSelectedShop(null)};
 useEffect(()=>{const on=()=>setOnline(navigator.onLine);window.addEventListener('online',on);window.addEventListener('offline',on);const install=(e:Event)=>{e.preventDefault();setInstallPrompt(e)};window.addEventListener('beforeinstallprompt',install);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',on);window.removeEventListener('beforeinstallprompt',install)}},[]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(t)},[toast]);
 useEffect(()=>{listPhotos(mode).then(setLocalPhotos).catch(()=>{});},[mode,photoVersion,entry]);
 useEffect(()=>{
  if(!configured)return;
  let previousUid:string|undefined;
  return watchDeviceIdentity(id=>{
   if(previousUid&&previousUid!==id?.uid){clearOwnerSession(previousUid);ownerActivity.current=0;}
   previousUid=id?.uid;
   setIdentity(id);
   if(mode==='live'&&!id)setOperator(null);
  });
 },[mode]);
 useEffect(()=>{
  if(mode==='live'&&ownerScope)setOperator(ownerSessionRemaining(ownerScope,settings.lockMinutes)>0?'me':null);
 },[mode,ownerScope]);
 useEffect(()=>{
  if(!ownerScope||!operator)return;
  const duration=settings.lockMinutes*60_000;
  const remaining=Math.max(ownerSessionRemaining(ownerScope,settings.lockMinutes),ownerActivity.current+duration-Date.now());
  if(!remaining&&(mode==='live'||hasPin('demo',pinProfile('demo')))){setOperator(null);return;}
  let deadline=Date.now()+(remaining||duration);
  let timer:ReturnType<typeof setTimeout>;
  const expire=()=>{if(Date.now()>=deadline){clearOwnerSession(ownerScope);ownerActivity.current=0;setOperator(null);}};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(expire,Math.max(0,deadline-Date.now()));};
  const activity=()=>{
   if(Date.now()>=deadline){expire();return;}
   ownerActivity.current=Date.now();
   touchOwnerSession(ownerScope);
   deadline=Date.now()+duration;
   schedule();
  };
  if(!remaining)touchOwnerSession(ownerScope);
  schedule();
  const events=['pointerdown','keydown','touchstart'];
  events.forEach(event=>window.addEventListener(event,activity));
  document.addEventListener('visibilitychange',expire);
  return()=>{
   clearTimeout(timer);
   events.forEach(event=>window.removeEventListener(event,activity));
   document.removeEventListener('visibilitychange',expire);
  };
 },[mode,operator,ownerScope,settings.lockMinutes]);
 useEffect(()=>{
  const update=()=>setFullscreen(!!document.fullscreenElement);
  document.addEventListener('fullscreenchange',update);
  return()=>document.removeEventListener('fullscreenchange',update);
 },[]);
 const updateSettings=(next:typeof settings)=>{setSettings(next);localStorage.setItem(`si-settings-${mode}`,JSON.stringify(next))};
 const operatorName=(id?:OperatorId|null)=>id==='brother'?(settings?.brother||'Brother'):(settings?.me||'Me');
 const goto=(next:Page)=>{setPage(next);setSearch('');setMenuOpen(false)};
 const openShop=(id:string)=>{setSelectedShop(id);setPage('shops');setSearch('')};
 const submit=async(event:LedgerEvent)=>{
  await ledgerStore.submitEvent(event);
  if(event.kind==='invoice'||event.kind==='collection')setDate(event.date);
  setEntry(null);
  notify(mode==='demo'?'Saved in demo workspace':online?'Saved on this phone · syncing':'Saved on this phone · will sync when online');
 };
 const eventBase=(shopId:string)=>({id:newId(),date:today,createdAt:new Date().toISOString(),operatorId:operator!,deviceId,shopId});
 const incomplete=!online||pendingCount>0||mode==='demo';
 const insightsWarning=mode==='demo'?'Demo · sample records only.':!online?'Offline · figures may be incomplete.':pendingCount?'Pending sync · figures may be incomplete.':'';
 if(preloader)return <Preloader {...preloader}/>;
 if(!operator || (mode==='live'&&!identity))return <><Login key={mode} mode={mode} settings={settings} hasIdentity={!!identity} onUnlock={handleUnlock} onDemo={()=>switchMode('demo')} onEnroll={()=>setEnrolOpen(true)}/>{enrolOpen&&<Enroll onClose={()=>setEnrolOpen(false)} onDone={()=>{setEnrolOpen(false);switchMode('live');notify('Device set up. Use your Owner PIN to unlock.')}}/>}{toast&&<div className="toast"><Check size={18}/>{toast}</div>}</>;
 return <div className="app-shell ledger-shell">
  <aside className={`sidebar ${menuOpen?'mobile-open':''}`}>
   <a href="#today" className="brand" onClick={e=>{e.preventDefault();goto('today')}}><img className="ledger-brand-icon" src="/icons/ledger-mark-192.png" width="42" height="42" alt=""/><div><strong>SI Ledger</strong><span>SAMAN INDIKA</span></div></a>
   <div className="workspace-label">YOUR WORKSPACE</div>
   <nav>{navItems.map(({id,label,icon:Icon})=><button key={id} className={`nav-item ${page===id?'active':''}`} onClick={()=>goto(id)}><Icon size={19}/><span>{label}</span>{id==='cheques'&&derived.cheques.filter(c=>c.status==='received').length>0&&<span className="nav-count">{derived.cheques.filter(c=>c.status==='received').length}</span>}</button>)}</nav>
   <div className="sidebar-bottom"><div className="agency-info"><span className="agency-avatar">SI</span><div><b>Lakmee distribution</b><span><MapPin size={12}/> Polonnaruwa, Sri Lanka</span></div></div><button className={`nav-item ${page==='settings'?'active':''}`} onClick={()=>goto('settings')}><Settings size={19}/><span>Settings</span></button><button className="nav-item" onClick={()=>setInstallOpen(true)}><Smartphone size={19}/><span>Install app</span><Download size={15}/></button><div className="sidebar-credit">Developed by <a href="https://dew.pshycolab.com" target="_blank" rel="noreferrer">Dewmika Anusara</a></div></div>
  </aside>
  <div className="main-shell">
   <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={()=>setMenuOpen(!menuOpen)}><Menu size={21}/></button><span className="breadcrumb">Workspace</span><ChevronRight size={15}/><b>{page==='today'?'Dashboard':page[0].toUpperCase()+page.slice(1)}</b></div><div className="topbar-right"><NotificationTray {...ledgerAlerts} onClear={ledgerAlerts.markRead} onDismiss={ledgerAlerts.closeLatest} onCheques={()=>goto('cheques')} onHome={()=>goto('today')}/><button type="button" className="icon-button fullscreen-button" title={fullscreen?'Exit full screen':'Full screen'} aria-label={fullscreen?'Exit full screen':'Full screen'} onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize size={19}/>:<Maximize size={19}/>}</button><button className={`sync-indicator ${!online?'offline':''}`} onClick={()=>{ledgerStore.retrySync().catch(e=>notify(e.message));if(mode==='demo')notify('Demo data stays on this device. Connect Firebase for live sync.')}} title="Check sync status">{online?<CheckCheck size={16}/>:<WifiOff size={16}/>}<span>{mode==='demo'?'Saved on this device':syncStatus==='synced'?'All changes synced':syncStatus==='syncing'?'Syncing…':syncStatus==='attention'?'Needs attention':online?'Saved on this phone':'Offline'}</span></button><span className="topbar-divider"/><button className="profile-control" onClick={lock} title="Lock ledger"><span className="avatar">{initials(operatorName(operator))}</span><span className="profile-name">{operatorName(operator)}<small>Owner</small></span><LockKeyhole size={15}/></button></div></header>
   {mode==='demo'&&<div className="demo-banner"><span><span className="demo-dot"/>Demo workspace <span className="demo-detail">· Explore with sample records. Your live agency stays separate.</span></span><button onClick={()=>setEnrolOpen(true)}>Set up your agency <ChevronRight size={14}/></button></div>}
   {!online&&<div className="offline-banner"><WifiOff size={15}/>You’re offline. Entries and original photos are saved on this phone.</div>}
   <main>
    <div className="page-heading"><div><div className="eyebrow">{page==='today'?'SAMAN INDIKA LEDGER':page==='shops'?'EVERY SHOP, ONE CLEAR LEDGER':page==='cheques'?'FROM RECEIVED TO SETTLED':page==='reports'?'CLOSE THE DAY WITH CONFIDENCE':page==='stock'?'INVENTORY':'YOUR AGENCY, YOUR WORKFLOW'}</div><h1>{page==='today'?'Dashboard':page==='shops'?'Shop ledgers':page==='cheques'?'Cheque register':page==='reports'?'Daily report':page==='stock'?'Stock management':'Settings'}</h1><p>{page==='today'?'Sales, payments, and collections in one place.':page==='shops'?'Keep every balance, receipt, and follow-up together.':page==='cheques'?'Track each cheque without losing sight of the balance.':page==='reports'?'Reconcile your cash and keep an honest record of the day.':page==='stock'?'Track stock, packaging, and prices.':'Manage your agency, trusted device, and local photo backups.'}</p></div>{page==='shops'?<button className="button primary heading-action" onClick={()=>setShopEditor('new')}><Plus size={18}/>Add shop</button>:page==='reports'?<button className="button primary heading-action" onClick={()=>setCloseOpen(true)}><Wallet size={17}/>{daily.originalClose?'View cash close':'Count cash & close'}</button>:page!=='settings'&&page!=='stock'&&<button className="button primary heading-action" onClick={()=>setAddChoice(true)}><Plus size={19}/>Add entry</button>}</div>
    {(page==='today'||page==='reports')&&<div className="filterbar"><label className="date-control"><CalendarDays size={17}/><input aria-label="Business date" type="date" value={date} onChange={e=>setDate(e.target.value||today)}/></label><div className="filterbar-right"><label className="select-control"><MapPin size={15}/><select aria-label="Filter route" value={route} onChange={e=>setRoute(e.target.value)}><option value="">All routes</option>{routes.map(r=><option key={r}>{r}</option>)}</select><ChevronDown size={14}/></label></div></div>}
    {!ready?<div className="loading"><RefreshCw className="spin"/> Opening your ledger…</div>:<>
    {(page==='today'||page==='reports')&&route&&derived.dailySales.has(date)&&<p className="notice neutral">Route view shows recorded invoices for this route. Select All routes for the full sales total.</p>}
    {page==='today'&&daily.salesTotalTooLow&&<p role="alert" className="notice amber">Daily sales total is below the recorded invoices. Edit the total before closing cash. Figures below use recorded invoices.</p>}
    {page==='today'&&<>
     <SalesDashboard data={data} date={date} route={route} warning={insightsWarning}/><div className="dashboard-day-heading"><div><h2>Daily operations</h2><p>{formatDate(date)}</p></div><button className="button secondary" onClick={()=>setSalesDraft({date,previous:derived.dailySales.get(date)})}><Banknote size={16}/>{derived.dailySales.has(date)?'Edit daily sales total':'Enter daily sales total'}</button></div><div className="stats-grid"><Stat label="Expected cash" value={daily.expectedCash} icon={<Wallet size={19}/>} detail="Cash to reconcile for this date" accent/><Stat label={daily.dailySales&&!daily.salesTotalTooLow?'Total sales':'Recorded invoice value'} value={daily.invoiceValue} icon={<FileText size={19}/>} detail={daily.dailySales&&!daily.salesTotalTooLow?'Whole-day total':`${daily.invoiceCount} invoices recorded`}/><Stat label="New credit" value={daily.newCredit} icon={<Clock3 size={19}/>} detail="Credit issued on this date"/><Stat label="Cheques received" value={daily.chequesReceived} icon={<CreditCard size={19}/>} detail={`${derived.cheques.filter(c=>c.receivedDate===date&&(!route||data.shops.find(s=>s.id===c.shopId)?.route===route)).length} cheques received`}/></div>
     <div className="today-grid"><section className="panel activity-panel"><div className="panel-heading"><div><h2>{date===today?'Today’s activity':`Activity on ${formatDate(date,true)}`} <span className="count-chip">{sortedDailyEntries.length}</span></h2><p>Invoices and collections, all in one place.</p></div><button className="icon-button" title="Open full daily report" onClick={()=>goto('reports')}><MoreHorizontal size={21}/></button></div><div className="activity-toolbar"><label className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search shops or invoice references" aria-label="Search activity"/></label><div className="sort-select-chip"><ArrowUpDown size={14}/><select aria-label="Sort activity" value={activitySort} onChange={e=>setActivitySort(e.target.value as any)}><option value="time-desc">Newest first</option><option value="time-asc">Oldest first</option><option value="amount-desc">Amount: High to Low</option><option value="shop">Shop (A-Z)</option></select></div><span className="record-count">{sortedDailyEntries.length} entries</span></div><Activity data={data} events={sortedDailyEntries} invoices={derived.invoices} onShop={openShop} operatorName={operatorName} statuses={derived.statuses} onPhotos={setPhotos} onCorrect={setCorrection}/><div className="panel-footer"><ShieldCheck size={14}/><span>{mode==='demo'?'Sample records · demo only':'Every entry records the operator and device'}</span><button onClick={()=>goto('reports')}>View daily report <ChevronRight size={14}/></button></div></section>
      <div className="today-rail"><section className="panel attention-panel"><div className="panel-heading"><h2><span className="attention-icon"><CircleAlert size={17}/></span>Needs attention</h2><Badge tone="amber">{derived.invoices.filter(i=>i.credit>0&&!!i.dueDate&&i.dueDate<today).length+derived.cheques.filter(c=>c.status==='received'&&c.date<=today).length}</Badge></div><AttentionRow icon={<Clock3 size={17}/>} title="Overdue credit" subtitle={`${derived.invoices.filter(i=>i.credit>0&&i.dueDate&&i.dueDate<today).length} invoices to follow up`} value={money(derived.invoices.filter(i=>i.credit>0&&i.dueDate&&i.dueDate<today).reduce((s,i)=>s+i.credit,0))} tone="red" onClick={()=>{goto('shops');setSelectedShop(derived.invoices.find(i=>i.credit>0&&i.dueDate&&i.dueDate<today)?.shopId||null)}}/><AttentionRow icon={<Landmark size={17}/>} title="Ready to deposit" subtitle="Cheques dated today or earlier" value={`${derived.cheques.filter(c=>c.status==='received'&&c.date<=today).length} cheques`} tone="amber" onClick={()=>goto('cheques')}/><AttentionRow icon={<Camera size={17}/>} title="Receipt photos needed" subtitle="Keep thermal invoices readable" value={`${derived.invoices.filter(i=>!i.photoIds.length).length} invoices`} onClick={()=>goto('shops')}/>{attentionCount>0&&<AttentionRow icon={<CircleAlert size={17}/>} title="Sync needs attention" subtitle="Submissions preserved for review" value={`${attentionCount} entries`} tone="red" onClick={()=>goto('reports')}/>}</section>
      <section className="cash-card"><div className="cash-card-icon"><Banknote size={22}/></div><h2>A tidy end to the day.</h2><p>Count your cash, check the difference,<br className="desktop-br"/> and close with confidence.</p><button className="button secondary" onClick={()=>setCloseOpen(true)}><Wallet size={16}/>Reconcile cash</button></section>
      <div className="device-note"><ShieldCheck size={18}/><div><b>Your work stays with you.</b><p>Entries work offline. Keep a regular ZIP backup of your receipt photos.</p></div></div>
     </div></div>
     <div className="balance-strip"><div><span className="balance-strip-icon"><Store size={20}/></span><span>Across your shop ledgers<small>All dates · all routes</small></span></div><div><span>Outstanding credit</span><b>{money(derived.creditOutstanding)}</b></div><div><span>Pending cheques</span><b>{money(derived.pendingCheques)}</b></div><button onClick={()=>goto('shops')}>Open shop ledgers <ChevronRight size={15}/></button></div>
    </>}
    {page==='shops'&&<div className="shops-layout"><section className="panel shop-list-panel"><div className="routes-panel-header" style={{padding:'12px 14px 0'}}><button className="button secondary small-action-button" type="button" onClick={()=>setShowRoutesDeck(!showRoutesDeck)}><Route size={15}/><span>{showRoutesDeck?'Hide routes':('Routes ('+routeSummaries.length+')')}</span></button><div className="sorting-toolbar" style={{margin:0}}><div className="sort-select-chip"><MapPin size={13}/><select aria-label="Filter by route" value={selectedRoute} onChange={e=>setSelectedRoute(e.target.value)}><option value="">All routes ({data.shops.length})</option>{routeSummaries.map(r=><option key={r.name} value={r.name}>{r.name} ({r.shopCount})</option>)}</select></div><div className="sort-select-chip"><ArrowUpDown size={13}/><select aria-label="Sort shops" value={shopSort} onChange={e=>setShopSort(e.target.value as any)}><option value="name">Name (A-Z)</option><option value="credit-desc">Credit: High to Low</option><option value="credit-asc">Credit: Low to High</option><option value="due-date">Next due date</option><option value="route">Route name</option></select></div></div></div>{showRoutesDeck&&<div style={{padding:'0 14px'}}><RoutesOverview routes={routeSummaries} selectedRoute={selectedRoute} onSelectRoute={setSelectedRoute}/></div>}<div className="activity-toolbar"><label className="search-box"><Search size={17}/><input aria-label="Search shops" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, phone, village or route"/></label></div><div className="shop-list">{sortedShops.map(s=>{const summary=shopSummary(data,s.id,derived);return <button key={s.id} className={`shop-row ${selectedShop===s.id?'selected':''}`} onClick={()=>setSelectedShop(s.id)}><span className="shop-avatar">{initials(s.name)}</span><span className="shop-row-info"><b>{s.name}</b><small>{s.village||s.route||'No location added'}</small></span><span className="shop-row-money"><b>{money(summary.credit)}</b><small>credit outstanding</small></span><ChevronRight size={15}/></button>})}{sortedShops.length===0&&<Empty title="No shops found" body={selectedRoute?('No shops found on route "'+selectedRoute+'".'):"Add a shop to start its collection ledger."}/>}</div></section><section className="panel shop-detail">{selectedShop&&data.shops.some(s=>s.id===selectedShop)?(()=>{const s=data.shops.find(s=>s.id===selectedShop)!;const summary=shopSummary(data,s.id,derived);return <><div className="shop-detail-header"><div className="shop-profile"><span className="shop-avatar large">{initials(s.name)}</span><div><h2>{s.name}</h2><p><MapPin size={14}/>{[s.village,s.route!==s.village?s.route:null].filter(Boolean).join(' · ')||'Location not added'}</p></div></div><button className="button ghost" onClick={()=>requirePin(`Edit ${s.name}`,()=>setShopEditor(s))}>Edit shop</button></div><div className="shop-stats"><div><span>Credit outstanding</span><strong>{money(summary.credit)}</strong></div><div><span>Pending cheques</span><strong>{money(summary.pendingCheques)}</strong></div><div><span>Next due</span><strong>{summary.nextDueDate?formatDate(summary.nextDueDate,true):'All caught up'}</strong></div></div><div className="shop-actions"><button className="button primary" onClick={()=>setEntry({kind:'invoice',shopId:s.id})}><Plus size={16}/>Record invoice</button><button className="button secondary" onClick={()=>setEntry({kind:'collection',shopId:s.id})}><Banknote size={16}/>Collect payment</button></div><div className="shop-contact">{s.contact&&<span>{s.contact}</span>}{s.phone&&<a href={`tel:${s.phone.replace(/\s/g,'')}`}>{s.phone}</a>}{s.latitude!==undefined&&s.longitude!==undefined&&<a href={`https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer"><MapPin size={13}/>Open in Maps</a>}{!!s.photoIds?.length&&<button className="text-button" onClick={()=>setPhotos({ids:s.photoIds!,title:s.name})}>Storefront photo</button>}</div>{s.notes&&<div className="shop-notes">{s.notes}</div>}<div className="section-heading"><h3>Chronological ledger</h3><Badge>{data.events.filter(e=>e.shopId===s.id).length} entries</Badge></div><div className="ledger-timeline">{[...derived.events].filter((e):e is ShopLedgerEvent=>e.kind!=='daily-sales'&&e.shopId===s.id).reverse().map(e=>{const inv=e.kind==='invoice'?derived.invoices.find(i=>i.id===e.id):null;const allPhotos=getEventPhotoIds(e);return <div className="timeline-entry" key={e.id}><div className={`timeline-icon ${e.kind==='collection'?'green':''}`}>{e.kind==='invoice'?<FileText size={17}/>:e.kind==='collection'?<Banknote size={17}/>:<CreditCard size={17}/>}</div><div className="timeline-content"><div className="timeline-title"><b>{e.kind==='invoice'?e.reference:e.kind==='collection'?'Balance collected':e.kind==='correction'?'Invoice corrected':`Cheque ${e.status}`}</b><strong>{e.kind==='invoice'?money(inv?.total||e.total):e.kind==='collection'?money((e.cash||0)+(('cheques' in e && Array.isArray(e.cheques))?e.cheques:[]).reduce((n,c)=>n+(c?.amount||0),0)):e.kind==='correction'?money(e.total):money(derived.cheques.find(c=>c.id===e.chequeId)?.amount||0)}</strong></div><small>{formatDate(e.date,true)} · {operatorName(e.operatorId)}</small>{derived.statuses[e.id]?.status==='conflict'?<p className="error-text">{derived.statuses[e.id].reason}</p>:e.kind==='invoice'?<><p>{money(inv?.cash??e.cash)} cash · {money(inv?.pendingCheques||0)} pending cheque · <b>{money(inv?.credit||0)} credit</b></p><div className="timeline-actions"><button className="text-button" onClick={()=>setPhotos({ids:allPhotos,title:`${e.reference} photos`})}><Camera size={14}/>{allPhotos.length?`${allPhotos.length} photo${allPhotos.length>1?'s':''}`:'Photo needed'}</button>{inv&&<button className="button secondary small-action-button" onClick={()=>setCorrection(inv)}><Pencil size={13}/>Edit invoice</button>}</div></>:e.kind==='correction'?<p>{e.reason}</p>:e.kind==='collection'?<p>{money(e.cash)} cash · allocated to {e.allocations.length} invoice{e.allocations.length===1?'':'s'}</p>:<p>Balance updated once. No additional cash collection.</p>}</div></div>})}{!data.events.some(e=>e.shopId===s.id)&&<Empty title="A fresh ledger" body="Record an invoice or collect an existing recorded balance."/>}</div></>})():<Empty title="Every shop has a story" body="Select a shop to see its balances, receipts, and collection history."/>}</section></div>}
    {page==='stock'&&<Stock key={mode} mode={mode} online={online} notify={notify}/>}
    {page==='cheques'&&<Cheques cheques={derived.cheques} data={data} onShop={openShop} onPhotos={setPhotos} onTransition={async(c,status)=>{try{await submit({...eventBase(c.shopId),kind:'cheque-status',chequeId:c.id,status});notify(`Cheque marked ${status}. Ledger updated.`)}catch(e){notify((e as Error).message)}}}/>}
    {page==='reports'&&<><div className={`notice ${incomplete?'amber':'neutral'}`}><CircleAlert size={18}/><span>{mode==='demo'?'Demo report — sample records only. ':!online?'You are offline. This report may be incomplete. ':pendingCount?`${pendingCount} entries on this device are awaiting sync. `:'This device is up to date. '}Another device may still have unsynced entries.</span></div><div className="report-actions"><span>{formatDate(date)}</span><div><button className="button secondary" onClick={()=>setAddChoice(true)}><Plus size={16}/>Add entry</button><button className="button secondary" onClick={()=>exportCSV(data,date,route,settings.agency)}><Download size={16}/>Export CSV</button><button className="button secondary" onClick={()=>window.print()}><Printer size={16}/>Print full page</button><button className="button secondary" onClick={()=>setThermalOpen(true)}>Receipt preview</button><button className="button primary" onClick={()=>printThermalReport()}><Printer size={16}/>Print 80 mm</button></div></div><div className="report-grid"><section className="panel report-preview"><div className="report-paper-heading"><div className="report-distributor-header" style={{width:'100%'}}><div className="brand-mark small" style={{float:'right',margin:'0 0 10px 10px'}}><BookOpen size={22}/></div><h2 className="distributor-name">HG Saman Indika Wimalaratna</h2><div className="distributor-sub">Authorized Distributor for Lakmee Export Lanka PVT LTD</div><div className="distributor-addr">No 207/1, Palugasdamana, Polonnaruwa</div><div className="distributor-contact">Contact : 0765496411</div><div className="report-agency-title">{settings.agency} · Daily Collections &amp; Ledger Report</div></div></div><div className="report-meta"><div><b>{formatDate(date)}</b><span>Polonnaruwa, Sri Lanka · Asia/Colombo</span></div><div><b>{route||'All routes'}</b></div></div><div className="report-section"><h3>Sales &amp; credit</h3>{daily.salesTotalTooLow&&<p role="alert">Daily sales total needs review. Figures use recorded invoices.</p>}<ReportLine label={daily.dailySales&&!daily.salesTotalTooLow?'Total sales':`Recorded invoice value (${daily.invoiceCount})`} amount={daily.invoiceValue}/><ReportLine label="Cheques from sales" amount={daily.salesCheques}/><ReportLine label="New credit issued" amount={daily.newCredit}/></div><div className="report-section"><h3>Cash reconciliation</h3><ReportLine label="Cash from sales" amount={daily.cashFromInvoices}/><ReportLine label="Cash collected against balances" amount={daily.cashFromCollections}/><ReportLine label="Total expected cash" amount={daily.expectedCash} bold/><ReportLine label="Physical cash counted" amount={daily.physicalCash}/><ReportLine label="Difference (counted − expected)" amount={daily.difference} bold tone={daily.difference?'red':'green'}/></div><div className="report-section"><h3>Cheque movements</h3><ReportLine label="Received" amount={daily.chequesReceived}/><ReportLine label="Deposited" amount={daily.chequesDeposited}/><ReportLine label="Cleared" amount={daily.chequesCleared}/><ReportLine label="Returned" amount={daily.chequesReturned}/></div>{daily.originalClose&&<div className="close-note"><FileCheck2 size={18}/><div><b>Original close retained</b><p>{operatorName(daily.originalClose.operatorId)} · {new Date(daily.originalClose.createdAt).toLocaleString('en-GB',{timeZone:'Asia/Colombo'})}</p><p>Expected {money(daily.originalClose.snapshot.expectedCash)} · Counted {money(daily.originalClose.countedCash)} · Difference {money(daily.originalClose.countedCash-daily.originalClose.snapshot.expectedCash)}</p>{daily.revised&&<strong className="amber-text">Revised figures shown above. Original close is unchanged.</strong>}</div></div>}<div className="print-foot-official"><div className="dev-title">System Develop By : Dewmika Anusara</div><div className="dev-links"><a href="https://www.dew.pshycolab.com" target="_blank" rel="noreferrer">www.dew.pshycolab.com</a> | 0765496411</div><div className="owner-line">HG Saman Indika Wimalaratna · Authorized Distributor for Lakmee Export Lanka PVT LTD</div></div></section><div><section className="panel report-checks"><h2>Before you close</h2><AttentionRow icon={<Clock3 size={17}/>} title="Overdue balances" subtitle="Current balances due before report date" value={`${daily.overdueInvoices.length} invoices`} tone="red" onClick={()=>goto('shops')}/><AttentionRow icon={<Camera size={17}/>} title="Missing receipt photos" subtitle="Invoices recorded on this date" value={`${daily.missingPhotos.length} invoices`} tone="amber" onClick={()=>goto('shops')}/><AttentionRow icon={<RefreshCw size={17}/>} title="Awaiting sync" subtitle={mode==='demo'?'Demo records stay on this device':'Pending work on this device'} value={`${pendingCount} entries`} onClick={()=>ledgerStore.retrySync()}/></section>{daily.conflicts.length>0&&<section className="panel report-checks"><h2>Entries needing review</h2>{daily.conflicts.map(e=><div className="conflict-item" key={e.id}><b>{shopName(e.shopId)}</b><p>{derived.statuses[e.id]?.reason}</p><small>Submission retained · {operatorName(e.operatorId)}</small><button className="text-button" onClick={()=>openShop(e.shopId)}>Review shop ledger</button></div>)}</section>}{daily.corrections.length>0&&<section className="panel report-checks"><h2>Correction history</h2>{daily.corrections.map(e=><div className="conflict-item" key={e.id}><b>{shopName(e.shopId)}</b><p>{e.reason}</p><small>{formatDate(e.date,true)} · {operatorName(e.operatorId)} · revised invoice {money(e.total)}</small></div>)}</section>}<p className="report-hint"><ShieldCheck size={18}/>Closing the day preserves the original figures. Later corrections remain visible with a reason and operator.</p></div></div></>}
    {page==='settings'&&<SettingsPage settings={settings} updateSettings={updateSettings} mode={mode} identity={identity} onMode={switchMode} onEnroll={()=>setEnrolOpen(true)} onLock={lock} localPhotos={localPhotos} onPhotoChange={()=>setPhotoVersion(v=>v+1)} notify={notify} operator={pinProfile(mode)} onInstall={()=>setInstallOpen(true)} onClearAll={async()=>{await ledgerStore.clearAllData();await clearPhotos(mode);setPhotoVersion(v=>v+1);notify('All ledger records and photos cleared.')}} onResetDemo={async()=>{await ledgerStore.resetDemo();notify('Demo sample records restored.')}} queue={ledgerStore.queue} onRetrySync={()=>ledgerStore.retrySync().catch(e=>notify(e.message))} onDismissQueueItem={async(id)=>{await ledgerStore.dismissQueueItem(id);notify('Queue item dismissed.');}}/>}
    </>}
    {ledgerStore.error&&<div className="notice error"><CircleAlert size={18}/><span>{ledgerStore.error}</span><button className="text-button" onClick={()=>ledgerStore.retrySync()}>Retry</button></div>}
    <footer className="main-footer"><span>Saman Indika Ledger <span>·</span> Polonnaruwa</span><span>Made for a clearer day.</span></footer>
   </main>
  </div>
  <nav className="bottom-nav" aria-label="Main navigation">
   {navItems.map(({id,label,icon:Icon})=><div className="bottom-nav-slot" key={id}>
    {id==='cheques'&&<button className="bottom-add" aria-label="Add entry" title="Add entry" onClick={()=>setAddChoice(true)}><Plus size={23}/></button>}
    <button className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>goto(id)}><Icon size={19}/><span>{label}</span></button>
   </div>)}
  </nav>
  {page==='reports'&&<ThermalPrintSource report={daily} agency={settings.agency} route={route} warning={insightsWarning}/>}
  {thermalOpen&&<Modal title="Thermal daily report" onClose={()=>setThermalOpen(false)}><ThermalReport report={daily} agency={settings.agency} route={route} warning={insightsWarning}/></Modal>}
  {addChoice&&<Modal title="Add an entry" subtitle={formatDate(date)} onClose={()=>setAddChoice(false)}><div className="modal-body choice-list"><Field label="Entry date"><input type="date" value={date} onChange={event=>{if(event.target.value)setDate(event.target.value)}}/></Field><button onClick={()=>{setAddChoice(false);setSalesDraft({date,previous:derived.dailySales.get(date)})}}><span className="choice-icon"><Wallet size={25}/></span><span><b>Daily sales total</b><small>Enter the full sales total for the selected date.</small></span><ChevronRight size={20}/></button><button onClick={()=>{setAddChoice(false);setEntry({kind:'invoice'})}}><span className="choice-icon"><FileText size={25}/></span><span><b>Record invoice</b><small>Save a receipt, cash, cheques, and new credit.</small></span><ChevronRight size={20}/></button><button onClick={()=>{setAddChoice(false);setEntry({kind:'collection'})}}><span className="choice-icon blue"><Banknote size={25}/></span><span><b>Collect old balance</b><small>Apply a payment to outstanding invoices.</small></span><ChevronRight size={20}/></button></div></Modal>}
  {entry&&<EntryForm kind={entry.kind} initialDate={date} initialShopId={entry.shopId} data={data} mode={mode} operatorId={operator} deviceId={deviceId} onSave={submit} onSaveShop={ledgerStore.saveShop} onClose={()=>setEntry(null)}/>}
  {shopEditor&&<ShopForm shop={shopEditor==='new'?null:shopEditor} mode={mode} deviceId={deviceId} onClose={()=>setShopEditor(null)} onSave={async(s)=>{await ledgerStore.saveShop(s);setShopEditor(null);setSelectedShop(s.id);notify('Shop saved.')}} canDelete={shopEditor!=='new'&&!data.events.some(e=>e.shopId===shopEditor.id)} onDelete={()=>{const s=shopEditor as Shop;requirePin(`Delete ${s.name}`,async()=>{await ledgerStore.deleteShop(s.id);setShopEditor(null);setSelectedShop(null);notify('Shop deleted.');});}}/>}
  {pinPrompt&&<PinModal title={pinPrompt.title} subtitle={pinPrompt.subtitle} operator={pinProfile(mode)} mode={mode} onClose={()=>setPinPrompt(null)} onSuccess={()=>{const fn=pinPrompt.onSuccess;setPinPrompt(null);fn();}}/>}
  {salesDraft&&<Modal title="Daily sales total" subtitle={formatDate(salesDraft.date)} onClose={()=>setSalesDraft(null)}>
   <ActionForm label="Save sales total" action={async form=>{
    const total=toMinor(String(form.get('sales')));
    const minimum=buildReport(data,salesDraft.date).itemizedSales;
    if(total<minimum)throw new Error(`Enter at least ${money(minimum)} to cover the invoices already recorded for this day.`);
    await ledgerStore.submitEvent({...eventBase(''),operatorId:'me',shopId:'',date:salesDraft.date,kind:'daily-sales',total,previousId:salesDraft.previous?.id??''});
    setDate(salesDraft.date);
    setRoute('');
    goto('today');
    setSalesDraft(null);
    notify('Daily sales total saved.');
   }}>
    <Field label="Sales date"><input type="date" value={salesDraft.date} required onChange={event=>{
     const next=event.target.value;
     if(next)setSalesDraft({date:next,previous:derived.dailySales.get(next)});
    }}/></Field>
    <Field label="Total sales (Rs.)"><input key={salesDraft.date} name="sales" inputMode="decimal" defaultValue={salesDraft.previous?(salesDraft.previous.total/100).toFixed(2):''} required/></Field>
    <p className="muted">Include every sale for the selected date. Record shop invoices with cheques or credit so the ledger can calculate cash from sales.</p>
   </ActionForm>
  </Modal>}
  {photos&&<PhotoViewer {...photos} mode={mode} onClose={()=>setPhotos(null)}/>}
  {closeOpen&&<CloseDay data={data} date={date} route={route} operatorId={operator} deviceId={deviceId} onClose={()=>setCloseOpen(false)} onSave={async(close)=>{await ledgerStore.closeDay(close);setCloseOpen(false);notify('Original cash close saved.');goto('reports')}}/>}
  {correction&&<Correction invoice={correction} onClose={()=>setCorrection(null)} onSave={async(total,cash,reason)=>{await submit({...eventBase(correction.shopId),kind:'correction',targetId:correction.id,total,cash,reason});setCorrection(null);notify('Correction recorded. Original entry retained.')}}/>}
  {enrolOpen&&<Enroll onClose={()=>setEnrolOpen(false)} onDone={()=>{setEnrolOpen(false);switchMode('live')}}/>}
  {installOpen&&<Modal title="Take your ledger with you" subtitle="Install SI Ledger on your home screen." onClose={()=>setInstallOpen(false)}><div className="modal-body"><div className="install-illustration"><img src="/icons/icon-192.png" alt="SI Ledger app icon"/><div><b>SI Ledger</b><p>Daily collections, credit & cheques</p></div></div>{installPrompt?<button className="button primary full" onClick={async()=>{await installPrompt.prompt();setInstallPrompt(null);setInstallOpen(false)}}><Download size={18}/>Install SI Ledger</button>:<><h3>Android · Chrome</h3><p>Open the browser menu, then choose <b>Install app</b> or <b>Add to Home screen</b>.</p><h3>iPhone · Safari</h3><p>Tap Share, then <b>Add to Home Screen</b>. Open the app once online before using it offline.</p></>}<div className="notice neutral"><WifiOff size={18}/>After the first load, the installed app can reopen offline. Photos remain on the capturing device until you export a backup.</div></div></Modal>}
  {toast&&<div className="toast" role="status"><Check size={18}/>{toast}</div>}
 </div>
}

function Stat({label,value,icon,detail,accent=false}:{label:string;value:number;icon:ReactNode;detail:string;accent?:boolean}){return <section className={`stat-card ${accent?'accent':''}`}><div className="stat-label"><span>{label}</span>{icon}</div><strong><small>Rs.</small>{amountCompact(value)}</strong><p>{accent&&<span className="tiny-dot"/>}{detail}</p></section>}
function AttentionRow({icon,title,subtitle,value,tone='',onClick}:{icon:ReactNode;title:string;subtitle:string;value:string;tone?:string;onClick:()=>void}){return <button className={`attention-row ${tone}`} onClick={onClick}><span className="row-icon">{icon}</span><span className="attention-text"><b>{title}</b><small>{subtitle}</small><span className={`attention-value ${tone}`}>{value}</span></span><ChevronRight size={16}/></button>}
function Activity({data,events,invoices,onShop,operatorName,statuses,onPhotos,onCorrect}:{data:LedgerData;events:ShopLedgerEvent[];invoices:InvoiceView[];onShop:(id:string)=>void;operatorName:(id?:OperatorId|null)=>string;statuses:ReturnType<typeof deriveLedger>['statuses'];onPhotos:(v:{ids:string[];title:string})=>void;onCorrect?:(inv:InvoiceView)=>void}){return <div className="activity-table"><div className="activity-table-header"><span>SHOP / ENTRY</span><span>AMOUNT</span><span>PAYMENT</span><span>BY</span><span className="activity-header-actions">ACTIONS</span></div>{events.map(e=>{const s=(data?.shops||[]).find(s=>s.id===e.shopId);const inv=e.kind==='invoice'?(invoices||[]).find(i=>i.id===e.id):null;const evCheques=('cheques' in e && Array.isArray(e.cheques))?e.cheques:[];const sum=e.kind==='invoice'?(inv?.total??e.total):e.kind==='collection'?(e.cash||0)+evCheques.reduce((s,c)=>s+(c?.amount||0),0):e.kind==='correction'?e.total:0;const photoIds=getEventPhotoIds(e);const chequeSum=(e.kind==='invoice'||e.kind==='collection')?evCheques.reduce((s,c)=>s+(c?.amount||0),0):0;return <div className="activity-row" key={e.id}><button className="activity-shop" onClick={()=>onShop(e.shopId)}><span className={`entry-icon ${e.kind==='collection'?'green':''}`}>{e.kind==='collection'?<ArrowDownLeft size={18}/>:<FileText size={18}/>}</span><span><b>{s?.name||'Shop'}</b><small>{e.kind==='invoice'?e.reference:e.kind==='collection'?'Balance collection':e.kind==='correction'?'Invoice correction':`Cheque ${e.status}`}{inv?.corrections?.length?` · Rev. ${inv.corrections.length}`:''} <span className="metadata-dot">·</span> {new Date(e.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Colombo'})}</small></span></button><strong className="table-amount">{sum?money(sum):'—'}</strong><div className="payment-badges">{statuses[e.id]?.status==='conflict'?<Badge tone="red">Needs attention</Badge>:e.kind==='invoice'||e.kind==='collection'?<>{(inv?.cash??e.cash)>0&&<Badge tone="green">Cash</Badge>}{chequeSum>0&&<Badge tone="blue">Cheque (Outstanding: {money(chequeSum)})</Badge>}{e.kind==='invoice'&&(inv?.credit??(e.total-e.cash-chequeSum))>0&&<Badge tone="amber">Credit</Badge>}</>:<Badge>{e.kind==='cheque-status'?e.status:'Corrected'}</Badge>}</div><span className={`operator-avatar ${e.operatorId==='brother'?'lavender':''}`} title={operatorName(e.operatorId)}>{initials(operatorName(e.operatorId))}</span><div className="activity-actions">{inv&&onCorrect&&<button className="icon-button edit-action" title={`Edit / correct invoice ${inv.reference}`} aria-label={`Edit invoice ${inv.reference}`} onClick={()=>onCorrect(inv)}><Pencil size={15}/></button>}<button className="icon-button photo-action" aria-label={e.kind==='invoice'?`View receipt & cheques for ${e.reference}`:'Open shop ledger'} title={e.kind==='invoice'?'View receipt & cheque photos':'Open shop ledger'} onClick={()=>e.kind==='invoice'?onPhotos({ids:photoIds,title:`${e.reference} photos`}):onShop(e.shopId)}><Camera size={16}/></button></div></div>})}{!events.length&&<Empty title="A clear page for the day" body="Record an invoice or collect an old balance to get started."/>}</div>}
function ReportLine({label,amount,bold=false,tone=''}:{label:string;amount:number|null;bold?:boolean;tone?:string}){return <div className={`report-line ${bold?'bold':''} ${tone}`}><span>{label}</span><strong>{amount===null?'Not counted':money(amount)}</strong></div>}

function Preloader({title,subtitle}:{title?:string;subtitle?:string}){
 return <div className="preloader-overlay" role="status" aria-live="polite">
  <div className="preloader-emblem-wrap">
   <div className="preloader-orbital-outer"/>
   <div className="preloader-orbital-inner"/>
   <div className="preloader-center-crest"><BookOpen size={28}/></div>
  </div>
  <div className="preloader-title">{title||'Saman Indika Ledger'}</div>
  <div className="preloader-subtitle">{subtitle||'Authorized Distributor · Lakmee Export Lanka PVT LTD'}</div>
  <div className="preloader-status-badge">
   <span className="preloader-dot-pulse"/>
   <span>Verifying operator security &amp; loading ledger…</span>
  </div>
  <div className="preloader-developer-credit">
   System Develop By : Dewmika Anusara · 0765496411
  </div>
 </div>;
}

interface RouteSummary {
 name: string;
 shopCount: number;
 credit: number;
 pendingCheques: number;
 overdueInvoices: number;
}

function RoutesOverview({routes,selectedRoute,onSelectRoute}:{routes:RouteSummary[];selectedRoute:string;onSelectRoute:(r:string)=>void}){
 if(!routes||!routes.length)return null;
 const totalShops=(routes||[]).reduce((acc,r)=>acc+(r?.shopCount||0),0);
 const totalCredit=(routes||[]).reduce((acc,r)=>acc+(r?.credit||0),0);
 return <div className="routes-card-deck">
  <button type="button" className={`route-card ${!selectedRoute?'selected':''}`} onClick={()=>onSelectRoute('')}>
   <div className="route-card-top"><span className="route-card-title"><Route size={16}/> All routes</span><Badge tone="green">{totalShops} shops</Badge></div>
   <div className="route-card-metrics"><span>Total outstanding</span><strong>{money(totalCredit)}</strong></div>
  </button>
  {routes.map(r=><button key={r.name} type="button" className={`route-card ${selectedRoute===r.name?'selected':''}`} onClick={()=>onSelectRoute(selectedRoute===r.name?'':r.name)}>
   <div className="route-card-top"><span className="route-card-title"><MapPin size={15}/> {r.name}</span><Badge tone={r.credit>0?'amber':'neutral'}>{r.shopCount} shop{r.shopCount===1?'':'s'}</Badge></div>
   <div className="route-card-metrics"><span>Credit: <strong>{money(r.credit)}</strong></span>{r.overdueInvoices>0&&<span className="red-text" style={{fontSize:'0.75rem'}}>({r.overdueInvoices} overdue)</span>}</div>
  </button>)}
 </div>;
}

function Login({mode,settings,hasIdentity,onUnlock,onDemo,onEnroll}:{mode:Mode;settings:typeof defaultSettings;hasIdentity:boolean;onUnlock:()=>void;onDemo:()=>void;onEnroll:()=>void}){
 const profile=pinProfile(mode);
 const [error,setError]=useState('');
 const [bioSupported,setBioSupported]=useState(false);
 const [bioEnrolled,setBioEnrolled]=useState(false);
 const [enableBio,setEnableBio]=useState(false);
 const available=mode==='demo'||hasIdentity;

 useEffect(()=>{
  isBiometricsAvailable().then(avail=>{
   setBioSupported(avail);
   if(avail)setBioEnrolled(isBiometricsEnrolled(mode,profile));
  });
 },[mode,profile]);

 const handleBiometricUnlock=async()=>{
  setError('');
  try{
   const verified=await verifyBiometrics(mode,profile);
   if(verified)onUnlock();
   else throw new Error('Biometric verification cancelled.');
  }catch(err){
   setError((err as Error).message);
  }
 };

 return <div className="premium-login-wrapper">
  <div className="geo-shape-top-left" aria-hidden="true"/>
  <div className="geo-shape-bottom-right" aria-hidden="true"/>
  <div className="premium-login-frame">
   <div className="login-card-header-accent">
    <img className="ledger-brand-icon login-brand-icon" src="/icons/ledger-mark-192.png" width="58" height="58" alt="SI Ledger"/>
    <div className="login-card-corner-triangle" aria-hidden="true"/>
    <span className="distributor-login-pill">Lakmee Export Lanka PVT LTD</span>
    <h2 className="login-company-title">HG Saman Indika Wimalaratna</h2>
    <p className="login-company-sub">Authorized Distributor · No 207/1, Palugasdamana, Polonnaruwa<br/>Contact : 0765496411</p>
    <h1 className="login-main-heading">Owner login</h1>
    <div className="login-heading-underline"/>
   </div>

   {available?(
    <div className="login-inner-card">
     <form onSubmit={async e=>{
      e.preventDefault();
      const f=new FormData(e.currentTarget);
      const pin=String(f.get('pin'));
      try{
       if(hasPin(mode,profile)){
        const result=await verifyPin(mode,profile,pin);
        if(!result.ok)throw new Error(result.retryAfterSeconds?('Try again in '+result.retryAfterSeconds+' seconds.'):'Incorrect PIN.');
       }else{
        if(pin!==f.get('confirm'))throw new Error('The PINs do not match.');
        await setPin(mode,profile,pin);
       }
       if(bioSupported&&enableBio&&!bioEnrolled){
        try{await registerBiometrics(mode,profile,settings.me)}catch{}
       }
       onUnlock();
      }catch(err){
       setError((err as Error).message);
      }
     }}>
      <div className="luxury-input-group">
       <label className="luxury-input-label" htmlFor="owner-pin">{hasPin(mode,profile)?'Owner PIN':'Create owner PIN'}</label>
       <div className="luxury-input-box">
        <input id="owner-pin" name="pin" autoFocus type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="••••••"/>
        <span className="luxury-input-icon"><LockKeyhole size={18}/></span>
       </div>
      </div>

      {!hasPin(mode,profile)&&<div className="luxury-input-group" style={{marginTop:'10px'}}>
       <label className="luxury-input-label" htmlFor="owner-pin-confirm">Confirm PIN</label>
       <div className="luxury-input-box">
        <input id="owner-pin-confirm" name="confirm" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="••••••"/>
        <span className="luxury-input-icon"><Check size={18}/></span>
       </div>
      </div>}

      {bioSupported&&!bioEnrolled&&hasPin(mode,profile)&&<label className="check-field" style={{fontSize:'0.82rem',color:'#2b4438',margin:'10px 0 2px',cursor:'pointer',display:'flex',alignItems:'center',gap:'7px'}}>
       <input type="checkbox" checked={enableBio} onChange={e=>setEnableBio(e.target.checked)}/>
       <span>Enable Biometric / Fingerprint login on this phone</span>
      </label>}

      {error&&<p role="alert" className="error-text" style={{margin:'8px 0 0',fontSize:'0.85rem'}}>{error}</p>}

      <button type="submit" className="luxury-primary-btn" style={{marginTop:'14px'}}>
       <Shield size={17}/>
       <span>Unlock Ledger</span>
      </button>
     </form>
    </div>
   ):(
    <div className="login-inner-card" style={{textAlign:'center'}}>
     <p style={{fontSize:'0.9rem',color:'#455b50',marginBottom:'14px'}}>This physical device requires owner device authorization before accessing live agency data.</p>
     <button type="button" className="luxury-primary-btn" onClick={onEnroll}>
      <Smartphone size={17}/>
      <span>Set up with Owner PIN</span>
     </button>
    </div>
   )}

   {available&&bioSupported&&bioEnrolled&&(
    <div className="biometric-auth-row">
     <div className="or-auth-divider"><span>Or Biometric</span></div>
     <button type="button" className="biometric-unlock-btn" onClick={handleBiometricUnlock}>
      <Fingerprint size={20}/>
      <span>Touch ID / Fingerprint / Face ID</span>
     </button>
    </div>
   )}

   <div style={{padding:'0 20px 10px',display:'flex',justifyContent:'center',gap:'10px'}}>
    {mode==='live'&&<button type="button" className="button ghost" style={{fontSize:'0.82rem'}} onClick={onDemo}>Open offline demo workspace</button>}
   </div>

   <div className="login-dev-footer">
    <div><strong>System Developed By : Dewmika Anusara</strong></div>
    <div><strong><a href="https://www.dew.pshycolab.com/" target="_blank" rel="noreferrer">www.dew.pshycolab.com</a></strong> | Contact : 0763107113</div>
   </div>
  </div>
 </div>;
}

function Enroll({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){
 const [recovery,setRecovery]=useState(false);
 return <Modal title="Set up this device" onClose={onClose}>
  {configured ? <>
   <ActionForm key={String(recovery)} label={recovery?'Use recovery token':'Set up phone'} action={async form=>{
    const value=String(form.get('credential'));
    if(recovery)await enrollDevice(value.trim());
    else {
     await enrollWithOwnerPin(value);
     await resetPinAfterOwnerEnrollment('live','me',value);
    }
    onDone();
   }}>
    {recovery
     ? <Field label="Recovery token"><input type="password" name="credential" required autoComplete="off"/></Field>
     : <><p className="muted">On an enrolled device, open Settings → Add a phone with Owner PIN. Then enter that same PIN here.</p>
        <Field label="Owner PIN"><input type="password" name="credential" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="off"/></Field></>}
    <button type="button" className="text-button" onClick={()=>setRecovery(!recovery)}>{recovery?'Use Owner PIN':'I have a recovery token'}</button>
   </ActionForm>
  </>:<div className="modal-body"><p>This build is in demo mode. Configure and deploy the Firebase build to set up a device for live agency work.</p></div>}
 </Modal>
}

function AddPhone({profile,onClose}:{profile:OperatorId;onClose:()=>void}){
 const [opened,setOpened]=useState(false);
 return <Modal title="Add a phone with Owner PIN" onClose={onClose}>
  {opened ? <div className="modal-body">
   <p role="status">Setup is open for 10 minutes. Up to three new devices can join with the same PIN.</p>
   <p>On each new device, open the ledger, tap <strong>Set up your agency</strong>, and enter the same Owner PIN.</p>
  </div>:<ActionForm label="Open setup for 10 minutes" action={async form=>{
   const pin=String(form.get('pin'));
   const result=await verifyPin('live',profile,pin);
   if(!result.ok)throw new Error(result.retryAfterSeconds?`Try again in ${result.retryAfterSeconds} seconds.`:'Incorrect Owner PIN.');
   await openOwnerPinSetup(pin);
   setOpened(true);
  }}>
   <p className="muted">Enter your current Owner PIN to let up to three new devices join in the same setup window.</p>
   <Field label="Owner PIN"><input type="password" name="pin" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="current-password"/></Field>
  </ActionForm>}
 </Modal>
}

function ShopForm({shop,mode,deviceId,onClose,onSave,canDelete,onDelete}:{shop:Shop|null;mode:Mode;deviceId:string;onClose:()=>void;onSave:(s:Shop)=>Promise<void>;canDelete?:boolean;onDelete?:()=>void}){
 const [id]=useState(()=>shop?.id||newId());const [lat,setLat]=useState(String(shop?.latitude??''));const [lng,setLng]=useState(String(shop?.longitude??''));const [locationInput,setLocationInput]=useState('');const [gps,setGps]=useState('');
 const handleLocationChange=(val:string)=>{
  setLocationInput(val);
  const parsed=parseLocationInput(val);
  if(parsed){
   setLat(String(parsed.latitude));
   setLng(String(parsed.longitude));
   setGps('Location detected from link or coordinates.');
  }
 };
 return <Modal title={shop?'Edit shop':'Add shop'} onClose={onClose}><ActionForm label="Save shop" action={async f=>{
 const next:Shop={...shop,id,name:String(f.get('name')).trim()};if(!next.name)throw new Error('Enter a shop name.');
 for(const key of ['contact','phone','village','route','notes'] as const)next[key]=String(f.get(key)).trim();
 if(Boolean(lat.trim())!==Boolean(lng.trim()))throw new Error('Enter both coordinates.');
 if(lat.trim()){const a=Number(lat),b=Number(lng);if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180)throw new Error('Enter valid coordinates.');next.latitude=a;next.longitude=b}else{delete next.latitude;delete next.longitude}
 const file=f.get('photo');if(file instanceof File&&file.size){const saved=await savePhoto(file,{mode,deviceId,ownerId:id,ownerType:'shop'});next.photoIds=[saved.id]}
 next.createdAt=shop?.createdAt||new Date().toISOString();
 next.updatedAt=new Date().toISOString();
 await onSave(next);
 }}><div className="field-grid">{(['name','contact','phone','village','route'] as const).map(key=><Field key={key} label={key==='name'?'Shop name':key[0].toUpperCase()+key.slice(1)}><input name={key} defaultValue={shop?.[key]} required={key==='name'} maxLength={120} type={key==='phone'?'tel':'text'}/></Field>)}</div><Field label="Notes"><textarea name="notes" maxLength={500} defaultValue={shop?.notes}/></Field><Field label="Google Maps link or coordinates"><input value={locationInput} onChange={e=>handleLocationChange(e.target.value)} placeholder="e.g. https://maps.google.com/?q=8.01,81.07 or 8.0108, 81.0740"/></Field><div className="field-grid"><Field label="Latitude"><input value={lat} onChange={e=>setLat(e.target.value)} inputMode="decimal"/></Field><Field label="Longitude"><input value={lng} onChange={e=>setLng(e.target.value)} inputMode="decimal"/></Field></div><div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}><button className="button secondary" type="button" onClick={()=>navigator.geolocation?.getCurrentPosition(p=>{setLat(String(p.coords.latitude));setLng(String(p.coords.longitude));setGps('Location captured.')},()=>setGps('Location unavailable. Enter coordinates manually.'),{timeout:10000})}><MapPin size={16}/>Use my location</button>{shop&&(canDelete?<button className="button secondary red" type="button" onClick={onDelete}><Trash2 size={16}/>Delete shop</button>:<span className="muted" style={{fontSize:'0.82rem'}} title="Shops with recorded invoices or collections cannot be deleted">Cannot delete (has history)</span>)}</div>{gps&&<p role="status" className="notice neutral" style={{marginTop:'6px',fontSize:'0.85rem'}}>{gps}</p>}<Field label="Storefront photo"><input type="file" accept="image/*" name="photo"/></Field></ActionForm></Modal>
}

function PhotoViewer({ids,title,mode,onClose}:{ids:string[];title:string;mode:Mode;onClose:()=>void}){
 return <Modal title={title} subtitle="Receipt photos" onClose={onClose} wide><div className="modal-body">{ids.length?ids.map((id,i)=><LocalImage key={id} id={id} mode={mode} index={i}/>):<p>Photo needed. No receipt photo was attached to this entry.</p>}</div></Modal>
}
function LocalImage({id,mode,index}:{id:string;mode:Mode;index:number}){
 const [url,setUrl]=useState<string|null|undefined>(undefined);const [zoom,setZoom]=useState(false);
 useEffect(()=>{let active=true;let objectUrl:string|undefined;getPhoto(id,mode).then(b=>{if(!active)return;objectUrl=b?URL.createObjectURL(b):undefined;setUrl(objectUrl??null)}).catch(()=>{if(active)setUrl(null)});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[id,mode]);
 if(url===undefined)return <p>Opening photo…</p>;
 if(!url)return <p className="notice amber">Photo unavailable on this device. Restore a ZIP from the capturing phone.</p>;
 return <button className={`receipt-image ${zoom?'zoomed':''}`} onClick={()=>setZoom(!zoom)} aria-label={zoom?'Fit photo':'Zoom photo'}><img src={url} alt={`Receipt photo ${index+1}`}/></button>
}

function Cheques({cheques,data,onShop,onPhotos,onTransition}:{cheques:ChequeView[];data:LedgerData;onShop:(id:string)=>void;onPhotos:(p:{ids:string[];title:string})=>void;onTransition:(c:ChequeView,s:'deposited'|'cleared'|'returned')=>Promise<void>}){
 const [filter,setFilter]=useState('');const [search,setSearch]=useState('');const [sort,setSort]=useState<'date-asc'|'amount-desc'|'bank'|'shop'>('date-asc');const [busy,setBusy]=useState<string|null>(null);
 return <section className="panel cheque-panel"><div className="activity-toolbar"><label className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search shop, bank or cheque number" aria-label="Search cheques"/></label><select aria-label="Filter cheque status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All statuses</option>{['received','deposited','cleared','returned'].map(s=><option key={s} value={s}>{s==='received'?'outstanding / received':s}</option>)}</select><div className="sort-select-chip"><ArrowUpDown size={14}/><select aria-label="Sort cheques" value={sort} onChange={e=>setSort(e.target.value as any)}><option value="date-asc">Due date: Soonest</option><option value="amount-desc">Amount: High to Low</option><option value="bank">Bank name</option><option value="shop">Shop (A-Z)</option></select></div></div>{cheques.filter(c=>!filter||c.status===filter).filter(c=>[c.bank,c.number,data.shops.find(s=>s.id===c.shopId)?.name].join(' ').toLowerCase().includes(search.toLowerCase())).sort((a,b)=>{if(sort==='amount-desc')return b.amount-a.amount;if(sort==='bank')return a.bank.localeCompare(b.bank);if(sort==='shop'){const sA=data.shops.find(s=>s.id===a.shopId)?.name||'';const sB=data.shops.find(s=>s.id===b.shopId)?.name||'';return sA.localeCompare(sB);}return a.date.localeCompare(b.date);}).map(c=><article className="cheque-row" key={c.id}><div><button className="text-button" onClick={()=>onShop(c.shopId)}>{data.shops.find(s=>s.id===c.shopId)?.name}</button><h3>{c.bank} · {c.number}</h3><p>Cheque date {formatDate(c.date,true)} · Received {formatDate(c.receivedDate,true)}</p><details><summary>History &amp; allocations</summary>{c.history.map(h=><p key={h.eventId}>{formatDate(h.date,true)} · {h.status} · {h.operatorId==='me'?'Me':'Brother'}</p>)}{c.allocations.map(a=><p key={a.invoiceId}>{data.events.find(e=>e.id===a.invoiceId&&e.kind==='invoice')?.id===a.invoiceId?(data.events.find(e=>e.id===a.invoiceId) as import('./domain').InvoiceEvent).reference:a.invoiceId} · {money(a.amount)}</p>)}</details></div><div><strong>{money(c.amount)}</strong><Badge tone={c.status==='returned'?'red':c.status==='cleared'?'green':'amber'}>{c.status==='received'?(c.date<businessDate()?'Outstanding · Overdue to deposit':c.date===businessDate()?'Outstanding · Ready to deposit':('Outstanding · Due '+formatDate(c.date,true))):c.status}</Badge><div className="cheque-actions">{!!c.photoIds.length&&<button className="button ghost" onClick={()=>onPhotos({ids:c.photoIds,title:c.number})}><Camera size={16}/>Photo</button>}{(c.status==='received'||c.status==='deposited')&&<>{([c.status==='received'?'deposited':'cleared','returned'] as const).map(status=><button key={status} className="button secondary" disabled={busy===c.id} onClick={async()=>{if(status==='returned'&&!confirm('Mark this cheque returned and restore its invoice balances?'))return;setBusy(c.id);try{await onTransition(c,status)}finally{setBusy(null)}}}>Mark {status}</button>)}</>}</div></div></article>)}{!cheques.length&&<Empty title="No cheques recorded" body="Cheques appear here when you record an invoice or collection."/ >}</section>
}

function CloseDay({data,date,route,operatorId,deviceId,onClose,onSave}:{data:LedgerData;date:string;route:string;operatorId:OperatorId;deviceId:string;onClose:()=>void;onSave:(close:ReturnType<typeof createDayClose>)=>Promise<void>}){
 const daily=buildReport(data,date,{route:route||undefined});
 const [count,setCount]=useState('');let difference=null;try{difference=toMinor(count)-daily.expectedCash}catch{}
 return <Modal title="Cash reconciliation" subtitle={formatDate(date)} onClose={onClose}>{daily.originalClose?<div className="modal-body"><ReportLine label="Original expected cash" amount={daily.originalClose.snapshot.expectedCash}/><ReportLine label="Physical cash counted" amount={daily.physicalCash}/><ReportLine label="Revised expected cash" amount={daily.expectedCash}/><ReportLine label="Current difference" amount={daily.difference}/></div>:<ActionForm label="Save original close" action={async f=>{const countedCash=toMinor(count);const nonce=JSON.stringify([date,route,'']);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nonce));const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');await onSave(createDayClose(data,{id,date,operatorId,deviceId,createdAt:new Date().toISOString(),countedCash,...(route?{route}:{}),note:String(f.get('note')||'').trim()}))}}><ReportLine label="Expected cash" amount={daily.expectedCash}/><Field label="Physical cash counted (Rs.)"><input inputMode="decimal" required value={count} onChange={e=>setCount(e.target.value)}/></Field><ReportLine label="Difference" amount={difference}/><Field label="Note (optional)"><textarea name="note" maxLength={500}/></Field><p className="muted">Other devices may still have unsynced entries. This close preserves the figures shown here.</p></ActionForm>}</Modal>
}

function Correction({invoice,onClose,onSave}:{invoice:InvoiceView;onClose:()=>void;onSave:(total:number,cash:number,reason:string)=>Promise<void>}){
 const [totalStr,setTotalStr]=useState((invoice.total/100).toFixed(2));
 const [cashStr,setCashStr]=useState((invoice.cash/100).toFixed(2));
 const [reasonStr,setReasonStr]=useState('');
 
 let parsedTotal=invoice.total;
 let parsedCash=invoice.cash;
 let calcError='';
 try{parsedTotal=toMinor(totalStr)}catch{calcError='Invalid total'}
 try{parsedCash=toMinor(cashStr)}catch{calcError='Invalid cash'}

 const revisedCredit=(!calcError&&parsedTotal>=parsedCash+invoice.chequeTotal)?(parsedTotal-parsedCash-invoice.chequeTotal):null;
 const cashDiff=!calcError?(parsedCash-invoice.cash):0;

 return <Modal title="Edit / correct invoice" subtitle={`${invoice.reference} · Current balance: ${money(invoice.credit)} credit`} onClose={onClose}>
  <ActionForm label="Save correction" action={async f=>{
   const t=toMinor(totalStr);
   const c=toMinor(cashStr);
   const r=reasonStr.trim()||String(f.get('reason')).trim();
   if(!r)throw new Error('Please enter a reason for the correction.');
   await onSave(t,c,r);
  }}>
   <div className="correction-summary">
    <div><span>Recorded total</span><b>{money(invoice.total)}</b></div>
    <div><span>Recorded cash</span><b>{money(invoice.cash)}</b></div>
    {invoice.chequeTotal>0&&<div><span>Cheques</span><b>{money(invoice.chequeTotal)}</b></div>}
    <div><span>Current credit</span><b>{money(invoice.credit)}</b></div>
   </div>
   <div className="field-grid">
    <Field label="Revised invoice total (Rs.)"><input name="total" inputMode="decimal" value={totalStr} onChange={e=>setTotalStr(e.target.value)} required/></Field>
    <Field label="Revised cash collected (Rs.)"><input name="cash" inputMode="decimal" value={cashStr} onChange={e=>setCashStr(e.target.value)} required/></Field>
   </div>
   <div className="correction-preview">
    <div><span>Revised credit to collect: </span><b>{revisedCredit!==null?money(revisedCredit):'—'}</b></div>
    <div><span>Cash reconciliation change: </span><b className={cashDiff>0?'green':cashDiff<0?'red':''}>{cashDiff>0?`+${money(cashDiff)}`:cashDiff<0?`-${money(Math.abs(cashDiff))}`:'No change'}</b></div>
   </div>
   <Field label="Reason for correction"><textarea name="reason" value={reasonStr} onChange={e=>setReasonStr(e.target.value)} required maxLength={500} placeholder="e.g. Typo in invoice total, customer gave Rs. 2,000 cash instead of Rs. 1,000"/></Field>
   <div className="quick-reasons">
    <span>Quick suggestions:</span>
    {['Typo in invoice total','Typo in cash collected','Customer paid different cash amount','Price adjustment'].map(preset=><button key={preset} type="button" className="chip-btn" onClick={()=>setReasonStr(preset)}>{preset}</button>)}
   </div>
   <p className="muted" style={{fontSize:'0.8rem',marginTop:'4px'}}>Recording a correction preserves the original entry for audit transparency while updating the shop’s credit balance and today’s cash reconciliation.</p>
  </ActionForm>
 </Modal>
}

function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function exportCSV(data:LedgerData,date:string,route:string,agency:string){
 const r=buildReport(data,date,{route:route||undefined});
 const rows=[['Saman Indika Ledger',agency],['Date',date],['Route',route||'All routes'],...(r.salesTotalTooLow?[['Review','Daily sales total is below the recorded invoice value. Figures use recorded invoices.']]:[]),['Metric','LKR'],...([[r.dailySales&&!r.salesTotalTooLow?'Total sales':'Recorded invoice value',r.invoiceValue],['New credit',r.newCredit],['Cash from sales',r.cashFromInvoices],['Cheques from sales',r.salesCheques],['Balance collections cash',r.cashFromCollections],['Expected cash',r.expectedCash],['Counted cash',r.physicalCash],['Difference',r.difference],['Cheques received',r.chequesReceived],['Cheques deposited',r.chequesDeposited],['Cheques cleared',r.chequesCleared],['Cheques returned',r.chequesReturned],['Original expected cash',r.originalClose?.snapshot.expectedCash??null]] as const).map(([k,n])=>[k,n===null?'':(n/100).toFixed(2)]),[],['Correction date','Operator','Invoice ID','Reason'],...r.corrections.map(e=>[e.date,e.operatorId,e.targetId,e.reason])];
 const quote=(s:string)=>'"'+(/^[=+@\t\r\n]|^-(?!\d+(?:\.\d+)?$)/.test(s)?"'":'')+s.replace(/"/g,'""')+'"';
 download(new Blob(['\ufeff',rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),`si-ledger-${date}.csv`)
}

function SettingsPage({settings,updateSettings,mode,identity,onMode,onEnroll,onLock,localPhotos,onPhotoChange,notify,operator,onInstall,onClearAll,onResetDemo,queue,onRetrySync,onDismissQueueItem}:{settings:typeof defaultSettings;updateSettings:(s:typeof defaultSettings)=>void;mode:Mode;identity:{uid:string}|null;onMode:(m:Mode)=>void;onEnroll:()=>void;onLock:()=>void;localPhotos:PhotoRecord[];onPhotoChange:()=>void;notify:(s:string)=>void;operator:OperatorId;onInstall:()=>void;onClearAll:()=>Promise<void>;onResetDemo:()=>Promise<void>;queue?:import('./store').PendingOperation[];onRetrySync?:()=>void;onDismissQueueItem?:(id:string)=>Promise<void>}){
 const [pinOpen,setPinOpen]=useState(false);const [addPhoneOpen,setAddPhoneOpen]=useState(false);const [busy,setBusy]=useState(false);
 async function doPhoto(action:()=>Promise<void>){setBusy(true);try{await action();onPhotoChange()}catch(e){notify((e as Error).message)}finally{setBusy(false)}}
 return <div className="settings-grid"><section className="panel settings-card"><h2>Agency settings</h2><ActionForm label="Save settings" action={async f=>{updateSettings({agency:String(f.get('agency')).trim()||defaultSettings.agency,me:String(f.get('me')).trim()||'Me',brother:settings.brother,lockMinutes:Number(f.get('lock'))});notify('Settings saved on this device.')}}><Field label="Agency name"><input name="agency" defaultValue={settings.agency} required maxLength={100}/></Field><Field label="Owner name"><input name="me" defaultValue={settings.me} required maxLength={40}/></Field><Field label="Auto-lock after inactivity"><select name="lock" defaultValue={settings.lockMinutes}>{[1,3,5,10,15].map(m=><option key={m} value={m}>{m} minutes</option>)}</select></Field></ActionForm></section>
 <section className="panel settings-card"><h2>Trusted device</h2><p>{mode==='demo'?'Demo workspace · sample records':identity?'This device is enrolled':'Device enrolment required'}</p><p className="muted">Your Owner PIN unlocks the ledger on this device.</p><div className="shop-actions">{mode==='live'&&identity&&<button className="button primary" onClick={()=>setAddPhoneOpen(true)}><Smartphone size={16}/>Add a phone with Owner PIN</button>}<button className="button secondary" onClick={onLock}><LockKeyhole size={16}/>Lock ledger</button><button className="button secondary" onClick={()=>setPinOpen(true)}>Change PIN</button><button className="button ghost" onClick={onInstall}>Install app</button>{mode==='demo'?<><button className="button ghost" onClick={onEnroll}>Set up agency</button>{identity&&<button className="button ghost" onClick={()=>onMode('live')}>Open live workspace</button>}</>:<button className="button ghost" onClick={()=>onMode('demo')}>Open demo workspace</button>}</div></section>
 {Boolean(queue&&queue.length>0)&&<section className="panel settings-card"><h2>Sync queue &amp; pending entries</h2><p>{queue!.length} item{queue!.length>1?'s':''} in queue</p><div className="queue-list" style={{display:'flex',flexDirection:'column',gap:'8px',margin:'10px 0'}}>{queue!.map(q=><div key={q.id} className="queue-item" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px',background:'rgba(0,0,0,0.03)',borderRadius:'6px'}}><div className="queue-item-info"><b>{q.kind}</b>{q.error&&<span className="error-text" style={{fontSize:'0.82rem',color:'var(--red, #b91c1c)'}}> · {q.error}</span>}<br/><small style={{opacity:0.7}}>Attempts: {q.attempts}</small></div><div className="queue-item-actions">{onDismissQueueItem&&<button type="button" className="button ghost small-action-button" onClick={()=>onDismissQueueItem(q.id)}>Dismiss</button>}</div></div>)}</div><div className="shop-actions" style={{marginTop:'10px'}}>{onRetrySync&&<button type="button" className="button secondary" onClick={onRetrySync}><RefreshCw size={15}/>Retry sync now</button>}</div></section>}
 <section className="panel settings-card"><h2>Photo backups</h2><p>{localPhotos.length} originals on this device · {localPhotos.filter(p=>!p.backedUpAt).length} need a ZIP backup</p><p className="muted">Save the ZIP somewhere safe. Restore it on another device to view linked photos there.</p><div className="shop-actions"><button className="button secondary" disabled={busy||!localPhotos.length} onClick={()=>doPhoto(async()=>{download(await exportPhotos(mode),`si-ledger-${mode}-photos-${businessDate()}.zip`);notify('ZIP generated. Check that the download was saved.')})}><Download size={16}/>Export ZIP</button><label className="button secondary file-button"><Upload size={16}/>Restore ZIP<input type="file" accept=".zip,application/zip" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void doPhoto(async()=>{const result=await restorePhotos(file,mode);notify(`Restored ${result.restored} photos · ${result.skipped} already present.`)})}}/></label></div></section>
 <section className="panel settings-card"><h2>Data management</h2><p>{mode==='demo'?'Clear all records to start with an empty ledger, or restore sample demo entries.':'Clear all cached ledger records and photos from this device.'}</p><div className="shop-actions"><button className="button secondary red" onClick={async()=>{if(confirm('Clear all data from this device? All shops, invoices, and photos in this workspace will be deleted.'))await onClearAll();}}>Clear all data</button>{mode==='demo'&&<button className="button ghost" onClick={onResetDemo}>Reload demo sample data</button>}</div></section>
 {addPhoneOpen&&<AddPhone profile={operator} onClose={()=>setAddPhoneOpen(false)}/>}
 {pinOpen&&<Modal title="Change personal PIN" onClose={()=>setPinOpen(false)}><ActionForm label="Save PIN" action={async f=>{if(f.get('next')!==f.get('confirm'))throw new Error('The PINs do not match.');if(hasPin(mode,operator))await changePin(mode,operator,String(f.get('old')),String(f.get('next')));else await setPin(mode,operator,String(f.get('next')));setPinOpen(false);notify('Personal PIN saved.')}}>{(hasPin(mode,operator)?[['old','Current PIN']]:[]).concat([['next','New PIN'],['confirm','Confirm new PIN']]).map(([key,label])=><Field key={key} label={label}><input name={key} type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/></Field>)}</ActionForm></Modal>}</div>
}
