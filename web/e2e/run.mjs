// Functional checks of the React panel, in headless Chrome: each flow runs in the page (helpers h.*).
// Run against a LOCAL bridge (a copy of the data, no RCON): never the live one, the flows save.
//   PANEL_URL=http://127.0.0.1:8091 PANEL_COOKIE=<panel_session> node e2e/run.mjs e2e/flows/mods.mjs
// No local copy of the data at hand: sh e2e/local-bridge.sh <empty dir> starts one on fake data.
// Prints every check; exit code 1 when one fails.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
const BASE = process.env.PANEL_URL ?? 'http://127.0.0.1:8091';
const TMP = process.env.TMPDIR ?? '/tmp';
const flows = (await import(new URL(process.argv[2], `file://${process.cwd()}/`).href)).default;
const cookie = process.env.PANEL_COOKIE ?? '';
rmSync(`${TMP}/isle-e2e-chrome`, { recursive: true, force: true });
// CHROME: another Chromium (e.g. /opt/pw-browsers/chromium in a cloud session, which needs --no-sandbox).
const chrome = spawn(process.env.CHROME ?? 'google-chrome', [...(process.env.CHROME ? ['--no-sandbox'] : []), '--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${TMP}/isle-e2e-chrome`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs = null;
for (let i = 0; i < 40 && !tabs; i++) { await sleep(250); try { tabs = await (await fetch('http://127.0.0.1:9336/json')).json(); } catch {} }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 300)); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp('Network.enable'); await cdp('Runtime.enable');
await cdp('Network.setCookie', { name: 'panel_session', value: cookie, url: `${BASE}/` });
await cdp('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
const HELPERS = `window.h = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await h.sleep(100); } throw new Error('timeout: ' + fn); },
  $: (sel) => document.querySelector(sel),
  $$: (sel) => [...document.querySelectorAll(sel)],
  byText(text, sel = 'button,a,label,span,div,b,option,[role=option]') { return [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text && ![...e.children].some((c) => c.textContent.trim() === text)); },
  click(el) { if (typeof el === 'string') el = h.$(el); if (!el) throw new Error('no element'); el.click(); },
  type(el, value) { if (typeof el === 'string') el = h.$(el); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); },
  typeNum(el, value) { if (typeof el === 'string') el = h.$(el); h.type(el, value); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); },
  switchFor(text) { return [...document.querySelectorAll('input[role=switch]')].find((i) => i.closest('label')?.textContent.trim() === text); },
  async api(url) { return (await fetch(url, { cache: 'no-store' })).json(); },
  plus(labelText) { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.startsWith(labelText)); const box = document.getElementById(l.htmlFor); return box.parentElement.querySelector('[aria-label="Tăng"]'); },
  minus(labelText) { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.startsWith(labelText)); const box = document.getElementById(l.htmlFor); return box.parentElement.querySelector('[aria-label="Giảm"]'); },
  value(labelText) { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.startsWith(labelText)); return document.getElementById(l.htmlFor).value; },
};`;
let fails = 0;
for (const f of flows) {
  await cdp('Page.navigate', { url: `${BASE}${f.path}` });
  await sleep(f.wait ?? 2500);
  await cdp('Runtime.evaluate', { expression: HELPERS });
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { const out = []; const check = (name, ok, got) => out.push([name, !!ok, got === undefined ? '' : JSON.stringify(got)]); try { ${f.run} } catch (e) { out.push(['(error) ' + e.message, false, '']); } return JSON.stringify(out); })()`, awaitPromise: true, returnByValue: true });
  const out = JSON.parse(r.result?.result?.value ?? '[["(no result)",false,""]]');
  console.log(`\n== ${f.name}`);
  for (const [name, ok, got] of out) { if (!ok) fails++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${got && !ok ? `  -> ${got}` : ''}`); }
}
if (errs.length) { fails++; console.log(`\npage errors:\n${errs.join('\n')}`); }
console.log(`\n${fails === 0 ? 'ALL OK' : `${fails} FAILED`}`);
ws.close(); chrome.kill();
process.exit(fails === 0 ? 0 : 1);
