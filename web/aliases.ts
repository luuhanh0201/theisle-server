import { fileURLToPath } from 'node:url';

/** The import names of the shared code, for Vite and Vitest alike (tsconfig.json "paths" says the same). */
const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
export const aliases = [
  { find: /^@isle\/ui$/, replacement: at('./packages/ui/src/index.ts') },
  { find: /^@isle\/ui\/(.*)$/, replacement: at('./packages/ui/src/$1') },
  { find: /^@isle\/api$/, replacement: at('./packages/api/src/index.ts') },
  { find: /^@panel\/(.*)$/, replacement: at('./apps/panel/src/$1') },
  // The skin colour editor's data and colour maths, shared with the players' Skin Studio (AGENTS.md "UI").
  { find: /^@portal\/skin-editor$/, replacement: at('../portal/public/skin-editor.js') },
  // The players' map engine, shared with the launcher's big map (bigmap.js): the Bản đồ page draws with it.
  { find: /^@portal\/map$/, replacement: at('../portal/public/map.js') },
];
