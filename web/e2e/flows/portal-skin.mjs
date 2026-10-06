// Skin Studio in React (/next/#skin) against the site before React (/#skin), on the local portal (e2e/local-portal.sh),
// run with LIVE_COOKIE (also in the env, for the lab flows): "Live Tester" in game with a skin (live-feed.mjs; it answers a skin command as DinoGarage would:
// odd tries refused, even ones written, then a new "skin" event). The same steps on both sites, each result saved from
// the old page and checked on the new one; Rex (REX_COOKIE, not in game) and a guest; last, lab (effects, kept colours).
// Not compared: the species menu and the preview's note. With no 3D model (local-portal.sh's empty list) the old page
// leaves its menu empty and says nothing; the React page says so ("-", "Chưa có mô hình 3D…", the colours side by side).
import { SEEN } from './launcher-stub.mjs';
import { same, save } from './compare.mjs';

const REX = process.env.REX_COOKIE ?? '';
const LIVE = process.env.LIVE_COOKIE ?? '';
const AS_REX = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${REX}; path=/';`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;
// Back to Live Tester (the guest flows dropped the cookie), in lab.
const LAB = `${SEEN} if (location.protocol === 'http:') { localStorage.setItem('xg.lab', '1'); document.cookie = 'isle_session=${LIVE}; path=/'; }`;

// A code made on the site before React (preset "Đại dương", pattern 2, theme 4, variation 9).
const CODE = 'XG1.eyJwIjoyLCJ0Ijo0LCJ2Ijo5LCJjIjp7IkJvZHkiOiIyZDVmN2EiLCJGbGFuayI6IjFmNDQ1OSIsIlVuZGVyYmVsbHkiOiJhOWM3Y2YiLCJNYXJraW5ncyI6IjBmMjYzMyIsIk1hbGVEaXNwbGF5IjoiMDBjMmQxIiwiRGV0YWlsMSI6IjE3Mzg0OCIsIkV5ZXMiOiI0ZGUxZmYiLCJUZWV0aCI6ImU2ZWVmMCIsIk1vdXRoIjoiN2E5YWEzIiwiQ2xhd3MiOiIxNDI0MmMifX0';

const COMMON = `
  const out = {};
  const txt = (s) => (h.$(s)?.innerText ?? '').replace(/\\s+/g, ' ').trim();
  const REG = ['Body', 'Flank', 'Underbelly', 'Markings', 'MaleDisplay', 'Detail1', 'Eyes', 'Teeth', 'Mouth', 'Claws'];
  const hexes = () => REG.map((r) => h.$('#hex-' + r).value).join(' ');
  const flat = () => h.$$('#skin-flat > div').map((d) => d.style.background).join(' ');
  const ctl = () => [h.$('#skin-pattern').value, h.$('#skin-theme').value, txt('#skin-variation-val')].join('/');
  const status = () => [txt('#skin-status'), h.$('#skin-status').className, h.$('#skin-status').hidden];
  localStorage.removeItem('xg.skins.v1');
  await h.until(() => h.$('#hex-Body')?.value, 8000);`;

