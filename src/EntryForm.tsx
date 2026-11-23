import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Camera, Check, CheckCircle2, ImagePlus, Plus, RotateCcw, Search, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { businessDate, deriveLedger, parseLocationInput, validateAndAppend, type LedgerData, type LedgerEvent, type OperatorId, type Shop } from './domain';
import { savePhoto } from './photos';

type Mode = 'demo' | 'live';
type PhotoDraft = { id: string; file: File };
type ChequeDraft = { id: string; bank: string; number: string; amount: string; date: string; photos: PhotoDraft[] };
export type EntryFormProps = {
  kind: 'invoice' | 'collection'; data: LedgerData; operatorId: OperatorId; deviceId: string; mode: Mode;
  initialShopId?: string; onSave: (event: LedgerEvent) => Promise<void>; onSaveShop: (shop: Shop) => Promise<void>; onClose: () => void;
};
const uid = () => crypto.randomUUID();
function minor(value: string): number {
  if (!value.trim()) return 0;
  const raw = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(raw)) throw new Error('Enter amounts with no more than two decimal places.');
  const [whole, fraction = ''] = raw.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > 99_999_999_999) throw new Error('That amount is too large. Please check it.');
  return amount;
}
function quietMinor(value: string) { try { return minor(value); } catch { return 0; } }
const rupees = (value: number) => new Intl.NumberFormat('en-LK', { minimumFractionDigits: value % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(value / 100);
const amountInput = (value: number) => (value / 100).toFixed(value % 100 ? 2 : 0);

function PhotoThumb({ photo, onOpen, onRemove, onRetake }: { photo: PhotoDraft; onOpen: () => void; onRemove: () => void; onRetake: () => void }) {
  const url = useMemo(() => URL.createObjectURL(photo.file), [photo.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <div className="photo-thumb"><button type="button" className="photo-preview" onClick={onOpen} aria-label={`Zoom ${photo.file.name}`}><img src={url} alt="Receipt photograph" /></button><div className="photo-actions"><button type="button" className="icon-button" onClick={onRetake} aria-label="Retake photo"><RotateCcw size={16} /></button><button type="button" className="icon-button" onClick={onRemove} aria-label="Remove photo"><Trash2 size={16} /></button></div></div>;
}
function ZoomPhoto({ photo, onClose }: { photo: PhotoDraft; onClose: () => void }) {
  const url = useMemo(() => URL.createObjectURL(photo.file), [photo.file]);
  const [zoom, setZoom] = useState(1);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }; document.addEventListener('keydown', close, true); return () => document.removeEventListener('keydown', close, true); }, [onClose]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <div className="photo-lightbox" role="dialog" aria-label="Check receipt legibility" aria-modal="true" style={{ position: 'fixed', inset: 0, background: '#121d22', zIndex: 120, display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 12, color: 'white' }}><strong style={{ flex: 1 }}>Check the reference and amounts</strong><button type="button" className="icon-button" aria-label="Zoom out" onClick={() => setZoom(Math.max(1, zoom - .5))}><ZoomOut size={22}/></button><button type="button" className="icon-button" aria-label="Zoom in" onClick={() => setZoom(Math.min(4, zoom + .5))}><ZoomIn size={22}/></button><button type="button" className="icon-button" aria-label="Close photo" onClick={onClose}><X size={22}/></button></div>
    <div style={{ overflow: 'auto', flex: 1, padding: 12 }}><img src={url} alt="Receipt enlarged for legibility check" style={{ display: 'block', width: `${zoom * 100}%`, maxWidth: 'none', objectFit: 'contain', margin: 'auto' }}/></div>
  </div>;
}
function PhotoPicker({ photos, onChange, label = 'Receipt photos' }: { photos: PhotoDraft[]; onChange: (photos: PhotoDraft[]) => void; label?: string }) {
  const camera = useRef<HTMLInputElement>(null), gallery = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null), [zoomed, setZoomed] = useState<PhotoDraft | null>(null), [error, setError] = useState('');
  function add(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (!replaceId && photos.length + selected.length > 5) { setError('Add up to five photos per receipt or cheque.'); return; }
    if (selected.some(f => !( /^image\/(jpeg|png|webp|heic|heif|avif|gif)$/i.test(f.type) || ((!f.type || f.type === 'application/octet-stream') && /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(f.name))) || !f.size || f.size > 25 * 1024 * 1024)) { setError('Choose image files up to 25 MB each.'); return; }
    setError('');
    if (replaceId) { onChange(photos.map(p => p.id === replaceId ? { id: uid(), file: selected[0] } : p)); setReplaceId(null); }
    else onChange([...photos, ...selected.map(file => ({ id: uid(), file }))]);
  }
  return <div className="photo-picker"><div className="section-label">{label} <span className="muted">· optional</span></div><input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => { add(e.target.files); e.target.value = ''; }}/><input ref={gallery} type="file" accept="image/*" multiple hidden onChange={e => { add(e.target.files); e.target.value = ''; }}/>
    {photos.length > 0 && <div className="photo-strip">{photos.map(photo => <PhotoThumb key={photo.id} photo={photo} onOpen={() => setZoomed(photo)} onRemove={() => onChange(photos.filter(p => p.id !== photo.id))} onRetake={() => { setReplaceId(photo.id); camera.current?.click(); }}/>)}</div>}
    <div className="photo-buttons" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" className="button secondary" onClick={() => { setReplaceId(null); camera.current?.click(); }}><Camera size={17}/> Take photo</button><button type="button" className="button secondary" onClick={() => { setReplaceId(null); gallery.current?.click(); }}><ImagePlus size={17}/> Choose images</button></div>
    <p className="field-help">Add several photos for a long receipt. Originals stay on this device until you export a backup.</p>{error && <p role="alert" className="form-error">{error}</p>}{zoomed && <ZoomPhoto photo={zoomed} onClose={() => setZoomed(null)}/>}
  </div>;
}

