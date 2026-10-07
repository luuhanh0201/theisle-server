'use strict';
/**
 * The big map (owner, 2026-10-04): a key, M unless rebound, shows the whole map full
 * screen over the game, to use as the launcher's map page (drag, zoom, layers, a target);
 * the same key hides it again and the game has the screen back.
 *
 * M is a letter: typing must not open it. Ignored while
 *   - the game's chat is open: Enter opens it, Enter sends, Esc drops it (the owner's game);
 *     a chat left open with no Enter / Esc seen is forgotten after CHAT_MAX_MS;
 *   - the launcher itself has the focus (typing in the portal, the garage, a note…);
 *   - the big map is open and one of its text boxes has the focus (a target's name).
 */

const DEFAULT_BIGMAP_KEY = { kind: 'key', code: 50 };   // UiohookKey.M
const KEY_ENTER = 28;
const KEY_NUMPAD_ENTER = 3612;
const KEY_ESCAPE = 1;
const CHAT_MAX_MS = 120_000;

/** Whether the game's chat box is open, from the Enter / Esc presses made in the game. */
class ChatGuard {
  constructor(clock = Date.now) {
    this.clock = clock;
    this.openAt = null;
  }

  /** One real press (auto-repeat already folded: ptt.js PushToTalk) made while the game had the keys. */
  press(code) {
    if (code === KEY_ESCAPE) { this.openAt = null; return; }
    if (code !== KEY_ENTER && code !== KEY_NUMPAD_ENTER) return;
    this.openAt = this.isOpen() ? null : this.clock();
  }

  isOpen() {
    return this.openAt !== null && this.clock() - this.openAt < CHAT_MAX_MS;
  }

  reset() { this.openAt = null; }
}

/**
 * What a press of the big map key does: 'open', 'close' or null (ignored).
 * @param s { open, typing, chatOpen, launcherFocused }
 */
function bigMapKeyAction(s) {
  if (s.open) return s.typing ? null : 'close';
  if (s.chatOpen || s.launcherFocused) return null;
  return 'open';
}

/** The map lost the focus: close it? Open, it had the focus, and past its first moments (GRACE). */
const BLUR_GRACE_MS = 600;
function bigMapBlurCloses({ open, focused, openedAt, now }) {
  return Boolean(open && focused && now - openedAt >= BLUR_GRACE_MS);
}

/**
 * The screen the big map opens on. 'auto' (the default): the one with the mouse pointer, in game the
 * pointer is the game's, so the game's screen (the owner's two screens, 2026-10-04: "the primary" was
 * the laptop's, the game on the other); else a screen chosen in the overlay settings (its id), while it
 * is connected. `displays`: Electron's, `cursor`: { x, y }.
 */
function pickBigMapDisplay(displays, setting, cursor, primary) {
  if (setting !== 'auto' && setting !== undefined && setting !== null) {
    const chosen = displays.find((d) => String(d.id) === String(setting));
    if (chosen) return chosen;
  }
  const inside = (d) => cursor && cursor.x >= d.bounds.x && cursor.x < d.bounds.x + d.bounds.width
    && cursor.y >= d.bounds.y && cursor.y < d.bounds.y + d.bounds.height;
  return displays.find(inside) ?? primary ?? displays[0];
}

module.exports = { pickBigMapDisplay, bigMapBlurCloses, BLUR_GRACE_MS, DEFAULT_BIGMAP_KEY, KEY_ENTER, KEY_NUMPAD_ENTER, KEY_ESCAPE, CHAT_MAX_MS, ChatGuard, bigMapKeyAction };
