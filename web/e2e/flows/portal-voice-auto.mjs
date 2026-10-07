// The launcher remembers the voice room (lib/voice.ts, owner 2026-10-07): in the room last time, in it again by itself
// once in game; out of game, a look every 5 s; Rời phòng / Rời kênh forgets it. On the local portal (e2e/local-portal.sh),
// voice-stub.mjs standing in for LiveKit. Rex is not in game, Live Tester is (live-feed.mjs). Live Tester last: the
// cookie stays for the flows after.
import { LAUNCHER_UI, SEEN } from './launcher-stub.mjs';
import { VOICE_STUB } from './voice-stub.mjs';

const LIVE = process.env.LIVE_COOKIE ?? '';
const REMEMBERED = `if (location.protocol === 'http:') { window.__keepVoiceAuto = true; localStorage.setItem('isle-voice-auto', '1'); }`;
const HELP = `
  const txt = (s) => h.$(s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  const meCalls = () => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === '/api/me').length;`;

export default [
  {
    name: 'remembered, not in game (Rex): waits, a look every 5 s, never joins; Rời phòng forgets it',
    path: '/next/#home', init: `${REMEMBERED} ${SEEN} ${LAUNCHER_UI} ${VOICE_STUB}`,
    run: `${HELP}
      await h.until(() => txt('#lx-v-state') === '● Chờ vào game để tự vào lại', 8000);
      check('waiting for the game', true);
      check('the note says why', /tự vào lại khi bạn vào game/.test(txt('#lx-v-peers')), txt('#lx-v-peers'));
      const n0 = meCalls();
      await h.sleep(11000);
      check('not joined while out of game', !window.__room, !!window.__room);
      check('looked again (about every 5 s)', meCalls() - n0 >= 2, meCalls() - n0);
      h.click('#lx-v-leave');
      await h.until(() => txt('#lx-v-state') === '● Chưa vào phòng', 3000);
      check('Rời phòng: forgotten', localStorage.getItem('isle-voice-auto') === null);
      const n1 = meCalls();
      await h.sleep(6000);
      check('no more looks for the room', !window.__room);`,
  },
  {
    name: 'not remembered: nothing by itself',
    path: '/next/#home', init: `${SEEN} ${LAUNCHER_UI} ${VOICE_STUB}`,
    run: `${HELP}
      await h.until(() => h.$('#lx-v-join'), 8000); await h.sleep(6000);
      check('out of the room', txt('#lx-v-state') === '● Chưa vào phòng' && !window.__room, txt('#lx-v-state'));`,
  },
  {
    name: 'in a browser (no launcher): the room is never remembered',
    path: '/next/#voice', init: `${REMEMBERED} ${SEEN} ${VOICE_STUB}`,
    run: `${HELP}
      await h.until(() => h.$('#v-join') && !h.$('#v-join').hidden, 8000); await h.sleep(6000);
      check('not joined, no waiting', !window.__room && !h.$('#v-auto-cancel'));`,
  },
  {
    name: 'remembered, in game (Live Tester): in the room by itself; still remembered; Rời kênh on Voice 3D forgets it',
    path: '/next/#home', init: `${REMEMBERED} ${SEEN} ${LAUNCHER_UI} ${VOICE_STUB} if (location.protocol === 'http:') document.cookie = 'isle_session=${LIVE}; path=/';`,
    run: `${HELP}
      await h.until(() => txt('#lx-v-state') === '● Đang trực tuyến', 12000);
      check('joined by itself', !!window.__room);
      check('still remembered', localStorage.getItem('isle-voice-auto') === '1');
      location.hash = 'voice';
      await h.until(() => h.$('#v-leave') && !h.$('#v-leave').hidden, 5000);
      h.click('#v-leave');
      await h.until(() => !h.$('#v-join').hidden, 5000);
      check('Rời kênh: forgotten', localStorage.getItem('isle-voice-auto') === null);`,
  },
];
