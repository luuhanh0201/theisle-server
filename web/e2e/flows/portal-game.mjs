// Dino Live in React (/next/#game) against the site before React (/#game), on the local portal
// (e2e/local-portal.sh), run with LIVE_COOKIE: "Live Tester" in game (a Tyrannosaurus at 35 %, 600/1000
// health, hunger 20 % = low, prime 3 of 10). REX_COOKIE (Rex Tester, not in game) and a guest as well.
// Tele con non: a code taken, copied, dropped; a wrong code refused with the bridge's reason, both sites.
// The cookie flows (Rex, then a guest) come last: they change the browser's login for the flows after them.
import { SEEN } from './launcher-stub.mjs';
import { same, save } from './compare.mjs';

const REX = process.env.REX_COOKIE ?? '';
const AS_REX = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${REX}; path=/';`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;
const PARTS = [
  '#game-prison', '#game-hero-card@class', '#game-dino-tier-badge', '#game-dino-tier-badge@title', '#game-live-tag',
  '#game-dino-species', '#game-dino-status', '#game-dino-growth', '#game-dino-growth@title', '#game-growth-pct', '#game-growth-fill@width',
  '#game-vitals', '#game-hero-fx .slot-tier-fx@class', '#game-3d',
  '#game-tele-card', '#tele-get@disabled', '#tele-go@disabled', '#tele-input@disabled',
  // The counts' titles (the times run on while the flows go).
  '#game-prime-content', '#game-stats-grid .muted',
];
const vitalsParts = ['health', 'stamina', 'hunger', 'thirst', 'blood', 'oxygen'].flatMap((k) => [`#game-vitals [data-v=${k}]@class`, `#game-vitals [data-v=${k}] .vital-fill@width`]);
const ALL = [...PARTS, ...vitalsParts];
const ready = `await h.until(() => h.$('#game-stats-grid')?.children.length > 0 && h.$('#game-vitals [data-v=health] .vital-val')?.textContent.includes('/'));`;

