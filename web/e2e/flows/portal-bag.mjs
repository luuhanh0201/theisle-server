// Túi đồ in React (/next/#bag) against the site before React (/#bag), on the local portal (e2e/local-portal.sh, which seeds
// one item of each kind: e2e/seed-bag.mjs), run with LIVE_COOKIE: "Live Tester" in game (a Tyrannosaurus at 35 %);
// live-feed.mjs answers each use as DinoGarage would (per kind of use, odd tries refused, even ones done; a skin the same).
// The same steps on both sites, each result saved from the old page and compared on the new one: the cards, tabs, search,
// a care item, a mutation into a slot, a ticket's pick, the tickets that cannot be used now, a skin worn, a dino box opened
// and its dino taken into the garage, a hòm rolled. Then Rex (not in game) and a guest (no bag: back home).
// One difference, a fix: before React a refusal inside the use box was wiped at once (the box redrew over it); React keeps it.
import { SEEN } from './launcher-stub.mjs';

const REX = process.env.REX_COOKIE ?? '';
const LIVE = process.env.LIVE_COOKIE ?? '';
const AS_LIVE = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${LIVE}; path=/';`;
const AS_REX = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${REX}; path=/';`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;

const HELP = `
  const out = {};
  const txt = (s) => (typeof s === 'string' ? h.$(s) : s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  const dlgOpen = () => h.$('#bag-dlg').open;
  // How many copies: each run uses some (and a hòm may add some), so counts are compared as N.
  const norm = (t) => t.replace(/×\\d+/g, '×N').replace(/\\d+ món/g, 'N món').replace(/còn \\d+ cái/g, 'còn N cái').replace(/Còn \\d+ hòm/g, 'Còn N hòm');
  const qtyOf = (name) => Number(/×(\\d+)/.exec(card(name)?.querySelector('.qty')?.innerText ?? '')?.[1] ?? 1);
  const dlg = () => norm(txt('#bag-dlg-in'));
  // Headings are upper-cased by the CSS (innerText): compared without case.
  const has = (t) => dlg().toLowerCase().includes(t.toLowerCase());
  const st = () => [txt('#bag-status'), h.$('#bag-status').className, h.$('#bag-status').hidden];
  const card = (name) => h.$$('#bag-list .bag-item').find((li) => li.querySelector('.nm b')?.innerText === name);
  const cardBtn = (name) => card(name)?.querySelector('.act button');
  const cards = () => norm(h.$$('#bag-list > li').map((li) => (li.className.startsWith('bag-sec') ? '# ' : '') + txt(li) + (li.className.includes(' off') ? ' [off]' : '')).join(' | '));
  const btns = () => h.$$('#bag-list .act button').map((b) => b.innerText.trim() + (b.disabled ? '(x)' : '')).join(',');
  const tabs = () => h.$$('#bag-filter button').map((b) => (b.className.includes('active') ? '*' : '') + txt(b)).join(' / ');
  const tab = async (k) => { h.click('#bag-filter [data-bag="' + k + '"]'); await h.sleep(150); };
  const closeDlg = async () => { h.click('#bag-dlg [data-dlg="close"]'); await h.until(() => !dlgOpen(), 3000); };
  const choose = async (btn, text) => {
    btn.click(); await h.sleep(200);
    const o = h.$$('[role=option]').find((x) => x.innerText.trim().startsWith(text));
    o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); o.click(); await h.sleep(200);
  };
  // A use sent from the box: refused first (live-feed), then done; the box closes on the second.
  const useTwice = async (sel) => {
    h.click(sel);
    // Busy while the game answers (the button off), then back.
    await h.until(() => h.$(sel)?.disabled, 3000).catch(() => null);
    await h.until(() => dlgOpen() && h.$(sel) && !h.$(sel).disabled, 25000);
    const refused = txt('#bag-dlg-status');
    await h.sleep(4200);
    h.click(sel);
    await h.until(() => !dlgOpen(), 25000);
    await h.until(() => txt('#bag-status').startsWith('✅'), 5000);
    return refused;
  };
  await h.until(() => h.$('#bag-list .bag-item'), 10000);`;

