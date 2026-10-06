import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { aliases } from '../../aliases';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * The admin panel in React. Built into bridge/public/next/, served by the bridge at /next/ beside
 * the panel before React (/) until every page is moved. Few files on purpose: the proxy in front
 * refused many requests at once (503, AGENTS.md "mutation icons").
 */
export default defineConfig({
  root: at('.'),
  base: '/next/',
  plugins: [react()],
  resolve: { alias: aliases },
  build: {
    outDir: at('../../../bridge/public/next'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { entryFileNames: 'assets/panel-[hash].js', assetFileNames: 'assets/panel-[hash][extname]' } },
  },
  // npm run dev:panel: the bridge on this machine (or an SSH tunnel to the VPS on 8080) answers /api.
  server: {
    port: 5180,
    proxy: Object.fromEntries(['/api', '/img', '/auth', '/login', '/ui-select.js', '/ui-inputs.js', '/mut-icons.js']
      .map((p) => [p, 'http://127.0.0.1:8080'])),
  },
});
