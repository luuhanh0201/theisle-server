// Screenshots of the React panel without a bridge: serves bridge/public (after `npm run build`),
// answers /api/* from shots-fixtures.mjs, shoots each page at 380 and 1366 px, light and dark,
// and says when a page scrolls sideways.
//   node web/scripts/shots.mjs <out dir> mods/messages world/fish ...
// Playwright: the one installed globally (cloud sessions: Chromium at /opt/pw-browsers/chromium).
// With PANEL_URL + PANEL_COOKIE (e2e/local-bridge.sh) it shoots a running bridge instead of the fixtures.
// SITE=portal (with PANEL_URL=http://127.0.0.1:8092, e2e/local-portal.sh): the player site, dark only,
// the React pages at /next/, the site before React at / (OLD=1); LAUNCHER=1 as inside the launcher.
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
const PORTAL = process.env.SITE === 'portal';
const LAUNCHER = `window.isleLauncher = { version: '2.8.0', updateGet: () => ({ phase: 'idle', current: '2.8.0' }), updateCheck() {}, updateInstall() {},
  onUpdate() {}, gameModeGet: () => ({ on: false, keep: {} }), gameModeSet() {}, onGameMode() {}, playGame() {} };`;
for (const theme of PORTAL ? ['dark'] : ['dark', 'light']) for (const w of [380, 1366]) for (const p of pages) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
  if (process.env.LAUNCHER) await ctx.addInitScript(LAUNCHER);
  // The player site's tour opens by itself on a first visit: seen already, for the shots (TOUR=1 shows it).
  if (PORTAL && !process.env.TOUR) await ctx.addInitScript(() => localStorage.setItem('isle_portal_tour_done', '1'));
  const page = await ctx.newPage();
  if (process.env.PANEL_URL) {
    await ctx.addCookies([{ name: PORTAL ? 'isle_session' : 'panel_session', value: process.env.PANEL_COOKIE ?? '', url: process.env.PANEL_URL }]);
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
  // OLD=1 (with PANEL_URL): the panel before React (/old), for the side-by-side check.
  const oldPath = PORTAL ? '/' : '/old';
  await page.goto(`${process.env.PANEL_URL ?? 'http://panel.test'}${process.env.OLD ? oldPath : '/next/'}#${p}`);
  await page.waitForTimeout(1200);
  const name = `${process.env.OLD ? 'old-' : ''}${process.env.LAUNCHER ? 'launcher-' : ''}${p.replace('/', '-')}-${w}-${theme}.png`;
  await page.screenshot({ path: join(out, name), fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) console.log('SIDEWAYS SCROLL:', name);
  await ctx.close();
}
await browser.close();
console.log(`done: ${pages.length * (PORTAL ? 2 : 4)} shots in ${out}`);
