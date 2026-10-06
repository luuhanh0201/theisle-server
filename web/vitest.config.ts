import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { aliases } from './aliases';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}'],
  },
});
