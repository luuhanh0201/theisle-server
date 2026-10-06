// Bản đồ + Kết bạn in React (/next/#map) against the site before React (/#map), on the local portal, run with
// LIVE_COOKIE (Live Tester in game, 3 AI and a fish around them) and REX_COOKIE (Rex, not in game).
// Kết bạn: Live Tester finds Rex and asks, Rex accepts, Live Tester sees Rex, then ends the friendship; each
// view read on the old page first and compared on the new one. The map itself (map.js) is the same engine on
// both: its chips, its message and the picture drawn are compared too.
import { SEEN } from './launcher-stub.mjs';

const REX = process.env.REX_COOKIE ?? '';
const LIVE = process.env.LIVE_COOKIE ?? '';
const AS = (c) => `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${c}; path=/';`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;
// What the map page shows: the status, the map's chips and message, the friends card (folded white space).
const SNAP = `
  const txt = (s) => [...document.querySelectorAll(s)].map((e) => (e.getClientRects().length ? e.innerText : '')).join(' | ').replace(/\\s+/g, ' ').trim();
  // The picture, 24 x 16 grey levels, to compare roughly (the map draws the same data the same way).
  const pic = () => { const c = h.$('#map canvas'); if (!c || !c.width) return null; const t = document.createElement('canvas'); t.width = 24; t.height = 16;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0, 24, 16); return [...x.getImageData(0, 0, 24, 16).data].filter((_, i) => i % 4 === 0); };
  const snap = { status: txt('#map-status-tag'), chips: txt('#map .map-chips'), msg: txt('#map .map-msg'), note: txt('#map .map-note'),
    friends: txt('#map-friends'), badge: txt('#nav-map-badge'), pic: pic() };`;
const READY = `await h.until(() => h.$('#map .map-chips button') && h.$('#map .ai-n')?.textContent === '3', 10000); await h.sleep(2500);`;
const SAVE = (k) => `${SNAP} localStorage.setItem('${k}', JSON.stringify(snap)); check('read', true, snap);`;
const SAME = (k, skip = [], pic = true) => `${SNAP}
  check('the map picture read on both sites', ${pic} ? Boolean(snap.pic && JSON.parse(localStorage.getItem('${k}') ?? '{}').pic) : true);
  const old = JSON.parse(localStorage.getItem('${k}') ?? '{}');
  for (const key of ['status', 'chips', 'msg', 'note', 'friends', 'badge'].filter((x) => !${JSON.stringify(skip)}.includes(x)))
    check('same as before React: ' + key, JSON.stringify(snap[key]) === JSON.stringify(old[key]), { new: snap[key], old: old[key] });
  if (snap.pic && old.pic) { const d = snap.pic.reduce((s, v, i) => s + Math.abs(v - old.pic[i]), 0) / snap.pic.length;
    check('the map drawn alike (mean grey difference < 12)', d < 12, d); } else check('both maps drawn', Boolean(snap.pic) === Boolean(old.pic), [Boolean(snap.pic), Boolean(old.pic)]);`;
const SEARCH = `h.type('#fr-q', 'Rex'); await h.sleep(50); h.$('#fr-find').click();
  await h.until(() => h.$('#fr-results .fr-item'), 6000);`;

export default [
  { name: 'before React: the map, Live Tester, a search for Rex', old: true, path: '/#map', init: AS(LIVE), wait: 3500,
    run: `${READY} const i = h.$('#fr-q'); i.value = 'Rex'; h.$('#fr-find').click(); await h.until(() => h.$('#fr-results .fr-item'), 6000); ${SAVE('e2e.old.map')}` },
  { name: 'the map in React, Live Tester = before React; ask Rex', path: '/next/#map', init: AS(LIVE),
    run: `${READY} ${SEARCH} ${SAME('e2e.old.map')}
      check('AI 3, fish 1 on the chips', h.$('#map .ai-n').textContent === '3' && h.$('#map .fish-n')?.textContent === '1');
      check('in game: Dino trực tuyến', h.$('#map-status-tag').textContent === 'Dino trực tuyến' && h.$('#map-status-tag').className === 'tag');
      h.click('#fr-results [data-fr=request]');
      await h.until(() => h.$('#global-toast').textContent === '✅ Đã gửi lời mời kết bạn');
      await h.until(() => h.$('#fr-results').textContent.includes('Đã mời'));
      await h.until(() => h.$('#fr-lists').textContent.includes('Đã mời, chờ chấp nhận (1)'), 6000);
      check('asked: Đã mời, in the waiting list', true);` },
  { name: 'before React: Rex sees the request', old: true, path: '/#map', init: AS(REX), wait: 3500,
    run: `await h.until(() => h.$('#fr-lists .fr-item'), 8000); ${SAVE('e2e.old.map.rex')}` },
  { name: 'the map in React, Rex = before React; accept', path: '/next/#map', init: AS(REX),
    run: `await h.until(() => h.$('#fr-lists .fr-item'), 8000); ${SAME('e2e.old.map.rex', [], false)}
      check('the menu badge: 1 request', h.$('#nav-map-badge').textContent === '1');
      check('not in game: Chưa có vị trí', h.$('#map-status-tag').className === 'tag warning');
      h.click('#fr-lists [data-fr=accept]');
      await h.until(() => h.$('#global-toast').textContent === '✅ Đã kết bạn');
      await h.until(() => h.$('#fr-lists').textContent.includes('Live Tester') && !h.$('#fr-lists').textContent.includes('Lời mời'), 6000);
      check('friends now, Live Tester in game', h.$('#fr-lists').textContent.includes('Tyrannosaurus'));
      await h.until(() => !h.$('#nav-map-badge'), 6000);
      check('the badge gone', true);` },
  { name: 'before React: Live Tester sees Rex', old: true, path: '/#map', init: AS(LIVE), wait: 3500,
    run: `${READY} await h.until(() => h.$('#fr-lists').textContent.includes('Rex Tester'), 8000); ${SAVE('e2e.old.map.f')}` },
  { name: 'the map in React, Live Tester with a friend = before React; end it', path: '/next/#map', init: AS(LIVE),
    run: `${READY} await h.until(() => h.$('#fr-lists').textContent.includes('Rex Tester'), 8000); ${SAME('e2e.old.map.f')}
      check('Rex offline', h.$('#fr-lists').textContent.includes('Offline'));
      h.click('#fr-lists [data-fr=ask-remove]');
      await h.until(() => h.$('#fr-lists [data-fr=remove]'));
      check('a second click asked', h.$('#fr-lists [data-fr=remove]').textContent === 'Bấm lần nữa để huỷ');
      h.click('#fr-lists [data-fr=remove]');
      await h.until(() => h.$('#global-toast').textContent === 'Đã huỷ kết bạn');
      await h.until(() => h.$('#fr-lists').textContent.includes('Chưa có bạn nào'), 6000);
      check('no friend left', h.$('#fr-count').textContent === '0 bạn');` },
  { name: 'before React: the map, a guest', old: true, path: '/#map', init: AS_GUEST, wait: 3500,
    run: `await h.until(() => h.$('#auth-actions a')); ${SAVE('e2e.old.map.g')}` },
  { name: 'the map in React, a guest = before React (no map drawn)', path: '/next/#map', init: AS_GUEST,
    run: `await h.until(() => h.$('#auth-actions a')); await h.sleep(500); ${SAME('e2e.old.map.g', [], false)}
      check('no map for a guest', !h.$('#map canvas'));` },
];
