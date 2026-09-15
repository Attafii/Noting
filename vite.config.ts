import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { vercelApiBridge } from './dev-api';

export default defineConfig({
  plugins: [
    react(),
    TanStackRouterVite(),
    // Dev only (apply: 'serve'): runs the Vercel functions locally.
    vercelApiBridge(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'noting',
        short_name: 'noting',
        description: 'noting — a quiet place for loud thoughts',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // App shell offline-first; API always goes to network (freshness wins,
        // offline note edits are queued in localStorage by the editor).
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: { cacheName: 'app-shell' },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Stable vendor chunks: repeat visits re-download only app code.
        manualChunks: {
          tanstack: ['@tanstack/react-router', '@tanstack/react-query'],
          motion: ['motion/react'],
        },
      },
    },
  },
});
