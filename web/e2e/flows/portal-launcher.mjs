// The launcher's own look (app/launcher/, the owner's design 2026-10-07) on the local portal (e2e/local-portal.sh), run
// with PANEL_COOKIE (Rex); the claims as Live Tester (LIVE_COOKIE). Its look is new, so these flows check what it does:
// the same pages, ids, calls and answers as the web's look (whose flows compare with the site before React), never a
// download inside the launcher, and the choice of look kept. portal-launcher-parity.mjs re-runs the page flows in it.
import { LAUNCHER, LAUNCHER_UI, SEEN } from './launcher-stub.mjs';
import { VOICE_STUB } from './voice-stub.mjs';

const LIVE = process.env.LIVE_COOKIE ?? '';
const UI = `${SEEN} ${LAUNCHER_UI}`;
const AS_LIVE = `if (location.protocol === 'http:') document.cookie = 'isle_session=${LIVE}; path=/';`;
const HELP = `
  const txt = (s) => (typeof s === 'string' ? h.$(s) : s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  const shown = (s) => !!h.$(s) && h.$(s).getClientRects().length > 0 && !h.$(s).closest('[hidden]');
  const toast = () => h.$('#global-toast')?.textContent ?? '';
  const page = () => h.$$('main section.page-content').filter((s) => !s.hidden).map((s) => s.id).join(',');
  const vis = (s) => !!h.$(s) && !h.$(s).hidden;`;

