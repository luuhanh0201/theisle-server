'use strict';
/**
 * The mini map, moving smoothly (owner, 2026-10-08: "hơi giật", and nothing that costs the game or the player's PC).
 *
 * The portal (map.js paintMini) sends a picture of the map about once a second; before 1.0.39 the widget showed each
 * picture as it was, so the map and your arrow jumped once a second, a turn of the dino turned the map in steps. Now
 * the picture (v2) is drawn north up, a little wider than the widget and without your arrow, with where its middle is
 * in the world. The widget moves and turns that same picture after your dino between two positions (PoseTween), and
 * draws your arrow in the middle: a drawImage per screen frame, while the dino moves only. The picture itself is still
 * made about once a second (less: only when something on it changed), so nothing more is encoded than before.
 *
 * Used by the main process (sanitising what the portal sends) and the overlay page (overlay.html loads this file
 * before overlay-page.js: window.IsleMinimap).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IsleMinimap = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const MINI_V2 = 2;
  // A glide lasts about as long as the positions take to come (about a second, unevenly): the dino never stops and
  // jumps between two. An average of the last gaps, a little longer than it, within these bounds.
  const TWEEN_MIN_MS = 400;
  const TWEEN_MAX_MS = 1600;
  const TWEEN_START_MS = 1000;
  // Further than this in one step (a respawn, a teleport, the garage): no glide across the map.
  const JUMP_CM = 6000;

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** What the portal says about a v2 picture, checked; null for an older picture (shown as it is). */
  function miniMeta(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== MINI_V2) return null;
    const { cx, cy, pxPerM, w, h } = raw;
    if (![cx, cy, pxPerM, w, h].every(finite)) return null;
    if (pxPerM <= 0 || pxPerM > 100 || w <= 0 || h <= 0 || w > 4000 || h > 4000) return null;
    // friends: the page's Bạn bè layer is on (the widget draws an arrow on its rim for a friend beyond it).
    return { v: MINI_V2, cx, cy, pxPerM, w, h, friends: raw.friends === true };
  }

  /** a → b the short way round, in degrees, at k (0..1). */
  function lerpYaw(a, b, k) {
    if (!finite(a)) return finite(b) ? b : null;
    if (!finite(b)) return a;
    const d = ((((b - a) % 360) + 540) % 360) - 180;
    return a + d * k;
  }

  /** Your dino between its last two positions ({ x, y, yaw } world cm / degrees), by the clock. */
  class PoseTween {
    constructor() { this.from = null; this.to = null; this.t0 = 0; this.ms = TWEEN_START_MS; this.lastAt = null; }

    /** A new position from the game data; `now` in ms. */
    update(pos, now) {
      if (!pos || !finite(pos.x) || !finite(pos.y)) { this.from = null; this.to = null; return; }
      const next = { x: pos.x, y: pos.y, yaw: finite(pos.yaw) ? pos.yaw : null };
      if (this.to && next.x === this.to.x && next.y === this.to.y && next.yaw === this.to.yaw) return;   // the same answer again
      // Where it is shown now, before the glide's length changes (no step back).
      const cur = this.at(now);
      if (this.lastAt !== null) {
        const gap = now - this.lastAt;
        this.ms = Math.min(TWEEN_MAX_MS, Math.max(TWEEN_MIN_MS, this.ms * 0.6 + gap * 1.1 * 0.4));
      }
      this.lastAt = now;
      const far = !cur || Math.hypot(next.x - cur.x, next.y - cur.y) > JUMP_CM;
      this.from = far ? next : cur;
      this.to = next;
      this.t0 = now;
    }

    /** Where it is shown at `now`: { x, y, yaw } or null. */
    at(now) {
      if (!this.to) return null;
      const k = this.from === this.to ? 1 : Math.min(1, Math.max(0, (now - this.t0) / this.ms));
      return {
        x: this.from.x + (this.to.x - this.from.x) * k,
        y: this.from.y + (this.to.y - this.from.y) * k,
        yaw: lerpYaw(this.from.yaw, this.to.yaw, k),
      };
    }

    /** Still gliding at `now` (worth drawing again). */
    moving(now) {
      if (!this.to || this.from === this.to || now - this.t0 >= this.ms) return false;
      return this.from.x !== this.to.x || this.from.y !== this.to.y || this.from.yaw !== this.to.yaw;
    }
  }

  /**
   * How to draw a v2 picture in a cw × ch widget showing radiusM metres to its edge, the dino at `pose`: the
   * picture's scale and where its top-left goes, in the widget's (turned) frame centred on the dino, and the turn.
   */
  function placePicture(meta, pose, cw, ch, radiusM, heading) {
    const pxPerM = (Math.min(cw, ch) / 2) / radiusM;
    const scale = pxPerM / meta.pxPerM;
    // World X is right, world Y down on the picture (north up), 100 world units a metre.
    const dx = (meta.cx - pose.x) / 100 * pxPerM;
    const dy = (meta.cy - pose.y) / 100 * pxPerM;
    const w = meta.w * scale; const h = meta.h * scale;
    const turn = heading && finite(pose.yaw) ? -Math.PI / 2 - pose.yaw * Math.PI / 180 : 0;
    return { x: dx - w / 2, y: dy - h / 2, w, h, turn, pxPerM };
  }

  /**
   * A point dx, dy px from the widget's middle (before the map is turned by `turn`) beyond the visible map: where
   * on the rim its arrow goes and which way it points; null when it is on the map (map.js edgeArrow, the same).
   */
  function edgeArrow(dx, dy, width, height, shape, turn = 0, pad = 13) {
    const rx = dx * Math.cos(turn) - dy * Math.sin(turn); const ry = dx * Math.sin(turn) + dy * Math.cos(turn);
    const len = Math.hypot(rx, ry);
    if (len < 1) return null;
    const k = shape === 'circle' ? (Math.min(width, height) / 2 - pad) / len
      : Math.min((width / 2 - pad) / Math.abs(rx || 1e-9), (height / 2 - pad) / Math.abs(ry || 1e-9));
    if (k >= 1) return null;
    return { x: rx * k, y: ry * k, angle: Math.atan2(ry, rx) };
  }

  return { MINI_V2, TWEEN_MIN_MS, TWEEN_MAX_MS, JUMP_CM, miniMeta, lerpYaw, PoseTween, placePicture, edgeArrow };
}));
