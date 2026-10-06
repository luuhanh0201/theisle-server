// Gara in React (/next/#gara) against the site before React (/#gara), on the local portal (e2e/local-portal.sh),
// run with LIVE_COOKIE: "Live Tester" in game; live-feed.mjs answers the garage's commands as DinoGarage would
// (odd stores fail "moved", even ones land in a new slot; a redeem starts). The same steps on both sites, each
// result saved from the old page and checked on the new one. REX_COOKIE (2 slots, not in game) and a guest too.
import { SEEN } from './launcher-stub.mjs';
import { same, save } from './compare.mjs';

const REX = process.env.REX_COOKIE ?? '';
const AS_REX = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${REX}; path=/';`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;

// The steps, as one script for both sites: each result into `out` (then saved or compared).
const STEPS = `
  const out = {};
  const txt = (s) => (h.$(s)?.innerText ?? '').replace(/\\s+/g, ' ').trim();
  const cards = () => h.$$('#gara-slots-list .garage-slot-card').filter((c) => c.style.display !== 'none');
  await h.until(() => h.$('#gara-store-hint') && !h.$('#gara-store-btn').disabled, 8000);
  out.start = [txt('#gara-tier'), txt('#gara-store-hint'), txt('.garage-actions .garage-store-row')];
  // 1) a store that fails in game (moved)
  h.click('#gara-store-btn');
  await h.until(() => txt('#gara-status').startsWith('⏳'), 8000);
  out.counting = [txt('#gara-status'), h.$('#gara-store-btn').disabled, /^Đang cất: còn \\d+ giây/.test(txt('#gara-store-hint'))];
  await h.until(() => txt('#gara-status').startsWith('❌'), 10000);
  out.failed = [txt('#gara-status'), h.$('#gara-status').className];
  // 2) a store that lands in a new slot (a command every 4 s at most)
  await h.sleep(4200);
  h.click('#gara-store-btn');
  await h.until(() => txt('#gara-status').startsWith('✅'), 15000);
  out.stored = [txt('#gara-status'), h.$('#gara-status').className];
  // 3) its Lấy ra (same species): the game starts restoring
  await h.until(() => h.$$('[data-redeem]').some((b) => !b.disabled), 8000);
  const slot = h.$$('[data-redeem]').find((b) => !b.disabled);
  out.card = (slot.closest('.garage-slot-card').innerText.replace(/Cất lúc: [^·\\n]+/, 'Cất lúc: …').replace(/\\s+/g, ' ').trim());
  await h.sleep(4200);
  slot.click();
  await h.until(() => txt('#gara-status').startsWith('✅ Game'), 15000);
  out.redeemed = [txt('#gara-status'), h.$('#gara-status').className];
  // 4) the filters and the cards' demo
  const n0 = cards().length;
  h.click('.gara-filter-btn[data-diet=herbivore]');
  await h.sleep(200);
  out.herbi = [cards().length, h.$('.gara-filter-btn.active')?.dataset.diet];
  h.click('.gara-filter-btn[data-diet=carnivore]');
  await h.sleep(200);
  out.carno = cards().length === n0;
  h.click('#gara-preview-btn');
  await h.until(() => txt('#gara-count-tag') === 'Demo hiệu ứng');
  out.demo = [txt('#gara-preview-btn'), h.$$('#gara-slots-list .garage-slot-card').map((c) => c.dataset.tier).join(','),
    cards().length, h.$$('[data-redeem]').every((b) => b.disabled && b.innerText.includes('Mẫu demo'))];
  h.click('.gara-filter-btn[data-diet=herbivore]');
  await h.sleep(200);
  out.demoHerbi = cards().map((c) => c.querySelector('b').innerText).join(',');
  h.type('#gara-search-input', 'deino');
  h.click('.gara-filter-btn[data-diet=all]');
  await h.sleep(200);
  out.search = cards().map((c) => c.querySelector('b').innerText).join(',');
  h.click('#gara-preview-btn');
  await h.until(() => txt('#gara-count-tag') !== 'Demo hiệu ứng');
  out.demoOff = txt('#gara-preview-btn');`;
const KEYS = ['start', 'counting', 'failed', 'stored', 'card', 'redeemed', 'herbi', 'carno', 'demo', 'demoHerbi', 'search', 'demoOff'];
const PARTS = ['#gara-tier', '#gara-count-tag', '#gara-store-btn@disabled', '#gara-store-hint', '#gara-where-box', '#gara-slots-list', '.commands-row'];

export default [
  {
    name: 'before React: Gara, in game: store fails, store, redeem, filters, demo',
    old: true, path: '/#gara', init: SEEN, wait: 3500,
    run: `${STEPS} localStorage.setItem('e2e.old.gara', JSON.stringify(out)); check('done', true, out);`,
  },
  {
    name: 'Gara in React, in game: the same steps, the same results',
    path: '/next/#gara', init: SEEN,
    run: `${STEPS}
      const old = JSON.parse(localStorage.getItem('e2e.old.gara') ?? '{}');
      for (const k of ${JSON.stringify(KEYS)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] });
      check('the new slot in the menu badge', h.$('#nav-gara-badge').textContent === String(h.$$('#gara-slots-list .garage-slot-card').length));`,
  },
  {
    name: 'Copy a chat command',
    path: '/next/#gara', init: SEEN,
    run: `await h.until(() => h.$('[data-copy="!slay"]'));
      window.prompt = (m, t) => { window.__prompted = t; };
      h.click('[data-copy="!slay"]');
      await h.until(() => window.__prompted === '!slay' || h.$('#global-toast').textContent === 'Đã sao chép: !slay');
      check('copied (or the prompt where the clipboard is refused)', true);`,
  },
  { name: 'before React: Gara, not in game (Rex, 2 slots)', old: true, path: '/#gara', init: AS_REX, wait: 3500,
    run: `await h.until(() => h.$('#gara-slots-list .garage-slot-card')); ${save('e2e.old.gara.rex', PARTS)}` },
  { name: 'Gara in React, not in game = before React', path: '/next/#gara', init: AS_REX,
    run: `await h.until(() => h.$('#gara-slots-list .garage-slot-card')); ${same('e2e.old.gara.rex', PARTS)}
      check('Lấy ra off: not in game', h.$$('[data-redeem]').every((b) => b.disabled));` },
  { name: 'before React: Gara, a guest', old: true, path: '/#gara', init: AS_GUEST, wait: 3500,
    run: `await h.until(() => h.$('#auth-actions a')); ${save('e2e.old.gara.guest', PARTS)}` },
  { name: 'Gara in React, a guest = before React', path: '/next/#gara', init: AS_GUEST,
    run: `await h.until(() => h.$('#auth-actions a')); ${same('e2e.old.gara.guest', PARTS)}` },
];
