import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}

export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21}/></button></header>{children}</section></div>}

export function ActionForm({children,label,action}:{children:ReactNode;label:string;action:(data:FormData)=>Promise<void>}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 return <form className="action-form" onSubmit={async e=>{e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget);setBusy(true);setError('');try{await action(f)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}><div className="modal-body">{children}{error&&<p role="alert" className="error-text">{error}</p>}</div><div className="modal-footer"><button className="button primary" disabled={busy}>{busy?'Saving…':label}</button></div></form>
}
