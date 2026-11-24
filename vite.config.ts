import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'Saman Indika Ledger',
        short_name: 'SI Ledger',
        description: 'Daily collections, credit & cheques',
        theme_color: '#f6f5fa',
        background_color: '#f6f5fa',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/ledger-mark-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/ledger-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/ledger-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1200
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true
  }
});
