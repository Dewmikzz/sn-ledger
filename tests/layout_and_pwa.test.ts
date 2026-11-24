import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('Responsive Layout Breakpoints (360px, 390px, 768px, 1024px, 1366px)', () => {
  const styles = readFileSync('src/styles.css', 'utf-8');
  const theme = readFileSync('src/theme.css', 'utf-8');

  it('contains dedicated breakpoints for mobile, tablet, and desktop', () => {
    // 360px and 390px use the compact two-column analytics layout.
    expect(styles).toContain('@media(max-width:650px)');
    expect(theme).toContain('.dashboard-kpis {grid-template-columns:repeat(2,minmax(0,1fr))');

    // 768px is handled by <= 900px (tablet breakpoint)
    expect(styles).toContain('@media(max-width:900px)');

    // 1024px is handled by <= 1150px (compact desktop / landscape tablet)
    expect(styles).toContain('@media(max-width:1150px)');

    // 1366px uses the primary desktop grid (> 1150px)
    expect(styles).toContain('.app-shell{display:grid;grid-template-columns:228px minmax(0,1fr)');
  });

  it('provides phone-first optimizations for 360px and 390px viewports', () => {
    // Hidden desktop chrome on phone
    expect(styles).toContain('.breadcrumb,.topbar-left>svg,.profile-name,.topbar-divider,.topbar-right .profile-control>svg');
    // 2-column stat cards instead of 4
    expect(styles).toContain('.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}');
    // Fullscreen mobile entry modal without overflow
    expect(styles).toContain('.entry-modal{width:100%;height:100dvh;max-height:100dvh;border-radius:0}');
    // Touch targets >= 44px
    expect(styles).toContain('min-height:44px');
  });

  it('provides bottom navigation and collapsible drawer for 768px tablet layout', () => {
    expect(styles).toContain('.sidebar{display:none;position:fixed;width:230px');
    expect(styles).toContain('.bottom-nav{position:fixed;bottom:0');
    expect(styles).toContain('.mobile-menu{display:inline-flex}');
  });

  it('provides compact desktop sidebar for 1024px viewport', () => {
    expect(styles).toContain('.app-shell{grid-template-columns:185px minmax(0,1fr)}');
  });

  it('provides full sidebar and multi-column dashboard for 1366px laptop layout', () => {
    expect(styles).toContain('grid-template-columns:228px minmax(0,1fr)');
    expect(styles).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
    expect(styles).toContain('grid-template-columns:minmax(0,1.9fr) minmax(250px,1fr)');
  });
});

describe('Production PWA Manifest and Offline Service Worker', () => {
  it('generates valid web app manifest for installation and offline reload', () => {
    expect(existsSync('dist/manifest.webmanifest')).toBe(true);
    const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf-8'));
    expect(manifest.id).toBe('/');
    expect(manifest.name).toBe('Saman Indika Ledger');
    expect(manifest.short_name).toBe('SI Ledger');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.theme_color).toBe('#f1f4f8');
    expect(manifest.background_color).toBe('#f1f4f8');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');

    // Verify icons exist and match sizes
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    for (const icon of manifest.icons) {
      expect(existsSync(`public/${icon.src.replace(/^\//, '')}`)).toBe(true);
    }
  });

  it('generates service worker and precache manifest for offline PWA reopening', () => {
    expect(existsSync('dist/sw.js')).toBe(true);
    const swContent = readFileSync('dist/sw.js', 'utf-8');
    expect(swContent).toContain('precacheAndRoute');
    // Ensure index.html and assets are included in precache
    expect(swContent).toContain('index.html');
  });
});

describe('Thermal and Standard Printing Styles', () => {
  const styles = readFileSync('src/styles.css', 'utf-8');
  const theme = readFileSync('src/theme.css', 'utf-8');

  it('hides interactive shell, header, footer and buttons during print', () => {
    expect(styles).toContain('@media print{body{background:white}.sidebar,.topbar,.demo-banner,.offline-banner,.page-heading,.filterbar,.report-actions,.bottom-nav,.mobile-add,.main-footer,.toast{display:none!important}');
  });

  it('configures exact 80mm (72mm printable) and 58mm (48mm printable) thermal roll widths', () => {
    expect(theme).toContain('.thermal-80 {width:72mm}');
    expect(theme).toContain(".thermal-58,html[data-ledger-print='58'] .thermal-print-source .thermal-slip {width:48mm;font-size:9pt}");
    expect(theme).toContain('@media print{');
    expect(theme).toContain('html[data-ledger-print] body>:not(.thermal-print-source) {display:none!important}');
    expect(theme).toContain('.thermal-slip {margin:0 auto;color:#000}');
  });
});

describe('App Component Rendering', () => {
  it('renders App cleanly without throwing in browser environment', async () => {
    const store = new Map<string, string>();
    const storageMock = {
      getItem: (k: string) => store.get(k) || null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear()
    };
    Object.defineProperty(globalThis, 'localStorage', { value: storageMock, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: storageMock, configurable: true, writable: true });
    const React = await import('react');
    const { renderToString } = await import('react-dom/server');
    const App = (await import('../src/App')).default;
    const html = renderToString(React.createElement(App));
    expect(html).toBeTruthy();
    expect(html).toContain('SI Ledger');
  });
});

