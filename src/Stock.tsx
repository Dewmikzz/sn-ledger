import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, Package, Pencil, Plus, Search } from 'lucide-react';
import { money, newId } from './domain';
import { ActionForm, Field, Modal } from './forms';
import { MAX_PACKAGE_SIZE, MAX_STOCK, stockDetails, stockMovementLabels, stockNumber, stockUnits, stockValue, type StockItem, type StockMovement, type StockMovementKind } from './inventory';
import { saveStockItem, saveStockMovement, watchStock, watchStockHistory } from './stockStore';
import type { LedgerMode } from './store';

type StockView = { type: 'details'; id: string } | { type: 'edit'; item?: StockItem } | { type: 'movement'; item: StockItem; kind: StockMovementKind };

function labelPackaging(item: StockItem) {
  return [item.unitsPerPack ? `${item.unitsPerPack} units/pack` : '', item.unitsPerBox ? `${item.unitsPerBox} units/box` : ''].filter(Boolean).join(' · ');
}

function EditItem({ mode, item, onClose, onSave }: { mode: LedgerMode; item?: StockItem; onClose: () => void; onSave: (id: string) => void }) {
  const [id] = useState(() => item?.id ?? newId());
  return <Modal title={item ? 'Edit item' : 'Add stock item'} onClose={onClose}>
    <ActionForm label={item ? 'Save item' : 'Add item'} action={async form => {
      await saveStockItem(mode, id, stockDetails(form), item?.revision);
      onSave(id);
    }}>
      <div className="field-grid">
        <Field label="Item name"><input name="name" defaultValue={item?.name} maxLength={120} required /></Field>
        <Field label="Item code / SKU (optional)"><input name="sku" defaultValue={item?.sku} maxLength={60} /></Field>
        <Field label="Units per pack (optional)"><input name="unitsPerPack" type="number" min="1" max={MAX_PACKAGE_SIZE} step="1" defaultValue={item?.unitsPerPack || undefined} /></Field>
        <Field label="Units per box (optional)"><input name="unitsPerBox" type="number" min="1" max={MAX_PACKAGE_SIZE} step="1" defaultValue={item?.unitsPerBox || undefined} /></Field>
        <Field label="Stock cost per unit (Rs.)"><input name="costPrice" inputMode="decimal" defaultValue={item ? (item.costPrice / 100).toFixed(2) : undefined} required /></Field>
        <Field label="Selling price per unit (Rs.)"><input name="sellingPrice" inputMode="decimal" defaultValue={item ? (item.sellingPrice / 100).toFixed(2) : undefined} required /></Field>
      </div>
      <p className="field-help">Use the number of individual units inside each pack or box. Both prices are for one individual unit.</p>
    </ActionForm>
  </Modal>;
}

function MovementForm({ mode, item, kind, onClose, onSave }: { mode: LedgerMode; item: StockItem; kind: StockMovementKind; onClose: () => void; onSave: () => void }) {
  const [id] = useState(newId);
  const [counts, setCounts] = useState({ loose: '', packs: '', boxes: '' });
  const fields = [
    { name: 'loose', label: 'Loose units' },
    ...(item.unitsPerPack ? [{ name: 'packs', label: `Packs (${item.unitsPerPack} units each)` }] : []),
    ...(item.unitsPerBox ? [{ name: 'boxes', label: `Boxes (${item.unitsPerBox} units each)` }] : []),
  ] as { name: keyof typeof counts; label: string }[];
  let preview = '—';
  try {
    if (Object.values(counts).some(value => value !== '')) {
      const units = stockUnits(item, { loose: stockNumber(counts.loose, 'loose units'), packs: stockNumber(counts.packs, 'packs'), boxes: stockNumber(counts.boxes, 'boxes') });
      preview = `${units.toLocaleString()} units`;
    }
  } catch { /* Validation is shown on submission. */ }
  return <Modal title={stockMovementLabels[kind]} subtitle={item.name} onClose={onClose}>
    <ActionForm label={`Save ${stockMovementLabels[kind].toLowerCase()}`} action={async form => {
      if (!Object.values(counts).some(value => value !== '')) throw new Error('Enter the quantity. For a stock count of zero, enter 0.');
      await saveStockMovement(mode, item, id, {
        kind,
        loose: stockNumber(form.get('loose'), 'loose units'),
        packs: stockNumber(form.get('packs'), 'packs'),
        boxes: stockNumber(form.get('boxes'), 'boxes'),
        note: String(form.get('note') ?? '').trim(),
      });
      onSave();
    }}>
      <p className="field-help">{kind === 'count' ? 'Enter the full quantity you counted, including loose units and sealed packs or boxes.' : `Current stock is ${item.quantity.toLocaleString()} units. Enter the quantity to record.`}</p>
      <div className="field-grid">{fields.map(field => <Field key={field.name} label={field.label}>
        <input name={field.name} type="number" min="0" max={MAX_STOCK} step="1" placeholder="0" value={counts[field.name]} onChange={event => setCounts({ ...counts, [field.name]: event.target.value })} />
      </Field>)}</div>
      <div className="stock-conversion"><span>Equivalent quantity</span><strong>{preview}</strong></div>
      <Field label="Note (optional)"><textarea name="note" maxLength={300} rows={2} /></Field>
    </ActionForm>
  </Modal>;
}