export default [
  { name: 'before React: Dino Live, in game', path: '/#game', init: SEEN, wait: 3500, run: `${ready} ${save('e2e.old.game', ALL)}` },
  {
    name: 'Dino Live in React, in game = before React',
    path: '/next/#game',
    init: SEEN,
    run: `${ready} ${same('e2e.old.game', ALL)}
      check('LIVE lit in the menu', h.$('#nav-dino-badge').classList.contains('on'));
      check('hunger low', h.$('#game-vitals [data-v=hunger]').classList.contains('low'));
      check('health 600 / 1000', h.$('#game-vitals [data-v=health] .vital-val').textContent === '600 / 1000');
      check('prime 3 / 10', h.$('#game-prime-content .prime-summary').textContent.includes('3 / 10 điều kiện đạt'));`,
  },
  {
    name: 'before React: a wrong tele code',
    path: '/#game',
    init: SEEN,
    wait: 3500,
    run: `await h.until(() => h.$('#game-tele-card') && !h.$('#game-tele-card').hidden && !h.$('#tele-go').disabled);
      const i = h.$('#tele-input'); i.value = 'ab-c1!'; i.dispatchEvent(new Event('input', { bubbles: true }));
      localStorage.setItem('e2e.old.tele.typed', i.value);
      i.value = 'ZZZZZZ'; h.$('#tele-go').click();
      await h.until(() => h.$('#tele-status').textContent.startsWith('❌'));
      localStorage.setItem('e2e.old.tele.wrong', h.$('#tele-status').textContent.trim());
      check('read', true);`,
  },
  {
    name: 'tele con non in React: typing, a wrong code, a code taken, copied, dropped',
    path: '/next/#game',
    init: SEEN,
    run: `await h.until(() => h.$('#game-tele-card') && !h.$('#game-tele-card').hidden && !h.$('#tele-go').disabled);
      h.type('#tele-input', 'ab-c1!');
      await h.until(() => h.$('#tele-input').value !== 'ab-c1!');
      check('typing: capitals, no other signs (as before React)', h.$('#tele-input').value === localStorage.getItem('e2e.old.tele.typed'), h.$('#tele-input').value);
      h.type('#tele-input', 'ZZZZZZ');
      await h.sleep(50);
      h.click('#tele-go');
      await h.until(() => h.$('#tele-status').textContent.startsWith('❌'));
      check('a wrong code: the same refusal', h.$('#tele-status').textContent.trim() === localStorage.getItem('e2e.old.tele.wrong'), h.$('#tele-status').textContent);
      check('status shown as an error', h.$('#tele-status').className === 'garage-status bad');
      await h.until(() => !h.$('#tele-get').disabled);
      check('no code yet: Lấy mã', h.$('#tele-get').textContent === 'Lấy mã' && h.$('#tele-code').hidden && h.$('#tele-drop').hidden);
      h.click('#tele-get');
      await h.until(() => h.$('#global-toast').textContent.startsWith('✅ Mã tele: '));
      const code = h.$('#global-toast').textContent.replace('✅ Mã tele: ', '');
      await h.until(() => !h.$('#tele-code').hidden);
      check('the code shown', h.$('#tele-code-text').textContent === code, code);
      check('Đổi mã, Huỷ mã', h.$('#tele-get').textContent === 'Đổi mã' && !h.$('#tele-drop').hidden);
      check('time left', /^Hết hạn sau [45]:\\d\\d · dùng được 1 lần/.test(h.$('#tele-code-meta').textContent), h.$('#tele-code-meta').textContent);
      h.click('#tele-copy');
      await h.until(() => h.$('#global-toast').textContent.includes(code) && !h.$('#global-toast').textContent.startsWith('✅'));
      check('copied (or shown where the clipboard is refused)', ['📋 Đã sao chép mã ' + code, 'Mã: ' + code].includes(h.$('#global-toast').textContent), h.$('#global-toast').textContent);
      h.type('#tele-input', code);
      await h.sleep(50);
      h.click('#tele-go');
      await h.until(() => h.$('#tele-status').textContent.includes('mã của bạn'));
      check('your own code refused', h.$('#tele-status').textContent.includes('Đây là mã của bạn'), h.$('#tele-status').textContent);
      await h.until(() => !h.$('#tele-drop').disabled);
      h.click('#tele-drop');
      await h.until(() => h.$('#tele-code').hidden && h.$('#tele-get').textContent === 'Lấy mã');
      check('dropped', h.$('#tele-drop').hidden);`,
  },
  {
    name: 'lab: the 3D box tries the model (none in a local copy: hidden, as before React)',
    path: '/next/?lab=1#game',
    init: SEEN,
    run: `${ready} await h.sleep(1500);
      check('3D box hidden without models', h.$('#game-3d').hidden);
      check('the page still works', h.$('#game-vitals [data-v=health] .vital-val').textContent === '600 / 1000');
      localStorage.removeItem('xg.lab');`,
  },
  { name: 'before React: Dino Live, logged in, not in game', path: '/#game', init: AS_REX, wait: 3500,
    run: `await h.until(() => h.$('#game-stats-grid')?.children.length > 0); ${save('e2e.old.game.rex', PARTS)}` },
  { name: 'Dino Live in React, not in game = before React', path: '/next/#game', init: AS_REX,
    run: `await h.until(() => h.$('#game-stats-grid')?.children.length > 0 && h.$('.auth-name')?.textContent.includes('Rex')); ${same('e2e.old.game.rex', PARTS)}` },
  { name: 'before React: Dino Live, a guest', path: '/#game', init: AS_GUEST, wait: 3500,
    run: `await h.until(() => h.$('#auth-actions a')); ${save('e2e.old.game.guest', PARTS)}` },
  { name: 'Dino Live in React, a guest = before React', path: '/next/#game', init: AS_GUEST,
    run: `await h.until(() => h.$('#auth-actions a')); ${same('e2e.old.game.guest', PARTS)}` },
];
