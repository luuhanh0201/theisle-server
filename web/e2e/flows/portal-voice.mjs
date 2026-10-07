// Voice 3D in React (/next/#voice) against the site before React (/#voice), on the local portal (e2e/local-portal.sh),
// run with REX_COOKIE as PANEL_COOKIE (voice needs a login, not the game). No voice server locally: voice-stub.mjs
// stands in for LiveKit and /api/voice*, the same way on both sites. The same steps on both, each result saved from
// the old page and compared on the new one: join, the chips and notes, range (buttons and the ` key), micro modes,
// the talk key, noise filter, threshold, volume, speakers near (names, muted), out of game, a duplicate login,
// leave, a refused join, the self test, window.isleVoice. Then a guest.
import { LAUNCHER, SEEN } from './launcher-stub.mjs';
import { VOICE_STUB } from './voice-stub.mjs';

const INIT = `${SEEN} ${VOICE_STUB}`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;

const STEPS = `
  const out = {};
  const txt = (s) => (h.$(s)?.innerText ?? '').replace(/\\s+/g, ' ').trim();
  const shown = (s) => !!h.$(s) && h.$(s).getClientRects().length > 0;
  const cards = () => ['#v-login-card', '#v-join-card', '#v-range-card', '#v-mic-card', '#v-peers-card'].map((c) => c + ':' + shown(c)).join(' ');
  const pressed = (seg) => h.$$('#page-voice ' + seg + ' button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => txt('#page-voice ' + seg + ' [aria-pressed=true]')).join();
  const dot = () => { const d = h.$('#nav-voice-dot'); return d && !d.hidden ? d.className + ' / ' + d.title : null; };
  const key = (code, type = 'keydown') => document.body.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  await h.until(() => shown('#v-join-card'), 8000);
  out.start = [cards(), txt('#v-conn-chip'), txt('#v-join-note'), shown('#v-game-chip'), dot()];
  h.click('#v-join');
  await h.until(() => txt('#v-conn-chip') === '● Đã vào kênh' && txt('#v-range-note').startsWith('Người trong'), 8000);
  out.joined = [cards(), txt('#v-join-note'), txt('#v-range-note'), txt('#v-noise-note'), txt('#v-mode-help'), txt('#v-talk-text'),
    pressed('.v-seg-range'), pressed('.v-seg-mode'), pressed('.v-seg-noise'), shown('#v-thr-field'), shown('#v-ptt-field'), shown('#v-thr'),
    txt('#v-range-hint'), txt('#v-range-key-name'), shown('#v-out-field'), JSON.stringify(window.__voice.ranges), shown('#v-join'), shown('#v-leave')];
  await h.until(() => shown('#v-game-chip'), 5000);
  out.inGame = [txt('#v-game-chip'), h.$('#v-game-chip').className, dot(), txt('#v-peers-empty')];
  // Range: a button, then the key (cycles, beeps, a toast).
  h.click('#page-voice [data-range="60"]');
  await h.until(() => txt('#v-range-note').startsWith('Người trong 60'), 5000);
  out.range60 = [pressed('.v-seg-range'), txt('#v-range-note'), JSON.stringify(window.__voice.ranges)];
  key('Backquote');
  await h.until(() => txt('#v-range-note').startsWith('Người trong 90'), 5000);
  out.rangeKey = [pressed('.v-seg-range'), txt('#v-toast'), shown('#v-toast'), JSON.stringify(window.__voice.ranges)];
  // Micro: push-to-talk, its key changed, off, back to voice activation.
  h.click('#page-voice [data-mode="ptt"]');
  await h.sleep(100);
  out.ptt = [pressed('.v-seg-mode'), txt('#v-mode-help'), shown('#v-thr-field'), shown('#v-ptt-field'), shown('#v-thr'), txt('#v-ptt-key-name'), txt('#v-ptt-hint')];
  h.click('#v-ptt-key');
  await h.sleep(100);
  out.capturing = txt('#v-ptt-key-name');
  key('KeyB');
  await h.sleep(100);
  out.pttKey = [txt('#v-ptt-key-name'), txt('#v-mode-help'), JSON.parse(localStorage.getItem('isle-voice')).pttCode];
  h.click('#v-range-key');
  await h.sleep(100);
  key('Escape');
  await h.sleep(100);
  out.rangeKeyKept = txt('#v-range-key-name');
  h.click('#page-voice [data-mode="off"]');
  await h.sleep(100);
  out.off = [txt('#v-mode-help'), txt('#v-talk-text')];
  h.click('#page-voice [data-mode="vad"]');
  await h.sleep(100);
  // Noise filter, threshold, volume.
  h.click('#page-voice [data-noise="off"]');
  await h.until(() => txt('#v-noise-note').startsWith('Không lọc'), 5000);
  out.noiseOff = [pressed('.v-seg-noise'), txt('#v-noise-note')];
  h.click('#page-voice [data-noise="browser"]');
  await h.until(() => txt('#v-noise-note').startsWith('Bộ lọc có sẵn'), 5000);
  out.noiseBrowser = txt('#v-noise-note');
  h.type('#v-threshold', '-40');
  h.type('#v-master', '120');
  await h.sleep(150);
  out.levels = [h.$('#v-thr').style.left, JSON.parse(localStorage.getItem('isle-voice')).threshold, JSON.parse(localStorage.getItem('isle-voice')).master];
  // Speakers near: one speaking at the right, one quiet at the left; mute one; the server's name mode.
  window.__voice.peers = [{ id: 'p1', name: 'Rex', gain: 0.9, pan: 0.7 }, { id: 'p2', name: 'Bé Ba', gain: 0.3, pan: -0.6 }];
  window.__voice.audience = ['p2', 'p1'];
  await h.sleep(800);
  window.__room.activeSpeakers = [{ identity: 'p1' }];
  window.__room.emit('as', [{ identity: 'p1' }, { identity: 'p2' }]);
  await h.until(() => h.$$('#v-peers .v-peer').length === 2, 5000);
  window.__room.activeSpeakers = [{ identity: 'p1' }];
  await h.sleep(700);
  out.peers = [txt('#v-peers'), h.$$('#v-peers .v-peer').map((li) => li.className).join(), shown('#v-peers-empty'), JSON.stringify(window.__voice.perms)];
  h.click(h.$$('#v-peers .mute')[0]);
  await h.sleep(150);
  out.muted = [h.$$('#v-peers .mute').map((b) => b.innerText + ':' + b.getAttribute('aria-pressed')).join(), JSON.stringify(JSON.parse(localStorage.getItem('isle-voice')).people)];
  window.__voice.nameMode = 'none';
  await h.until(() => txt('#v-peers').includes('Có người đang nói'), 5000);
  out.nameNone = txt('#v-peers');
  window.__voice.inGame = false; window.__voice.peers = [];
  await h.until(() => txt('#v-game-chip').startsWith('!'), 5000);
  out.outOfGame = [txt('#v-game-chip'), txt('#v-peers-empty'), shown('#v-peers-empty'), dot()];
  // Signed in elsewhere: the room drops us.
  window.__room.emit('dc', 2);
  await h.until(() => txt('#v-conn-chip').startsWith('✕'), 5000);
  out.duplicate = [cards(), txt('#v-conn-chip'), h.$('#v-conn-chip').className, txt('#v-join-note'), dot(), shown('#v-game-chip')];
  // Join again, leave.
  window.__voice.inGame = true;
  h.click('#v-join');
  await h.until(() => txt('#v-conn-chip') === '● Đã vào kênh', 8000);
  h.click('#v-leave');
  await h.until(() => txt('#v-conn-chip') === '○ Chưa vào kênh', 5000);
  out.left = [cards(), dot(), txt('#v-noise-note'), shown('#v-game-chip')];
  // A refused join (no voice on the server).
  window.__voice.tokenStatus = 404;
  h.click('#v-join');
  await h.until(() => txt('#v-conn-chip').startsWith('✕'), 8000);
  out.refused = [cards(), txt('#v-conn-chip'), txt('#v-join-note'), h.$('#v-join').disabled];
  out.status = JSON.stringify(window.isleVoice.status());`;
