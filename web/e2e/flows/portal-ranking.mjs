// Bảng Xếp Hạng in React (/next/#ranking) against the site before React (/#ranking), on the local portal,
// run with LIVE_COOKIE (Live Tester's lives) and PANEL_COOKIE as REX_COOKIE (Rex: 1 kill), and a guest.
// Each tab clicked on both sites; what it shows (times that run on folded) and the items' classes compared.
import { SEEN } from './launcher-stub.mjs';

const REX = process.env.REX_COOKIE ?? '';
const AS_REX = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${REX}; path=/';`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;
const TABS = ['kills', 'playtime', 'longestLife', 'hunters', 'lives'];
const STEPS = `
  const out = {};
  // Times that run on while the flows go (play time, life length) are folded.
  const norm = (s) => s.replace(/\\d+g \\d+p|\\d+p \\d+s/g, '…').replace(/\\s+/g, ' ').trim();
  await h.until(() => h.$('#ranking-list') && !h.$('#ranking-list').textContent.includes('Đang tải'), 8000);
  for (const t of ${JSON.stringify(TABS)}) {
    h.click('.ranking-tab-btn[data-rtab=' + t + ']');
    await h.sleep(300);
    out[t] = [norm(h.$('#ranking-list').innerText), h.$('#ranking-list').className, h.$$('#ranking-list > li').map((li) => li.className).join(' / '),
      h.$('.ranking-tab-btn.active')?.dataset.rtab, h.$$('#ranking-list .rank-fx').map((e) => e.className).join(' / ')];
  }`;
const check = (key) => `${STEPS}
  const old = JSON.parse(localStorage.getItem('${key}') ?? '{}');
  for (const t of ${JSON.stringify(TABS)}) check('same as before React: ' + t, JSON.stringify(out[t]) === JSON.stringify(old[t]), { new: out[t], old: old[t] });`;
const saveIt = (key) => `${STEPS} localStorage.setItem('${key}', JSON.stringify(out)); check('read', true, out);`;

export default [
  { name: 'before React: ranking (Live Tester)', old: true, path: '/#ranking', init: SEEN, wait: 3500, run: saveIt('e2e.old.rank') },
  { name: 'ranking in React (Live Tester) = before React', path: '/next/#ranking', init: SEEN,
    run: check('e2e.old.rank') },
  { name: 'before React: ranking (Rex)', old: true, path: '/#ranking', init: AS_REX, wait: 3500, run: saveIt('e2e.old.rank.rex') },
  { name: 'ranking in React (Rex) = before React', path: '/next/#ranking', init: AS_REX,
    run: `${check('e2e.old.rank.rex')}
      h.click('.ranking-tab-btn[data-rtab=kills]'); await h.sleep(200);
      check('#1 with its crown and the apex look', h.$('#ranking-list > li')?.className === 'leaderboard-item tier-apex rank-top rank-1' && h.$('#ranking-list .tag.tier-apex')?.textContent === '👑 Top 1');` },
  { name: 'before React: ranking (a guest)', old: true, path: '/#ranking', init: AS_GUEST, wait: 3500, run: saveIt('e2e.old.rank.guest') },
  { name: 'ranking in React (a guest) = before React', path: '/next/#ranking', init: AS_GUEST, run: check('e2e.old.rank.guest') },
];