export function EntryForm({ kind, data, operatorId, deviceId, mode, initialShopId, onSave, onSaveShop, onClose }: EntryFormProps) {
  const [eventId] = useState(uid), [createdAt] = useState(() => new Date().toISOString()), [date, setDate] = useState(() => businessDate()), [shopId, setShopId] = useState(initialShopId || '');
  const [query, setQuery] = useState(''), [showShops, setShowShops] = useState(!initialShopId), [quickShop, setQuickShop] = useState(false);
  const [shopName, setShopName] = useState(''), [shopOwner, setShopOwner] = useState(''), [shopPhone, setShopPhone] = useState(''), [shopVillage, setShopVillage] = useState(''), [shopRoute, setShopRoute] = useState(''), [shopLocation, setShopLocation] = useState(''), [shopBusy, setShopBusy] = useState(false);
  const [reference, setReference] = useState(''), [total, setTotal] = useState(''), [cash, setCash] = useState(''), [dueDate, setDueDate] = useState('');
  const [cheques, setCheques] = useState<ChequeDraft[]>([]), [photos, setPhotos] = useState<PhotoDraft[]>([]), [legible, setLegible] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submitting = useRef(false), formRef = useRef<HTMLFormElement>(null);
  const ledger = useMemo(() => deriveLedger(data), [data]);
  const shop = data.shops.find(s => s.id === shopId);
  const shops = useMemo(() => data.shops.filter(s => [s.name, s.phone, s.village, s.route].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0, 8), [data.shops, query]);
  const outstanding = ledger.invoices.filter(i => i.shopId === shopId && i.credit > 0).sort((a, b) => a.date.localeCompare(b.date));
  const invoiceMinor = quietMinor(total), cashMinor = quietMinor(cash), chequeMinor = cheques.reduce((sum, cheque) => sum + quietMinor(cheque.amount), 0);
  const paymentMinor = cashMinor + chequeMinor, creditMinor = invoiceMinor - paymentMinor;
  const outstandingMinor = outstanding.reduce((sum, invoice) => sum + invoice.credit, 0);
  const allocatedMinor = Object.values(allocations).reduce((sum, amount) => sum + quietMinor(amount), 0);
  const duplicate = reference.trim() && data.events.some(event => event.kind === 'invoice' && event.reference.trim().toLowerCase() === reference.trim().toLowerCase());
  const hasImages = photos.length > 0;

  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>('input:not([type=hidden]):not([hidden])')?.focus(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, []);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting.current) onClose(); }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [onClose]);
  function chooseShop(id: string) { setShopId(id); setShowShops(false); setAllocations({}); setError(''); }
  function updateCheque(id: string, patch: Partial<ChequeDraft>) { setCheques(current => current.map(c => c.id === id ? { ...c, ...patch } : c)); }
  function allocateOldest() {
    let remaining = paymentMinor;
    const next: Record<string, string> = {};
    for (const invoice of outstanding.slice(0, 10)) { const assigned = Math.min(invoice.credit, remaining); if (assigned > 0) next[invoice.id] = amountInput(assigned); remaining -= assigned; }
    setAllocations(next);
  }
  async function createShop() {
    if (!shopName.trim()) { setError('Enter the shop name.'); return; }
    setShopBusy(true); setError('');
    try {
      const loc = parseLocationInput(shopLocation);
      const now = new Date().toISOString();
      const next: Shop = {
        id: uid(),
        name: shopName.trim(),
        contact: shopOwner.trim(),
        phone: shopPhone.trim(),
        village: shopVillage.trim(),
        route: shopRoute.trim(),
        notes: '',
        ...(loc ? { latitude: loc.latitude, longitude: loc.longitude } : {}),
        createdAt: now,
        updatedAt: now
      };
      await onSaveShop(next); chooseShop(next.id); setQuickShop(false); setQuery('');
    } catch (e) { setError(e instanceof Error ? e.message : 'The shop could not be saved. Please try again.'); } finally { setShopBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    try {
      if (!shopId) throw new Error('Choose a shop before saving.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose the entry date.');
      const cashAmount = minor(cash), totalAmount = minor(total);
      const chequeInputs = cheques.map(c => {
        if (!c.bank.trim() || !c.number.trim() || !c.date) throw new Error('Complete the bank, cheque number, amount and cheque date for every cheque.');
        const amount = minor(c.amount); if (amount <= 0) throw new Error('Every cheque amount must be greater than zero.');
        return { id: c.id, bank: c.bank.trim(), number: c.number.trim(), amount, date: c.date, photoIds: c.photos.map(p => p.id) };
      });
      const chequesAmount = chequeInputs.reduce((sum, c) => sum + c.amount, 0);
      if (hasImages && !legible) throw new Error('Please check the photos and confirm that the invoice is readable.');
      const base = { id: eventId, date, createdAt, operatorId, deviceId, shopId };
      let entry: LedgerEvent;
      if (kind === 'invoice') {
        if (!reference.trim()) throw new Error('Enter the Lakmee invoice reference.');
        if (duplicate) throw new Error('That invoice reference is already recorded. Check the existing entry before continuing.');
        if (totalAmount <= 0) throw new Error('The invoice total must be greater than zero.');
        if (cashAmount + chequesAmount > totalAmount) throw new Error('Cash and cheques cannot exceed the invoice total.');
        if (totalAmount > cashAmount + chequesAmount && !dueDate) throw new Error('Choose a due date for the remaining credit.');
        entry = { ...base, kind: 'invoice', reference: reference.trim(), total: totalAmount, cash: cashAmount, cheques: chequeInputs, ...(dueDate ? { dueDate } : {}), photoIds: photos.map(p => p.id) };
      } else {
        if (cashAmount + chequesAmount <= 0) throw new Error('Enter the cash or cheque amount received.');
        const selected = outstanding.map(i => ({ invoice: i, amount: minor(allocations[i.id] || '') })).filter(x => x.amount > 0);
        if (selected.some(x => x.amount > x.invoice.credit)) throw new Error('An allocation is greater than that invoice’s outstanding balance.');
        if (selected.length > 10) throw new Error('Allocate to up to ten invoices per collection.');
        const allocated = selected.reduce((sum, x) => sum + x.amount, 0);
        if (allocated !== cashAmount + chequesAmount) throw new Error('Allocate the full collection to outstanding invoices. You can use “Allocate oldest first”.');
        let cashRemaining = cashAmount;
        const chequeRemaining = chequeInputs.map(c => ({ chequeId: c.id, amount: c.amount }));
        const linked = selected.map(({ invoice, amount }) => {
          const allocatedCash = Math.min(amount, cashRemaining); cashRemaining -= allocatedCash; let remaining = amount - allocatedCash;
          const chequeAmounts: { chequeId: string; amount: number }[] = [];
          for (const c of chequeRemaining) { const assigned = Math.min(remaining, c.amount); if (assigned > 0) chequeAmounts.push({ chequeId: c.chequeId, amount: assigned }); c.amount -= assigned; remaining -= assigned; }
          return { invoiceId: invoice.id, cash: allocatedCash, chequeAmounts };
        });
        entry = { ...base, kind: 'collection', cash: cashAmount, cheques: chequeInputs, allocations: linked, photoIds: [] };
      }
      validateAndAppend(data, entry);
      submitting.current = true; setBusy(true);
      for (const p of photos) await savePhoto(p.file, { mode, ownerType: 'invoice', ownerId: eventId, deviceId, id: p.id });
      for (const cheque of cheques) for (const p of cheque.photos) await savePhoto(p.file, { mode, ownerType: 'cheque', ownerId: cheque.id, deviceId, id: p.id });
      await onSave(entry); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'This entry could not be saved. Your form is still here; please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <div className="modal-backdrop"><form ref={formRef} className="modal entry-modal" onKeyDown={event => { if (event.key !== 'Tab') return; const targets = Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(el => el.getClientRects().length > 0); const first = targets[0], last = targets.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="entry-title" style={{ display: 'flex', flexDirection: 'column', maxHeight: '100dvh' }}>
    <header className="modal-header"><div><span className="eyebrow">{kind === 'invoice' ? 'NEW DELIVERY' : 'BALANCE COLLECTION'}</span><h2 id="entry-title">{kind === 'invoice' ? 'Record invoice' : 'Collect old balance'}</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close entry"><X size={22}/></button></header>
    <div className="modal-body" style={{ overflowY: 'auto', minHeight: 0 }}>
      <section className="entry-section"><div className="section-label">Shop</div>{shop && !showShops ? <div className="selected-shop"><div><strong>{shop.name}</strong><p className="muted">{[shop.village, shop.route].filter(Boolean).join(' · ') || shop.phone || 'Shop selected'}</p></div><button type="button" className="button ghost" onClick={() => setShowShops(true)}>Change</button></div> : <><div className="search-field"><Search size={18}/><input aria-label="Search shops" autoComplete="off" placeholder="Shop, phone, village or route" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="shop-options">{shops.map(s => <button type="button" key={s.id} onClick={() => chooseShop(s.id)} className="shop-option"><span><strong>{s.name}</strong><small>{[s.village, s.route, s.phone].filter(Boolean).join(' · ')}</small></span>{shopId === s.id && <Check size={18}/>}</button>)}{!shops.length && <p className="muted">No shops match this search.</p>}</div><button type="button" className="button ghost" onClick={() => { setQuickShop(!quickShop); if (query && !shopName) setShopName(query); }}><Plus size={17}/> Add a new shop</button></>}
      {quickShop && <div className="quick-shop"><h3>New shop</h3><div className="field-grid"><label className="field">Shop name<input value={shopName} onChange={e => setShopName(e.target.value)} autoComplete="organization"/></label><label className="field">Owner / contact<input value={shopOwner} onChange={e => setShopOwner(e.target.value)}/></label><label className="field">Phone<input type="tel" value={shopPhone} onChange={e => setShopPhone(e.target.value)}/></label><label className="field">Village<input value={shopVillage} onChange={e => setShopVillage(e.target.value)}/></label><label className="field">Route<input value={shopRoute} onChange={e => setShopRoute(e.target.value)}/></label><label className="field">Google Maps link or coordinates<input value={shopLocation} onChange={e => setShopLocation(e.target.value)} placeholder="e.g. https://www.google.com/maps/search/?api=1&query=8.0108287,81.0740409 or 8.0108287, 81.0740409"/></label></div><p className="field-help">You can add a storefront photo and notes from the shop ledger.</p><div style={{ display: 'flex', gap: 8 }}><button className="button primary" type="button" onClick={createShop} disabled={shopBusy}>{shopBusy ? 'Saving shop…' : 'Save shop'}</button><button className="button ghost" type="button" onClick={() => setQuickShop(false)}>Cancel</button></div></div>}
      </section>
      <section className="entry-section"><div className="field-grid"><label className="field">{kind === 'invoice' ? 'Invoice date' : 'Collection date'}<input type="date" value={date} onChange={e => setDate(e.target.value)} required/></label>{kind === 'invoice' && <label className="field">Lakmee invoice reference<input autoComplete="off" value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. LK-1042" required/></label>}</div>
      {duplicate && <div className="notice error" role="alert">This invoice reference is already recorded. Check the shop ledger to avoid a duplicate.</div>}
      {kind === 'invoice' ? <label className="field amount-field">Invoice total <span className="input-prefix"><span>Rs.</span><input aria-label="Invoice total" inputMode="decimal" placeholder="0.00" value={total} onChange={e => setTotal(e.target.value)} required/></span></label> : <div className="collection-balance"><span>Credit outstanding</span><strong>Rs. {rupees(outstandingMinor)}</strong></div>}
      </section>
      {kind === 'invoice' && <section className="entry-section"><PhotoPicker photos={photos} onChange={next => { setPhotos(next); setLegible(false); }}/>{hasImages ? <label className="check-field"><input type="checkbox" checked={legible} onChange={e => setLegible(e.target.checked)}/><span>I can read the invoice reference and all amounts.</span></label> : <div className="notice amber"><Camera size={17}/><span>You can save now. This invoice will show “Photo needed”.</span></div>}</section>}
      <section className="entry-section"><div className="section-heading"><h3>Payment received</h3>{kind === 'invoice' && <div className="segmented"><button type="button" onClick={() => { setCash(total); setCheques([]); }} className={invoiceMinor > 0 && cashMinor === invoiceMinor && !cheques.length ? 'active' : ''}>All cash</button><button type="button" onClick={() => { setCash(''); setCheques([]); }} className={cashMinor === 0 && !cheques.length ? 'active' : ''}>On credit</button></div>}</div>
      <label className="field">Cash received<span className="input-prefix"><span>Rs.</span><input inputMode="decimal" aria-label="Cash received" value={cash} onChange={e => setCash(e.target.value)} placeholder="0.00"/></span></label>
      {cheques.map((cheque, index) => <div className="cheque-form" key={cheque.id}><div className="section-heading"><strong>Cheque {index + 1}</strong><button type="button" className="icon-button" aria-label={`Remove cheque ${index + 1}`} onClick={() => setCheques(cheques.filter(c => c.id !== cheque.id))}><Trash2 size={17}/></button></div><div className="field-grid"><label className="field">Bank<input value={cheque.bank} onChange={e => updateCheque(cheque.id, { bank: e.target.value })} placeholder="Bank name" required/></label><label className="field">Cheque number<input inputMode="numeric" value={cheque.number} onChange={e => updateCheque(cheque.id, { number: e.target.value })} required/></label><label className="field">Amount (Rs.)<input inputMode="decimal" value={cheque.amount} onChange={e => updateCheque(cheque.id, { amount: e.target.value })} placeholder="0.00" required/></label><label className="field">Cheque date<input type="date" value={cheque.date} onChange={e => updateCheque(cheque.id, { date: e.target.value })} required/></label></div><PhotoPicker label="Cheque photo" photos={cheque.photos} onChange={next => updateCheque(cheque.id, { photos: next })}/></div>)}
      <button type="button" className="button secondary" disabled={cheques.length >= 5} onClick={() => setCheques([...cheques, { id: uid(), bank: '', number: '', amount: '', date, photos: [] }])}><Plus size={17}/> Add cheque</button>
      {kind === 'invoice' && creditMinor > 0 && <label className="field" style={{ marginTop: 20 }}>Credit due date<input type="date" value={dueDate} min={date} onChange={e => setDueDate(e.target.value)} required/><span className="field-help">Rs. {rupees(creditMinor)} remains on credit.</span></label>}
      {kind === 'invoice' && creditMinor < 0 && <div className="notice error">Payment exceeds the invoice by Rs. {rupees(-creditMinor)}.</div>}
      </section>
      {kind === 'collection' && <section className="entry-section"><div className="section-heading"><h3>Allocate to invoices</h3><button type="button" className="button ghost" onClick={allocateOldest} disabled={paymentMinor <= 0 || !outstanding.length}>Allocate oldest first</button></div><p className="field-help">This records a payment against credit. It does not add a new invoice.</p>{outstanding.map(invoice => <div className="allocation-row" key={invoice.id}><label className="check-field"><input type="checkbox" checked={invoice.id in allocations} onChange={e => setAllocations(current => { const next = { ...current }; if (e.target.checked) next[invoice.id] = amountInput(Math.min(invoice.credit, Math.max(0, paymentMinor - allocatedMinor))); else delete next[invoice.id]; return next; })}/><span><strong>{invoice.reference}</strong><small>Rs. {rupees(invoice.credit)} outstanding · {invoice.date}</small></span></label>{invoice.id in allocations && <label className="field allocation-amount"><span>Allocate (Rs.)</span><input inputMode="decimal" aria-label={`Allocate to ${invoice.reference}`} value={allocations[invoice.id]} onChange={e => setAllocations({ ...allocations, [invoice.id]: e.target.value })}/></label>}</div>)}{shopId && !outstanding.length && <div className="notice">This shop has no outstanding credit.</div>}<p className={allocatedMinor !== paymentMinor ? 'allocation-note amber-text' : 'allocation-note'}>Rs. {rupees(allocatedMinor)} allocated of Rs. {rupees(paymentMinor)} received</p></section>}
      <div className="entry-summary"><div><span>{kind === 'invoice' ? 'Invoice total' : 'Collection total'}</span><strong>Rs. {rupees(kind === 'invoice' ? invoiceMinor : paymentMinor)}</strong></div><div><span>Cash</span><strong>Rs. {rupees(cashMinor)}</strong></div><div><span>Pending cheques</span><strong>Rs. {rupees(chequeMinor)}</strong></div><div className="summary-total"><span>{kind === 'invoice' ? 'Remaining credit' : 'Shop credit after collection'}</span><strong>Rs. {rupees(kind === 'invoice' ? creditMinor : outstandingMinor - paymentMinor)}</strong></div></div>
      {error && <div className="notice error" role="alert" style={{ marginTop: 16 }}>{error}</div>}
    </div>
    <footer className="modal-footer" style={{ flexShrink: 0 }}><p className="field-help">{mode === 'demo' ? 'Demo entry · separate from your agency' : 'Saved on this phone first; syncs when connected'}</p><button className="button primary" type="submit" disabled={busy || shopBusy} style={{ width: '100%' }}>{busy ? 'Saving entry…' : <><CheckCircle2 size={18}/> {kind === 'invoice' ? 'Save invoice' : 'Save collection'}</>}</button></footer>
  </form></div>;
}