const KEYS = ['start', 'joined', 'inGame', 'range60', 'rangeKey', 'ptt', 'capturing', 'pttKey', 'rangeKeyKept', 'off', 'noiseOff', 'noiseBrowser',
  'levels', 'peers', 'muted', 'nameNone', 'outOfGame', 'duplicate', 'left', 'refused', 'status'];

// In the launcher: push-to-talk by default, the launcher's key names, its global talk key, the overlay's state.
const IN_LAUNCHER = `${SEEN} ${LAUNCHER} ${VOICE_STUB} if (location.protocol === 'http:') {
  window.isleLauncher.overlayState = (st) => { window.__ov = st; };
  window.isleLauncher.onPushToTalk = (cb) => { window.__ptt = cb; };
  window.isleLauncher.onRangeKey = (cb) => { window.__rangeKey = cb; };
  window.isleLauncher.capturePttKey = async () => ({ error: 'Phím này đã dùng cho việc khác' });
}`;
const LAUNCHER_STEPS = `
  const out = {};
  const txt = (s) => (h.$(s)?.innerText ?? '').replace(/\\s+/g, ' ').trim();
  await h.until(() => h.$('#v-join')?.getClientRects().length, 8000);
  h.click('#v-join');
  await h.until(() => txt('#v-conn-chip') === '● Đã vào kênh' && window.__voice.ranges.length > 0, 8000);
  await h.sleep(800);
  out.joined = [txt('#v-join-note'), txt('#v-mode-help'), txt('#v-ptt-hint'), txt('#v-ptt-key-name'), txt('#v-range-hint'), txt('#v-talk-text')];
  window.__ptt(true);
  await h.until(() => txt('#v-talk-text') === 'Đang phát tiếng', 3000);
  out.talking = [txt('#v-talk-text'), h.$('#v-talk').className];
  window.__ptt(false);
  await h.until(() => txt('#v-talk-text') === 'Đang im lặng', 3000);
  window.__rangeKey();
  await h.until(() => window.__voice.ranges.length > 1, 3000);
  await h.sleep(300);
  out.rangeKey = [JSON.stringify(window.__voice.ranges), txt('#v-toast')];
  h.click('#v-ptt-key');
  await h.sleep(300);
  out.captureRefused = txt('#v-ptt-key-name');
  // level: how loud you talk, for the mic on the overlay's dino card (2026-10-07, after the site before React).
  const { level, ...ov } = { ...window.__ov, toast: window.__ov?.toast ? window.__ov.toast.text : null };
  out.overlay = JSON.stringify(ov);
  out.overlayLevel = level;`;