// In game: load the dino's colours, palettes, typed hex, controls, code out / in, sex, saved skins, apply.
const STEPS = `${COMMON}
  await h.until(() => !h.$('#skin-active-swatches-box').hidden && txt('#skin-active-swatches').includes('#957c59'), 15000);
  out.start = [hexes(), flat(), ctl(), txt('#skin-active-swatches'), status()];
  h.click('#btn-load-my-skin');
  await h.sleep(200);
  out.loaded = [hexes(), ctl(), status()];
  h.click('[data-preset="8"]');
  await h.sleep(150);
  out.preset = [hexes(), flat(), h.$$('#skin-presets-bar .se-preset.on').map((b) => b.dataset.preset).join(',')];
  h.type('#hex-Body', '#12345');
  await h.sleep(100);
  out.halfHex = [h.$('#hex-Body').className.includes('bad'), hexes()];
  h.type('#hex-Body', '#123456');
  await h.sleep(150);
  out.typedHex = [hexes(), flat()];
  h.type('#hex-Flank', 'zzzzzz');
  await h.sleep(100);
  out.badHex = h.$('#hex-Flank').className.includes('bad');
  h.$('#hex-Flank').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  h.$('#hex-Flank').dispatchEvent(new FocusEvent('blur'));
  await h.sleep(150);
  out.blurHex = [h.$('#hex-Flank').value, h.$('#hex-Flank').className.includes('bad')];
  h.typeNum('#skin-pattern', '2');
  h.typeNum('#skin-theme', '7');
  h.type('#skin-variation', '12');
  await h.sleep(150);
  out.controls = ctl();
  h.click('#btn-skin-export');
  await h.sleep(300);
  out.code = h.$('#skin-code').value;
  h.type('#skin-code', 'not a code');
  h.click('#btn-skin-import');
  await h.sleep(100);
  out.badCode = status();
  h.type('#skin-code', '${CODE}');
  h.click('#btn-skin-import');
  await h.sleep(150);
  out.goodCode = [hexes(), ctl(), status()];
  h.click('[data-g="f"]');
  await h.sleep(100);
  out.female = [h.$$('#skin-gender button').map((b) => b.getAttribute('aria-checked') + ':' + b.className).join(' '),
    h.$('#skin-regions-grid [data-region="MaleDisplay"]').className.includes('off')];
  h.click('[data-g="m"]');
  await h.sleep(100);
  out.male = h.$('#skin-regions-grid [data-region="MaleDisplay"]').className.includes('off');
  out.savedNone = txt('#skin-saved-list');
  h.type('#skin-save-name', 'Thử một');
  h.click('#btn-skin-save');
  await h.sleep(150);
  h.click('[data-preset="0"]');
  await h.sleep(100);
  h.type('#skin-save-name', 'Thử hai');
  h.click('#btn-skin-save');
  await h.sleep(150);
  h.type('#skin-save-name', 'Thử một');
  h.click('#btn-skin-save');
  await h.sleep(150);
  out.saved = [txt('#skin-saved-list'), h.$$('#skin-saved-list .saved-stripe').map((s) => [...s.children].map((i) => i.style.background).join(',')).join(' | '),
    h.$('#skin-save-name').value, JSON.parse(localStorage.getItem('xg.skins.v1')).map((x) => x.name + ':' + x.code).join(' ')];
  h.click('[data-preset="5"]');
  await h.sleep(100);
  h.click('#skin-saved-list [data-load="1"]');
  await h.sleep(150);
  out.loadSaved = [hexes(), ctl()];
  h.click('#skin-saved-list [data-del="0"]');
  await h.sleep(150);
  out.delSaved = [txt('#skin-saved-list'), JSON.parse(localStorage.getItem('xg.skins.v1')).length];
  h.click('#skin-saved-list [data-del="0"]');
  await h.sleep(150);
  out.delAll = txt('#skin-saved-list');
  // Apply: the first try refused in game, the second written (a command every 4 s at most).
  h.click('#btn-skin-apply');
  await h.until(() => txt('#skin-status').startsWith('❌'), 15000);
  out.refused = status();
  await h.sleep(4200);
  h.click('#btn-skin-apply');
  await h.until(() => txt('#skin-status').startsWith('✅'), 15000);
  out.applied = [status(), h.$('#btn-skin-apply').disabled];
  await h.until(() => txt('#skin-active-swatches') !== out.start[3], 5000).catch(() => null);
  out.swatchesAfter = txt('#skin-active-swatches');`;
const KEYS = ['start', 'loaded', 'preset', 'halfHex', 'typedHex', 'badHex', 'blurHex', 'controls', 'code', 'badCode', 'goodCode', 'female', 'male',
  'savedNone', 'saved', 'loadSaved', 'delSaved', 'delAll', 'refused', 'applied', 'swatchesAfter'];

// Not in game (Rex) or a guest: what shows, and what the two buttons answer.
const OUTSIDE = `${COMMON}
  out.start = [hexes(), flat(), ctl(), h.$('#skin-active-swatches-box').hidden, txt('#skin-saved-list')];
  h.click('#btn-load-my-skin');
  await h.sleep(150);
  out.load = status();
  h.click('#btn-skin-apply');
  await h.sleep(150);
  out.apply = status();`;
const OUT_KEYS = ['start', 'load', 'apply'];
const PARTS = ['.card-title', '.card-subtitle', '#skin-flat', '#skin-regions-grid', '.skin-presets', '.skin-code', '.skin-saved', '#btn-skin-apply@disabled',
  '#skin-active-swatches-box@hidden', '.skin-fx@hidden', '.skin-keep@hidden', '#skin-gender'];