// The portal takes 12 writes a player a minute (server.ts writeLimit): each in-game run makes 11, so it waits for a
// fresh minute first (the run before, or another flow, may have used it).
const STEPS = `${HELP}
  await h.sleep(61000);
  await h.until(() => txt('#bag-dino').startsWith('Đang chơi'), 8000);
  out.start = [norm(txt('#bag-count')), tabs(), txt('#bag-dino'), cards(), btns()];
  await tab('usable'); out.usable = [tabs(), cards()];
  await tab('ticket'); out.tickets = cards();
  await tab('skin'); out.skins = cards();
  await tab('all');
  h.type('#bag-q', 'muối'); await h.sleep(150); out.search = cards();
  h.type('#bag-q', 'zzz'); await h.sleep(150); out.none = cards();
  h.type('#bag-q', ''); await h.sleep(150);
  window.__at = 'A care item';
  // A care item: the box, refused, then done (the copy leaves the bag).
  const q0 = qtyOf('Túi tăng trưởng');
  h.click(cardBtn('Túi tăng trưởng'));
  await h.until(() => dlgOpen() && has('Tăng trưởng'), 5000);
  out.growthBox = dlg();
  out.growthRefused = await useTwice('#bag-dlg [data-dlg="apply"]');
  await h.until(() => qtyOf('Túi tăng trưởng') === q0 - 1, 20000);
  out.growthDone = [st(), norm(txt(card('Túi tăng trưởng')))];
  window.__at = 'A mutation into';
  // A mutation into slot 1 (the only one open at 35 %).
  await h.sleep(4200);
  h.click(cardBtn('Hồi máu nhanh'));
  await h.until(() => dlgOpen() && has('Chọn ô'), 5000);
  out.mutBox = [dlg(), h.$$('#bag-dlg .slot').map((b) => (b.className.includes('on') ? '*' : '') + (b.disabled ? 'x' : '')).join(',')];
  out.mutRefused = await useTwice('#bag-dlg [data-dlg="place"]');
  out.mutDone = st();
  window.__at = 'A ticket';
  // A ticket: pick a mutation, then the slot.
  await h.sleep(4200);
  h.click(cardBtn('Phiếu đổi mutation'));
  await h.until(() => dlgOpen() && has('1. Chọn mutation'), 5000);
  out.ticketBox = [h.$('#bag-dlg [data-dlg="place"]').disabled, txt('#bag-dlg .sec:last-of-type .cmp')];
  h.click(h.$$('#bag-dlg [data-dlg-pick]').find((b) => b.dataset.dlgPick === 'Advanced Gestation'));
  await h.sleep(150);
  out.ticketPicked = [h.$$('#bag-dlg .tk-pick.on').map((b) => b.dataset.dlgPick).join(), txt(h.$$('#bag-dlg .sec')[1]), h.$('#bag-dlg [data-dlg="place"]').disabled];
  out.ticketRefused = await useTwice('#bag-dlg [data-dlg="place"]');
  out.ticketDone = st();
  window.__at = 'The tickets that';
  // The tickets that cannot be used now: clear (no mutation in a slot), prime (not 100 %).
  h.click(cardBtn('Phiếu bỏ mutation'));
  await h.until(() => dlgOpen() && has('Chọn ô cần bỏ'), 5000);
  out.clearBox = [dlg(), h.$('#bag-dlg [data-dlg="clear"]').disabled];
  await closeDlg();
  h.click(cardBtn('Phiếu Prime'));
  await h.until(() => dlgOpen() && has('Lên prime'), 5000);
  out.primeBox = [dlg(), h.$('#bag-dlg [data-dlg="prime"]').disabled];
  await closeDlg();
  window.__at = 'A skin worn';
  // A skin worn (no box): refused, then done.
  await h.sleep(4200);
  h.click(cardBtn('Rex lửa'));
  await h.until(() => txt('#bag-status').startsWith('❌'), 25000);
  out.skinRefused = st();
  await h.sleep(4200);
  h.click(cardBtn('Rex lửa'));
  await h.until(() => txt('#bag-status').startsWith('✅'), 25000);
  out.skinDone = st();
  window.__at = 'A dino box';
  // A dino box (its species picked), its roll, then its dino into the garage.
  h.click(cardBtn('Hộp dino tự chọn'));
  await h.until(() => dlgOpen() && has('Chọn loài'), 5000);
  out.boxPick = [dlg(), h.$('#bag-dlg [data-dlg="open-box"]').disabled];
  await choose(h.$('#bag-dlg label.dino-slot button[aria-haspopup=listbox]'), 'Tyrannosaurus');
  out.boxPicked = h.$('#bag-dlg [data-dlg="open-box"]').disabled;
  h.click('#bag-dlg [data-dlg="open-box"]');
  await h.until(() => h.$('#bag-dlg .roll.landed'), 8000);
  out.boxLanded = dlg();
  h.click('#bag-dlg [data-dlg="use-dino"]');
  await h.until(() => dlgOpen() && h.$('#bag-dlg [data-dino-sex]'), 8000);
  out.dinoBox = [dlg(), h.$$('#bag-dlg label.dino-slot button[aria-haspopup=listbox]').map((b) => (b.disabled ? 'x:' : '') + b.innerText.trim()).join(' | ')];
  h.click('#bag-dlg [data-dino-sex="f"]');
  await h.sleep(150);
  await choose(h.$$('#bag-dlg label.dino-slot button[aria-haspopup=listbox]')[0], 'Cellular Regeneration');
  out.dinoPicked = [txt('#bag-dlg .dino-muts'), h.$$('#bag-dlg [data-dino-sex]').map((b) => b.className).join(',')];
  h.click('#bag-dlg [data-dlg="dino"]');
  await h.until(() => !dlgOpen(), 8000);
  await h.until(() => txt('#bag-status').startsWith('✅'), 5000);
  out.dinoDone = txt('#bag-status').replace(/gara ô \\S+/g, 'gara ô N');
  window.__at = 'A hòm';
  // A hòm: what it may give, the roll, the prize (drawn: only its frame compared), open another.
  h.click(cardBtn('Hòm cổ đại'));
  await h.until(() => dlgOpen() && has('Có thể nhận'), 5000);
  out.lootPool = dlg();
  h.click('#bag-dlg [data-dlg="loot-open"]');
  await h.until(() => h.$('#bag-dlg .loot-win.landed'), 12000);
  out.lootWon = [!!h.$('#bag-dlg .loot-result'), /^Bạn nhận được .+ Đã vào Túi đồ$/.test(txt('#bag-dlg .loot-result')), h.$$('#bag-dlg .loot-card').length,
    h.$('#bag-dlg .loot-card.prize')?.innerText === h.$('#bag-dlg .loot-result b')?.innerText.replace(/^\\d+ × /, '') || txt('#bag-dlg .loot-result b').includes(h.$('#bag-dlg .loot-card.prize b').innerText),
    h.$$('#bag-dlg .act button').map((b) => b.innerText.trim()).join(',')];
  h.click('#bag-dlg [data-dlg="loot-again"]');
  await h.until(() => has('Có thể nhận'), 5000);
  out.lootAgain = dlg();
  await closeDlg();
  out.end = [norm(txt('#bag-count')), tabs()];`;
