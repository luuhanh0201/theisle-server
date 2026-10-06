// A stub of Xóm Gáy Launcher's window.isleLauncher (launcher/src/preload.js) for the player site's flows:
// what the pages call, each call counted on window.__calls; the update state in window.__upd; the
// callbacks the launcher would call in window.__cb (update, gameMode). No overlay (overlayGet absent):
// the overlay settings page then says to use the launcher, as in a browser.
export const LAUNCHER = `if (location.protocol === 'http:') {
  window.__calls = {}; window.__cb = {};
  const count = (k) => { window.__calls[k] = (window.__calls[k] || 0) + 1; };
  window.isleLauncher = {
    version: '2.8.0', platform: 'win32',
    updateGet: () => window.__upd ?? { phase: 'idle', current: '2.8.0' },
    updateCheck() { count('updateCheck'); }, updateInstall() { count('updateInstall'); },
    onUpdate(cb) { window.__cb.update = cb; },
    playGame() { count('playGame'); },
    gameModeGet: () => ({ on: false, keep: {} }),
    gameModeSet(on) { count('gameModeSet'); window.__gm = on; },
    onGameMode(cb) { window.__cb.gameMode = cb; },
    keyLabel: () => 'V', captureKey: async () => null, pttLabel: () => 'V', rangeLabel: () => '\`',
    capturePttKey: async () => null, captureRangeKey: async () => null,
    onPushToTalk() {}, onRangeKey() {}, overlayState() {},
  };
}`;
/** The tour seen already (it opens by itself on a first visit, over the page). */
export const SEEN = `if (location.protocol === 'http:') localStorage.setItem('isle_portal_tour_done', '1');`;
