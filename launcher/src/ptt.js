'use strict';
/**
 * The push-to-talk key, global: it must work while The Isle has the focus.
 * uiohook-napi watches the keyboard and mouse without taking the key away
 * from the game (a normal "global shortcut" would swallow it). Nothing is
 * recorded or sent anywhere: only "held / released" for the chosen key goes
 * to the voice page.
 */

/** A key or mouse button: { kind: 'key' | 'mouse', code }. */
const DEFAULT_PTT = { kind: 'key', code: 47 };     // UiohookKey.V — hold to talk
const DEFAULT_RANGE = { kind: 'key', code: 41 };   // UiohookKey.Backquote (` ~) — cycle the voice range

const MOUSE_NAMES = { 3: 'Chuột giữa', 4: 'Chuột bên 1 (Mouse 4)', 5: 'Chuột bên 2 (Mouse 5)' };

/** Human name of a binding, from uiohook's key table. */
function label(binding, UiohookKey) {
  if (!binding) return 'chưa đặt';
  if (binding.kind === 'mouse') return MOUSE_NAMES[binding.code] || `Chuột ${binding.code}`;
  for (const [name, code] of Object.entries(UiohookKey)) {
    if (code === binding.code) {
      return {
        Space: 'Space', CapsLock: 'Caps Lock', Ctrl: 'Ctrl trái', CtrlRight: 'Ctrl phải', Alt: 'Alt trái',
        AltRight: 'Alt phải', Shift: 'Shift trái', ShiftRight: 'Shift phải', Backquote: '` ~', Tab: 'Tab',
      }[name] || name;
    }
  }
  return `Phím ${binding.code}`;
}

/** A binding read from settings, or `fallback`. */
function parseBinding(raw, fallback = DEFAULT_PTT) {
  if (raw && (raw.kind === 'key' || raw.kind === 'mouse') && Number.isInteger(raw.code) && raw.code > 0) {
    if (raw.kind === 'mouse' && (raw.code < 3 || raw.code > 5)) return fallback;
    return { kind: raw.kind, code: raw.code };
  }
  return fallback;
}

/**
 * Tracks held / released for one binding and calls onChange only on a change
 * (keys auto-repeat while held). Used for the talk key and the range key.
 */
class PushToTalk {
  constructor(hook, binding, onChange, fallback = DEFAULT_PTT) {
    this.hook = hook;
    this.fallback = fallback;
    this.binding = parseBinding(binding, fallback);
    this.onChange = onChange;
    this.held = false;
    this.capture = null;
    const on = (kind, down) => (e) => this.#event(kind, kind === 'key' ? e.keycode : e.button, down);
    hook.on('keydown', on('key', true));
    hook.on('keyup', on('key', false));
    hook.on('mousedown', on('mouse', true));
    hook.on('mouseup', on('mouse', false));
  }

  #event(kind, code, down) {
    if (this.capture !== null) {
      if (!down) return;
      // Esc cancels; left / right click are for using the app, not for talking.
      if (kind === 'key' && code === 1) { this.#endCapture(null); return; }
      if (kind === 'mouse' && (code < 3 || code > 5)) return;
      this.#endCapture({ kind, code });
      return;
    }
    if (kind !== this.binding.kind || code !== this.binding.code) return;
    if (down !== this.held) {
      this.held = down;
      this.onChange(down);
    }
  }

  #endCapture(binding) {
    const done = this.capture;
    this.capture = null;
    clearTimeout(done.timer);
    if (binding !== null) this.set(binding);
    done.resolve(binding);
  }

  set(binding) {
    this.binding = parseBinding(binding, this.fallback);
    if (this.held) { this.held = false; this.onChange(false); }
  }

  /** The next key or mouse button (3-5) pressed becomes the binding; Esc or 20 s = unchanged (null). */
  captureNext(timeoutMs = 20_000) {
    if (this.capture !== null) this.#endCapture(null);
    return new Promise((resolve) => {
      this.capture = { resolve, timer: setTimeout(() => this.#endCapture(null), timeoutMs) };
    });
  }

  /** Stop waiting for a key (another key started its own capture): unchanged. */
  cancelCapture() {
    if (this.capture !== null) this.#endCapture(null);
  }

  /** Focus left everything (lock screen, alt-tab mid-press): never stay stuck "talking". */
  release() {
    if (this.held) { this.held = false; this.onChange(false); }
  }
}

const sameBinding = (a, b) => Boolean(a && b && a.kind === b.kind && a.code === b.code);

/** The name of another key in `bindings` ({ name: binding }) that already uses `binding`, or null. */
function clashOf(bindings, name, binding) {
  for (const [other, b] of Object.entries(bindings)) if (other !== name && sameBinding(b, binding)) return other;
  return null;
}

/**
 * Saved bindings, each key its own: a later key that repeats an earlier one
 * gets its default back (when that is free). Two keys on one button (the
 * overlay and its edit mode both on W, 2026-09-26) flipped both at every press.
 * `wanted`: [{ name, binding, fallback }] in priority order.
 */
function distinctBindings(wanted) {
  const out = {};
  for (const { name, binding, fallback } of wanted) {
    let b = parseBinding(binding, fallback);
    if (clashOf(out, name, b) !== null && clashOf(out, name, fallback) === null) b = fallback;
    out[name] = b;
  }
  return out;
}

module.exports = { DEFAULT_PTT, DEFAULT_RANGE, clashOf, distinctBindings, label, parseBinding, PushToTalk, sameBinding };