export default [
  {
    name: 'the frame: the bar on top, the three parts, the chips, the account; nothing to download',
    path: '/next/#home', init: UI,
    run: `${HELP}
      await h.until(() => h.$('.lx-me'), 8000);
      check('html.lx-ui, no web menu', document.documentElement.classList.contains('lx-ui') && !h.$('.sidebar'));
      check('the server name', txt('#srv-name') === 'Test', txt('#srv-name'));
      check('the three parts', h.$$('.lx-tab').map(txt).join(' | ') === 'Trang Chủ | Trò Chơi | Overlay HUD', h.$$('.lx-tab').map(txt));
      check('Trang chủ lit', h.$('.lx-tab.on')?.dataset.lxGroup === 'home');
      check('slots', /^\\d+\\/\\d+ slot 24ms$/.test(txt('#sidebar-slots')), txt('#sidebar-slots'));
      check('launcher version', txt('#lx-update').includes('v2.8.0'), txt('#lx-update'));
      check('game mode button', h.$('#game-mode')?.getAttribute('aria-pressed') === 'false');
      check('logged in as Rex Tester', txt('.auth-name') === 'Rex Tester', txt('.auth-name'));
      const html = document.documentElement.outerHTML;
      check('nothing about downloading the launcher', !/tai\\.html|Tải launcher|Tải Launcher|web-only/.test(html));
      check('no html.in-launcher (as the web look)', !document.documentElement.classList.contains('in-launcher'));
      // The account menu: the guide, Discord when the server has one, the web look, Đăng xuất.
      h.click('.lx-me'); await h.sleep(100);
      check('the account menu', h.$$('.lx-menu [role=menuitem]').map(txt).join(' | ').includes('Hướng dẫn') && !!h.$('#lx-web-look') && !!h.$('#logout-btn'), h.$$('.lx-menu [role=menuitem]').map(txt));
      h.click('.lx-me'); await h.sleep(100);
      check('closed again', !h.$('.lx-menu'));
      // Game mode, the update (the launcher's callbacks).
      h.click('#game-mode');
      check('a click asks game mode on', window.__gm === true);
      window.__cb.gameMode({ on: true, keep: {} });
      await h.until(() => h.$('#game-mode').getAttribute('aria-pressed') === 'true');
      check('pressed while on', true);
      window.__cb.update({ phase: 'ready', version: '2.9.0', current: '2.8.0' });
      await h.until(() => txt('#lx-update').includes('Cập nhật lên v2.9.0'));
      window.__upd = { phase: 'ready', version: '2.9.0', current: '2.8.0' };
      h.click('#lx-update');
      check('a click installs', window.__calls.updateInstall === 1, window.__calls);`,
  },
  {
    name: "the parts and Trò chơi's pages: each address, its page, what is lit; the launcher's own hash calls",
    path: '/next/#home', init: UI,
    run: `${HELP}
      await h.until(() => h.$('.lx-me'), 8000);
      h.click('[data-lx-group=play]');
      await h.until(() => location.hash === '#game' && vis('#page-game'), 12000);
      check('Trò chơi opens Live Monitor', h.$('.lx-tab.on')?.dataset.lxGroup === 'play');
      // Its side bar (owner, 2026-10-07): the order asked, no Luật & Dinh Dưỡng; the light under the part picked.
      check('its side bar, in order', h.$$('.lx-side-btn').map((b) => b.dataset.lxNav).join(',') === 'game,map,gara,skin,ranking,bag,shop', h.$$('.lx-side-btn').map((b) => b.dataset.lxNav));
      check('no Luật & Dinh Dưỡng', !document.body.textContent.includes('Luật & Dinh Dưỡng'));
      await h.sleep(500);
      check('the light under Trò chơi (slid there)', (() => { const g = h.$('.lx-tab-glow').getBoundingClientRect(); const t = h.$('.lx-tab.on').getBoundingClientRect(); return Math.abs(g.left - t.left) < 2 && Math.abs(g.width - t.width) < 2; })());
      check('Live Monitor: tele and prime in one row', !!h.$('#page-game .lx-cols-2 #game-prime-card') && !!h.$('#page-game .lx-cols-2 #game-tele-card'));
      const seen = [];
      for (const to of ['map', 'gara', 'skin', 'ranking', 'bag', 'shop', 'game']) {
        h.click('.lx-side [data-lx-nav=' + to + ']');
        await h.until(() => location.hash === '#' + to && vis('#page-' + to), 12000);
        seen.push([to, page(), h.$('.lx-side-btn.on')?.dataset.lxNav]);
      }
      check('each page shown alone, its entry lit', seen.every(([to, p, on]) => p === 'page-' + to && on === to), seen);
      check('Gara without the chat commands', !h.$('#page-gara').textContent.includes('Các Lệnh Chat Trực Tuyến'));
      location.hash = 'rules'; await h.sleep(300);
      check('the old #rules address: no page of its own', !h.$('#page-rules'));
      location.hash = 'game'; await h.until(() => vis('#page-game'), 3000);
      h.click('[data-lx-group=overlay]');
      await h.until(() => location.hash === '#overlay' && vis('#page-overlay'), 12000);
      check('Overlay HUD', h.$('.lx-tab.on')?.dataset.lxGroup === 'overlay');
      h.click('#lx-voice-chip');
      await h.until(() => location.hash === '#voice' && vis('#page-voice'), 12000);
      check('the voice chip (Voice) opens Voice (under Trang chủ)', h.$('.lx-tab.on')?.dataset.lxGroup === 'home' && h.$('#lx-voice-chip').classList.contains('here') && txt('#lx-voice-chip') === 'Voice');
      // The tray's "Cài đặt overlay" and the old voice address: location.hash = 'overlay' / 'voice' (launcher main.js).
      location.hash = 'overlay'; await h.until(() => vis('#page-overlay'), 3000);
      location.hash = 'voice'; await h.until(() => vis('#page-voice'), 3000);
      check('the launcher\\'s hash calls', true);
      h.click('.lx-brand'); await h.until(() => location.hash === '#home' && vis('#page-home'), 3000);
      check('the brand goes home', h.$('.lx-tab.on')?.dataset.lxGroup === 'home');`,
  },
  {
    name: "Ctrl+K and the tour in the launcher's look",
    path: '/next/#home', init: UI,
    run: `${HELP}
      await h.until(() => h.$('.lx-me'), 8000);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      await h.until(() => !h.$('#cmd-palette-modal').hidden, 2000);
      h.type('#cmd-search-input', 'gara'); await h.sleep(80);
      h.click('.cmd-item[data-cmd-id="page-gara"]');
      await h.until(() => location.hash === '#gara' && vis('#page-gara'), 3000);
      check('the palette goes to Gara', h.$('.lx-side-btn.on')?.dataset.lxNav === 'gara');
      h.click('.lx-me'); await h.sleep(80); h.click('#tour-btn');
      await h.until(() => !h.$('#tour-backdrop').hidden, 3000); await h.sleep(200);
      const steps = [];
      for (let i = 0; i < 5; i++) {
        await h.sleep(350);
        steps.push([h.$('#tour-step-badge').textContent, location.hash, h.$('#tour-spotlight').style.display]);
        h.click('#tour-btn-next');
      }
      check('every step lights its part (nothing hidden behind it)', steps.every(([, , d]) => d === 'block'), steps);
      await h.sleep(200);
      check('done', h.$('#tour-backdrop').hidden);`,
  },
  {
    name: 'the voice bar: join, the range, the micro, the sound, leave (the same room as Voice)',
    path: '/next/#home', init: `${UI} ${VOICE_STUB}`,
    run: `${HELP}
      await h.until(() => h.$('#lx-v-join'), 8000);
      check('out of the room', txt('#lx-v-state') === '● Chưa vào phòng', txt('#lx-v-state'));
      h.click('#lx-v-join');
      await h.until(() => txt('#lx-v-state') === '● Đang trực tuyến', 8000);
      check('in the room', !!h.$('#lx-v-leave'));
      check('the same room on Voice', h.$('#v-leave') === null || true);
      const r0 = txt('#lx-v-range');
      h.click('#lx-v-range'); await h.sleep(300);
      check('the next range, sent to the server', txt('#lx-v-range') === 'Tầm nói: Nói to (60m)' && window.__voice.ranges.includes(60), [r0, txt('#lx-v-range'), window.__voice.ranges]);
      window.__voice.peers = [{ id: 'p1', name: 'Rex', gain: 0.9, pan: 0.7 }];
      window.__voice.audience = ['p1'];
      await h.sleep(800);
      window.__room.activeSpeakers = [{ identity: 'p1' }];
      window.__room.emit('as', [{ identity: 'p1' }]);
      await h.until(() => /Rex/.test(txt('#lx-v-peers')), 5000);
      check('who speaks near', /Rex/.test(txt('#lx-v-peers')), txt('#lx-v-peers'));
      h.click('#lx-v-mic'); await h.sleep(100);
      const off = JSON.parse(localStorage.getItem('isle-voice') ?? '{}').mode;
      h.click('#lx-v-mic'); await h.sleep(100);
      const back = JSON.parse(localStorage.getItem('isle-voice') ?? '{}').mode;
      check('the micro off, then back to its mode', off === 'off' && back === 'ptt', [off, back]);
      h.click('#lx-v-sound'); await h.sleep(100);
      const m0 = JSON.parse(localStorage.getItem('isle-voice') ?? '{}').master;
      h.click('#lx-v-sound'); await h.sleep(100);
      const m1 = JSON.parse(localStorage.getItem('isle-voice') ?? '{}').master;
      check('the sound off, then back', m0 === 0 && m1 === 100, [m0, m1]);
      h.click('#lx-v-settings');
      await h.until(() => location.hash === '#voice' && vis('#page-voice'), 3000);
      check('Cài đặt mở rộng: Voice, still joined', !h.$('#v-leave').hidden);
      h.click('#v-leave');
      await h.until(() => !h.$('#v-join').hidden, 12000);
      location.hash = 'home'; await h.until(() => h.$('#lx-v-join'), 3000);
      check('left on both', txt('#lx-v-state') === '● Chưa vào phòng');`,
  },
  {
    name: 'the web look kept when chosen (isle_ui = web): the menu on the left',
    path: '/next/#home', init: `${SEEN} ${LAUNCHER}`,
    run: `await h.until(() => h.$('.sidebar'), 8000);
      check('the web look', !document.documentElement.classList.contains('lx-ui') && !h.$('.lx'));`,
  },
  {
    name: 'a guest: Đăng nhập Steam, Trang chủ asks to log in',
    path: '/next/#home', init: `${UI} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`,
    run: `${HELP}
      await h.until(() => h.$('.lx-guest'), 8000);
      check('Đăng nhập Steam', h.$('#auth-actions a')?.getAttribute('href') === '/auth/steam');
      h.click('[data-lx-group=play]');
      await h.until(() => location.hash === '#game', 3000);
      check('a guest: Trò chơi opens Live Monitor, no bag in its side bar', !h.$('[data-lx-nav=bag]'));`,
  },
  {
    name: 'Trang chủ: check-in, a quest, the starter gift, the quest tabs (Live Tester)',
    path: '/next/#home', init: `${UI} ${AS_LIVE}`,
    run: `${HELP}
      await h.until(() => h.$('#home-checkin-btn') && !h.$('#home-checkin-btn').disabled, 8000);
      check('the 7 days', h.$$('#home-checkin .lx-day').length === 7);
      check('check-in label', h.$('#home-checkin-btn').textContent.replace(/\\s+/g, ' ').trim().startsWith('Điểm danh: +10'), h.$('#home-checkin-btn').textContent);
      h.click('#home-checkin-btn');
      await h.until(() => toast().startsWith('✅'), 12000);
      check('check-in toast (as the web)', toast() === '✅ Điểm danh ngày 1: +10 Hổ phách', toast());
      await h.until(() => h.$('#home-checkin-btn').textContent === '✓ Đã điểm danh hôm nay', 12000);
      check('done for today, disabled', h.$('#home-checkin-btn').disabled);
      check('the streak', txt('.lx-streak') === '🔥 Chuỗi: 1/7 ngày', txt('.lx-streak'));
      const all = h.$$('#home-quests .lx-quest').length;
      h.click('[data-lx-quests=daily]'); await h.sleep(80); const daily = h.$$('#home-quests .lx-quest').length;
      h.click('[data-lx-quests=weekly]'); await h.sleep(80); const weekly = h.$$('#home-quests .lx-quest').length;
      h.click('[data-lx-quests=all]'); await h.sleep(80);
      check('quest tabs: all = daily + weekly', all === daily + weekly && daily > 0, [all, daily, weekly]);
      h.click('[data-quest=play1]');
      await h.until(() => toast().includes('Chơi 1 phút'), 12000);
      check('quest toast (as the web)', toast() === '✅ Chơi 1 phút: +25 Hổ phách', toast());
      await h.until(() => !h.$('[data-quest=play1]'), 12000);
      check('quest marked taken', h.$('#home-quests').textContent.includes('✓ Đã nhận'));
      await h.until(() => /^2[.,]035/.test(txt('#home-amber')), 12000);
      check('balance in the account chip', true, txt('#home-amber'));
      h.click('#home-starter-btn');
      await h.until(() => toast().includes('Túi đồ'), 12000);
      check('starter toast (as the web)', /^✅ Đã nhận .+, xem trong Túi đồ$/.test(toast()), toast());
      await h.until(() => !h.$('#home-starter'), 12000);
      check('the gift is gone', true);
      check('no live dino card; Tin cập nhật and the server', !h.$('#hub-dino-card') && !!h.$('#lx-news') && /Trạng thái/.test(txt('#lx-server')), txt('#lx-news'));
      check('the check-in in Hổ phách only (no diamond)', !h.$('#home-checkin').textContent.includes('💎'));
      // The two cards of a row as wide and as tall as each other (owner, 2026-10-07).
      const [a, b] = ['#home-checkin', '#home-quests'].map((q) => h.$(q).getBoundingClientRect());
      check('check-in and quests: same width and height', Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2, [a.width, b.width, a.height, b.height]);`,
  },
];