function ItemDetails({ item, mode, writable, onMove, onEdit, onClose }: { item: StockItem; mode: LedgerMode; writable: boolean; onMove: (kind: StockMovementKind) => void; onEdit: () => void; onClose: () => void }) {
  const [history, setHistory] = useState<(StockMovement & { recordedAt: string })[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => watchStockHistory(mode, item.id, setHistory, problem => setError(problem.message)), [mode, item.id]);
  return <Modal title={item.name} subtitle={[item.sku, labelPackaging(item)].filter(Boolean).join(' · ')} onClose={onClose} wide>
    <div className="modal-body">
      <div className="stock-detail-metrics">
        <div><span>On hand</span><strong>{item.quantity.toLocaleString()} units</strong></div>
        <div><span>Stock cost / unit</span><strong>{money(item.costPrice)}</strong></div>
        <div><span>Selling price / unit</span><strong>{money(item.sellingPrice)}</strong></div>
      </div>
      <div className="stock-actions">
        <button type="button" className="button primary" disabled={!writable} onClick={() => onMove('in')}><ArrowDownToLine size={16}/>Stock in</button>
        <button type="button" className="button secondary" disabled={!writable} onClick={() => onMove('out')}><ArrowUpFromLine size={16}/>Stock out</button>
        <button type="button" className="button secondary" disabled={!writable} onClick={() => onMove('count')}><ClipboardCheck size={16}/>Stock count</button>
        <button type="button" className="button ghost" disabled={!writable} onClick={onEdit}><Pencil size={16}/>Edit item</button>
      </div>
      <h3>Recent stock movements</h3>
      {error ? <p role="alert" className="error-text">{error}</p> : history === null ? <p className="muted">Loading movements…</p> : history.length ? <ul className="stock-history">
        {history.map(move => <li key={move.id}><div><strong>{stockMovementLabels[move.kind]}</strong><p>{move.recordedAt ? new Date(move.recordedAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' }) : ''}{move.note && ` · ${move.note}`}</p></div><div><strong>{move.kind === 'in' ? '+' : move.kind === 'out' ? '−' : 'Counted '}{move.units.toLocaleString()} units</strong><p>Balance {move.after.toLocaleString()} units</p></div></li>)}
      </ul> : <p className="muted">No movements recorded yet.</p>}
    </div>
  </Modal>;
}

export function Stock({ mode, online, notify }: { mode: LedgerMode; online: boolean; notify: (message: string) => void }) {
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<StockView | null>(null);
  const writable = mode === 'demo' || online;
  useEffect(() => watchStock(mode, data => { setItems(data); setError(''); }, problem => setError(problem.message)), [mode]);
  const all = items ?? [];
  const query = search.trim().toLowerCase();
  const filtered = all.filter(item => `${item.name} ${item.sku}`.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
  const selected = all.find(item => item.id === (view?.type === 'details' ? view.id : undefined));
  function showDetails(id: string) { setView({ type: 'details', id }); }
  return <>
    {!writable && <p className="notice amber">Reconnect to view current inventory and record stock changes.</p>}
    <div className="stock-summary">
      <div className="dashboard-kpi dashboard-kpi-sales"><span><span className="dashboard-icon"><Boxes size={17}/></span>Stock items</span><strong>{items ? all.length.toLocaleString() : '—'}</strong></div>
      <div className="dashboard-kpi"><span><span className="dashboard-icon"><Package size={17}/></span>Units on hand</span><strong>{items ? all.reduce((sum, item) => sum + item.quantity, 0).toLocaleString() : '—'}</strong></div>
      <div className="dashboard-kpi"><span><span className="dashboard-icon"><ClipboardCheck size={17}/></span>Stock value at cost</span><strong>{items ? stockValue(all) : '—'}</strong></div>
    </div>
    <section className="panel stock-list">
      <div className="stock-toolbar">
        <label className="search-box"><Search size={17}/><input aria-label="Search stock" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or SKU" /></label>
        <button type="button" className="button primary" disabled={!writable} onClick={() => setView({ type: 'edit' })}><Plus size={17}/>Add item</button>
      </div>
      {error ? <p role="alert" className="stock-empty error-text">{error}</p> : items === null ? <p role="status" className="stock-empty">Loading inventory…</p> : filtered.length ? <div className="stock-table">
        <div className="stock-table-heading"><span>Item</span><span>On hand</span><span>Cost / unit</span><span>Selling / unit</span></div>
        {filtered.map(item => <button key={item.id} type="button" className="stock-item-row" onClick={() => showDetails(item.id)}>
          <span><strong>{item.name}</strong><small>{[item.sku, labelPackaging(item)].filter(Boolean).join(' · ')}</small></span>
          <span><small className="stock-mobile-label">On hand</small><strong>{item.quantity.toLocaleString()} units</strong></span>
          <span><small className="stock-mobile-label">Cost / unit</small>{money(item.costPrice)}</span>
          <span><small className="stock-mobile-label">Selling / unit</small>{money(item.sellingPrice)}</span>
        </button>)}
      </div> : <div className="stock-empty"><Package size={25}/><h3>{all.length ? 'No matching items' : 'No stock items yet'}</h3><p>{all.length ? 'Try another item name or SKU.' : 'Add an item to set its prices and pack or box quantities.'}</p></div>}
    </section>
    {view?.type === 'edit' && <EditItem mode={mode} item={view.item} onClose={() => view.item ? showDetails(view.item.id) : setView(null)} onSave={id => { showDetails(id); notify('Item saved.'); }}/>}
    {view?.type === 'movement' && <MovementForm mode={mode} item={view.item} kind={view.kind} onClose={() => showDetails(view.item.id)} onSave={() => { showDetails(view.item.id); notify('Stock updated.'); }}/>}
    {selected && <ItemDetails key={selected.id} item={selected} mode={mode} writable={writable} onClose={() => setView(null)} onEdit={() => setView({ type: 'edit', item: selected })} onMove={kind => setView({ type: 'movement', item: selected, kind })}/>}
  </>;
}
