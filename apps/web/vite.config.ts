import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Which Core the dev server proxies to (DEC-029).
 *
 * A development Core defaults to 3001 so it can run alongside the operator's
 * stable one on 3000. The proxy has to follow it, or `pnpm dev` would quietly
 * point the dashboard at the stable instance — the exact confusion channel
 * isolation exists to prevent. Resolved without importing `@asterim/shared`,
 * because this file is evaluated before the workspace packages are built.
 *
 * Only `ASTERIM_CHANNEL` and `PORT` are consulted, deliberately: Vite sets
 * `NODE_ENV=development` for its own dev server, and reading it here would
 * retarget the proxy to 3001 for every existing `pnpm dev` while the Core —
 * which is not started with `NODE_ENV` set — is still on 3000.
 */
const isDevChannel = ['dev', 'development'].includes(
  (process.env.ASTERIM_CHANNEL || '').trim().toLowerCase()
);
const corePort = process.env.PORT || (isDevChannel ? '3001' : '3000');

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
      devOptions: {
        enabled: true,
        type: 'module'
      },
      manifest: {
        name: 'Asterim',
        short_name: 'Asterim',
        description: 'Local Web Dashboard for AI Coding Agents',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: `http://localhost:${corePort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${corePort}`,
        ws: true,
      },
    },
  }
});
