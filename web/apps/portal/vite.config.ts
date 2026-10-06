import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { aliases } from '../../aliases';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * The player site in React. Built into portal/public/next/, served by the portal server at /next/
 * beside the site before React (/) until every page is moved (web/PORTAL-MIGRATION.md). No inline
 * script in the build: the portal's CSP allows script files only.
 */
export default defineConfig({
  root: at('.'),
  base: '/next/',
  plugins: [react()],
  resolve: { alias: aliases },
  build: {
    outDir: at('../../../portal/public/next'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    modulePreload: { polyfill: false },
    rollupOptions: { output: { entryFileNames: 'assets/portal-[hash].js', assetFileNames: 'assets/portal-[hash][extname]' } },
  },
  // npm run dev:portal: the portal on this machine (8090) answers /api, /auth and its files.
  server: {
    port: 5181,
    fs: { allow: [at('../..'), at('../../../portal/public')] },
    proxy: Object.fromEntries(['/api', '/auth', '/img', '/tai', '/tai.html', '/amber.svg', '/mut-icons.js', '/ui-select.js', '/ui-inputs.js', '/map', '/dino3d', '/vendor']
      .map((p) => [p, 'http://127.0.0.1:8090'])),
  },
});
