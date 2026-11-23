import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';
import './theme.css';
registerSW({immediate:true,onOfflineReady(){window.dispatchEvent(new Event('ledger-offline-ready'));}});
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
