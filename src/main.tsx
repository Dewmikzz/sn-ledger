import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';
import './theme.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SI Ledger unhandled error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    if (confirm('Clear local app cache and reload? Your cloud data remains safe.')) {
      localStorage.removeItem('si-mode');
      sessionStorage.clear();
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#f6f5fa',
          color: '#f3f0e8',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            maxWidth: '460px',
            background: '#ffffff',
            color: '#211f31',
            borderRadius: '20px',
            padding: '28px 24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            textAlign: 'center'
          }}>
            <h2 style={{ margin: '0 0 10px', fontSize: '1.3rem', color: '#211f31' }}>Ledger Session Recovered</h2>
            <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: '#4a5d52', lineHeight: '1.4' }}>
              The application encountered a display issue while opening.
            </p>
            {this.state.error?.message && (
              <div style={{
                background: '#fdf2f2',
                color: '#b91c1c',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                textAlign: 'left',
                margin: '0 0 16px',
                wordBreak: 'break-word',
                fontFamily: 'monospace'
              }}>
                {this.state.error.message}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  background: '#5245b2',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '10px 18px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Reload App
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  background: '#f0edff',
                  color: '#5245b2',
                  border: '1px solid #d4ded6',
                  borderRadius: '10px',
                  padding: '10px 18px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Reset Cache
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

registerSW({ immediate: true, onOfflineReady() { window.dispatchEvent(new Event('ledger-offline-ready')); } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