// Lab: effects in the code and the body, "keep" on, the kept colours' chip and its ✕.
const LAB_STEPS = `${COMMON}
  out.labShown = [!!h.$('.skin-fx').getClientRects().length, !!h.$('.skin-keep').getClientRects().length, h.$('#skin-keep').checked,
    h.$('#skin-fx-grid').className, h.$('#skin-fx-on').checked];
  h.type('#fx-Mud', '50');
  await h.sleep(150);
  out.fx = [h.$('#skin-fx-on').checked, h.$('#skin-fx-grid').className, txt('#fx-Mud-val'), txt('#skin-fx-grid')];
  h.click('#btn-skin-export');
  await h.sleep(300);
  out.code = h.$('#skin-code').value;
  h.click('#skin-fx-on');
  await h.sleep(100);
  out.fxOff = [h.$('#skin-fx-on').checked, h.$('#skin-fx-grid').className];
  h.click('#skin-fx-on');
  for (let i = 0; i < 2 && !txt('#skin-status').startsWith('✅'); i++) {
    await h.sleep(4200);
    // The send shows first ("Đang gửi…"; React redraws after the click), then an answer.
    const before = txt('#skin-status');
    h.click('#btn-skin-apply');
    await h.until(() => txt('#skin-status') !== before, 5000);
    await h.until(() => /^(❌|✅|Chậm lại|Không gửi được|Chưa thấy|Mất kết nối|Vào game)/.test(txt('#skin-status')), 15000);
  }
  out.applied = status();
  await h.until(() => h.$('#skin-kept .kept-chip'), 10000);
  out.kept = [txt('#skin-kept'), h.$('#skin-kept').hidden, h.$$('#skin-kept .kept-chip i').length];
  h.click('#skin-kept [data-forget]');
  await h.until(() => !h.$('#skin-kept .kept-chip'), 8000);
  out.forgot = status();
  // The next /api/me no longer lists it: the line goes too.
  await h.until(() => h.$('#skin-kept').hidden, 8000);
  out.keptGone = txt('#skin-kept');`;
const LAB_KEYS = ['labShown', 'fx', 'code', 'fxOff', 'applied', 'kept', 'forgot', 'keptGone'];

const compare = (key, keys) => `{
  const old = JSON.parse(localStorage.getItem('${key}') ?? '{}');
  for (const k of ${JSON.stringify(keys)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] }); }`;

export default [
  {
    name: 'before React: Skin Studio, in game: load, palettes, hex, controls, code, sex, saved, apply',
    old: true, path: '/#skin', init: SEEN, wait: 3500,
    run: `${STEPS} localStorage.setItem('e2e.old.skin', JSON.stringify(out)); check('done', true, out);`,
  },
  {
    name: 'Skin Studio in React, in game: the same steps, the same results',
    path: '/next/#skin', init: SEEN,
    run: `${STEPS} ${compare('e2e.old.skin', KEYS)}
      check('no 3D model: the colours side by side, the species menu says so', !h.$('#skin-flat').hidden && h.$('#skin-3d').hidden
        && txt('#skin-preview-note') === 'Chưa có mô hình 3D trên server, xem màu theo từng ô.', txt('#skin-preview-note'));
      check('the swatches follow the colours just written', out.swatchesAfter.startsWith('Thân: #3f5a36'), out.swatchesAfter);
      check('no skin-species element (skin3d.js would bind its own editor to it)', !document.getElementById('skin-species'));`,
  },
  { name: 'before React: Skin Studio, not in game (Rex)', old: true, path: '/#skin', init: AS_REX, wait: 3500,
    run: `${OUTSIDE} localStorage.setItem('e2e.old.skin.rex', JSON.stringify(out)); ${save('e2e.old.skin.rex.parts', PARTS)}` },
  { name: 'Skin Studio in React, not in game (Rex) = before React', path: '/next/#skin', init: AS_REX,
    run: `${OUTSIDE} ${compare('e2e.old.skin.rex', OUT_KEYS)} ${same('e2e.old.skin.rex.parts', PARTS)}` },
  { name: 'before React: Skin Studio, a guest', old: true, path: '/#skin', init: AS_GUEST, wait: 3500,
    run: `await h.until(() => h.$('#auth-actions a')); ${OUTSIDE} localStorage.setItem('e2e.old.skin.guest', JSON.stringify(out)); ${save('e2e.old.skin.guest.parts', PARTS)}` },
  { name: 'Skin Studio in React, a guest = before React', path: '/next/#skin', init: AS_GUEST,
    run: `await h.until(() => h.$('#auth-actions a')); ${OUTSIDE} ${compare('e2e.old.skin.guest', OUT_KEYS)} ${same('e2e.old.skin.guest.parts', PARTS)}` },
  // Last: lab stays on in this browser (xg.lab) for whatever runs after.
  { name: 'before React: Skin Studio in lab: effects, keep, the kept chip', old: true, path: '/#skin', init: LAB, wait: 3500,
    run: `${LAB_STEPS} localStorage.setItem('e2e.old.skin.lab', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Skin Studio in React, lab: the same', path: '/next/#skin', init: LAB,
    run: `${LAB_STEPS} ${compare('e2e.old.skin.lab', LAB_KEYS)}` },
];