const LAUNCHER_KEYS = ['joined', 'talking', 'rangeKey', 'captureRefused', 'overlay'];

const GUEST = `
  const shown = (s) => !!h.$(s) && h.$(s).getClientRects().length > 0;
  await h.until(() => shown('#v-login-card'), 8000);
  const out = { guest: [shown('#v-login-card'), shown('#v-join-card'), h.$('#v-login-card').innerText.replace(/\\s+/g, ' ').trim(), h.$('#v-login-card a').getAttribute('href')] };`;

export default [
  {
    name: 'before React: Voice 3D, logged in: join, range, micro, speakers, dropped, leave, refused',
    old: true, path: '/#voice', init: INIT, wait: 3500,
    run: `${STEPS} localStorage.setItem('e2e.old.voice', JSON.stringify(out)); check('done', true, out);`,
  },
  {
    name: 'Voice 3D in React: the same steps, the same results',
    path: '/next/#voice', init: INIT,
    run: `${STEPS}
      const old = JSON.parse(localStorage.getItem('e2e.old.voice') ?? '{}');
      // On purpose (owner, 2026-10-07): the noise filter's default is Cơ bản, it was AI (here not runnable: its note).
      const moved = (v) => JSON.parse(JSON.stringify(v ?? null).replace('Máy này không chạy được bộ lọc AI: đang dùng bộ lọc của trình duyệt.', 'Bộ lọc có sẵn của trình duyệt: nhẹ, lọc được tiếng ồn đều (quạt, điều hoà).').replace('"Mạnh (AI)"', '"Cơ bản"'));
      for (const k of ${JSON.stringify(KEYS)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(moved(old[k])), { new: out[k], old: old[k] });`,
  },
  {
    name: 'Voice in React stays joined on another page (the menu dot, the room)',
    path: '/next/#voice', init: INIT,
    run: `await h.until(() => h.$('#v-join')?.getClientRects().length, 8000);
      h.click('#v-join');
      await h.until(() => h.$('#v-conn-chip').innerText === '● Đã vào kênh', 8000);
      location.hash = '#gara';
      await h.sleep(1200);
      check('on Gara: still in the room', window.isleVoice.status().connected === true);
      check('the menu dot says so', h.$('#nav-voice-dot')?.title === 'Voice đang hoạt động', h.$('#nav-voice-dot')?.title);
      location.hash = '#voice';
      await h.sleep(300);
      check('back on Voice: Rời kênh', h.$('#v-leave').getClientRects().length > 0);`,
  },
  { name: 'before React: Voice 3D in the launcher: talk key, range key, overlay', old: true, path: '/#voice', init: IN_LAUNCHER, wait: 3500,
    run: `${LAUNCHER_STEPS} localStorage.setItem('e2e.old.voice.launcher', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Voice 3D in React, in the launcher = before React', path: '/next/#voice', init: IN_LAUNCHER,
    run: `${LAUNCHER_STEPS} const old = JSON.parse(localStorage.getItem('e2e.old.voice.launcher') ?? '{}');
      for (const k of ${JSON.stringify(LAUNCHER_KEYS)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] });
      check('the overlay got the state', out.overlay.includes('"connected":true'), out.overlay);
      check('and how loud, for the mic on the dino card: 0 when not talking', out.overlayLevel === 0, out.overlayLevel);` },
  { name: 'before React: Voice 3D, a guest', old: true, path: '/#voice', init: AS_GUEST, wait: 3500,
    run: `${GUEST} localStorage.setItem('e2e.old.voice.guest', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Voice 3D in React, a guest = before React', path: '/next/#voice', init: AS_GUEST,
    run: `${GUEST} const old = JSON.parse(localStorage.getItem('e2e.old.voice.guest') ?? '{}');
      check('same as before React: guest', JSON.stringify(out.guest) === JSON.stringify(old.guest), { new: out.guest, old: old.guest });` },
];
