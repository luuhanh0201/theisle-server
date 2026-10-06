// Screenshots of the React panel without a bridge: serves bridge/public (after `npm run build`),
// answers /api/* from shots-fixtures.mjs, shoots each page at 380 and 1366 px, light and dark,
// and says when a page scrolls sideways.
//   node web/scripts/shots.mjs <out dir> mods/messages world/fish ...
// Playwright: the one installed globally (cloud sessions: Chromium at /opt/pw-browsers/chromium).
// With PANEL_URL + PANEL_COOKIE (e2e/local-bridge.sh) it shoots a running bridge instead of the fixtures.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from './shots-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../bridge/public');
const [out, ...pages] = process.argv.slice(2);
if (!out || pages.length === 0) { console.error('usage: node web/scripts/shots.mjs <out dir> <tab/sub>...'); process.exit(1); }
let pw;
try { pw = await import('playwright'); } catch { pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
const browser = await pw.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium' });
const TYPES = { js: 'text/javascript', css: 'text/css', html: 'text/html', png: 'image/png', svg: 'image/svg+xml' };
for (const theme of ['dark', 'light']) for (const w of [380, 1366]) for (const p of pages) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
  const page = await ctx.newPage();
  if (process.env.PANEL_URL) {
    await ctx.addCookies([{ name: 'panel_session', value: process.env.PANEL_COOKIE ?? '', url: process.env.PANEL_URL }]);
  } else await page.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'panel.test') return r.abort();
    if (u.pathname.startsWith('/api/')) {
      const a = API[u.pathname];
      return a === undefined ? r.fulfill({ status: 404, json: { error: 'not in shots-fixtures.mjs' } }) : r.fulfill({ json: typeof a === 'function' ? a(u) : a });
    }
    const f = u.pathname === '/next/' ? '/next/index.html' : u.pathname;
    try { return r.fulfill({ body: await readFile(root + f), contentType: TYPES[f.split('.').pop()] ?? 'application/octet-stream' }); }
    catch { return r.fulfill({ status: 404, body: '' }); }
  });
  // OLD=1 (with PANEL_URL): the panel before React, for the side-by-side check.
  await page.goto(`${process.env.PANEL_URL ?? 'http://panel.test'}${process.env.OLD ? '/' : '/next/'}#${p}`);
  await page.waitForTimeout(1200);
  const name = `${process.env.OLD ? 'old-' : ''}${p.replace('/', '-')}-${w}-${theme}.png`;
  await page.screenshot({ path: join(out, name), fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) console.log('SIDEWAYS SCROLL:', name);
  await ctx.close();
}
await browser.close();
console.log(`done: ${pages.length * 4} shots in ${out}`);
