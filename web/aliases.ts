import { fileURLToPath } from 'node:url';

/** The import names of the shared code, for Vite and Vitest alike (tsconfig.json "paths" says the same). */
const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
export const aliases = [
  { find: /^@isle\/ui$/, replacement: at('./packages/ui/src/index.ts') },
  { find: /^@isle\/ui\/(.*)$/, replacement: at('./packages/ui/src/$1') },
  { find: /^@isle\/api$/, replacement: at('./packages/api/src/index.ts') },
  { find: /^@panel\/(.*)$/, replacement: at('./apps/panel/src/$1') },
];
