import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
 plugins:[react(),VitePWA({registerType:'prompt',includeAssets:['favicon.svg','icons/*.png'],manifest:{id:'/',name:'Saman Indika Ledger',short_name:'SI Ledger',description:'Daily collections, credit & cheques',theme_color:'#213b31',background_color:'#f3f0e8',display:'standalone',orientation:'any',start_url:'/',scope:'/',icons:[{src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]},workbox:{globPatterns:['**/*.{js,css,html,svg,png,woff2}'],navigateFallback:'/index.html',maximumFileSizeToCacheInBytes:4*1024*1024,cleanupOutdatedCaches:true}})],
 build:{
  chunkSizeWarningLimit:850,
  rollupOptions:{
    output:{
      manualChunks(id){
        if(id.includes('node_modules/firebase')) return 'firebase';
        if(id.includes('node_modules/lucide-react')) return 'icons';
        if(id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/idb') || id.includes('node_modules/fflate')) return 'vendor';
      }
    }
  }
 },server:{host:'0.0.0.0',allowedHosts:true}
});