const KEYS = ['start', 'usable', 'tickets', 'skins', 'search', 'none', 'growthBox', 'growthDone', 'mutBox', 'mutDone', 'ticketBox', 'ticketPicked', 'ticketDone',
  'clearBox', 'primeBox', 'skinRefused', 'skinDone', 'boxPick', 'boxPicked', 'boxLanded', 'dinoBox', 'dinoPicked', 'dinoDone', 'lootPool', 'lootWon', 'lootAgain', 'end'];

const OUTSIDE = `${HELP}
  out.start = [norm(txt('#bag-count')), tabs(), txt('#bag-dino'), cards(), btns()];
  await tab('usable'); out.usable = cards();
  h.click(cardBtn('Hộp dino ngẫu nhiên'));
  await h.until(() => dlgOpen() && has('Mở hộp ra'), 5000);
  out.randomBox = dlg();
  await closeDlg();`;

const compare = (key, keys) => `{
  const old = JSON.parse(localStorage.getItem('${key}') ?? '{}');
  for (const k of ${JSON.stringify(keys)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] }); }`;

export default [
  { name: 'before React: Túi đồ, in game: cards, tabs, uses, a dino box, a hòm', old: true, path: '/#bag', init: AS_LIVE, wait: 3500,
    run: `${STEPS} localStorage.setItem('e2e.old.bag', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Túi đồ in React, in game: the same steps, the same results', path: '/next/#bag', init: AS_LIVE,
    run: `${STEPS} ${compare('e2e.old.bag', KEYS)}
      check('a refusal stays in the use box (wiped before React)', out.growthRefused.startsWith('❌') && out.mutRefused.startsWith('❌'), [out.growthRefused, out.mutRefused]);` },
  { name: 'before React: Túi đồ, not in game (Rex)', old: true, path: '/#bag', init: AS_REX, wait: 3500,
    run: `${OUTSIDE} localStorage.setItem('e2e.old.bag.rex', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Túi đồ in React, not in game (Rex) = before React', path: '/next/#bag', init: AS_REX,
    run: `${OUTSIDE} ${compare('e2e.old.bag.rex', ['start', 'usable', 'randomBox'])}` },
  { name: 'before React: Túi đồ, a guest: back home', old: true, path: '/#bag', init: AS_GUEST, wait: 3500,
    run: `await h.until(() => h.$('#auth-actions a')); await h.sleep(500); localStorage.setItem('e2e.old.bag.guest', JSON.stringify([location.hash, !!h.$('[data-tab="bag"]:not([hidden])')?.getClientRects().length]));` },
  { name: 'Túi đồ in React, a guest = before React', path: '/next/#bag', init: AS_GUEST,
    run: `await h.until(() => h.$('#auth-actions a')); await h.sleep(500);
      const now = [location.hash, !!h.$('[data-tab="bag"]:not([hidden])')?.getClientRects().length];
      const old = JSON.parse(localStorage.getItem('e2e.old.bag.guest') ?? 'null');
      check('same as before React: guest', JSON.stringify(now) === JSON.stringify(old), { new: now, old });` },
];
