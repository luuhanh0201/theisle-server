'use strict';
/**
 * Steam login in the player's own browser (portal/src/launcher-login.ts):
 * ask the portal for a login `state`, open its URL in the default browser,
 * poll until that browser finished the Steam login, then put the session
 * cookie the portal hands back into the launcher's cookie jar. The player's
 * Steam password never goes through this app.
 */

const POLL_MS = 2_000;
const GIVE_UP_MS = 10 * 60_000;

class LoginFlow {
  /**
   * @param base    the portal, e.g. https://xomgay.online
   * @param fetch   net.fetch (Electron) or a test double
   * @param openUrl opens a URL in the default browser
   * @param setCookie stores { name, value, maxAge } for `base`
   */
  constructor({ base, fetch, openUrl, setCookie, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
    Object.assign(this, { base, fetch, openUrl, setCookie, sleep, now });
    this.current = null;
  }

  /** Start (or restart) a login. Resolves 'done' | 'cancelled' | 'expired' | 'other-address' | 'steam' | 'error'. */
  async run(onUrl = () => {}) {
    this.cancel();
    const me = { cancelled: false, url: null };
    this.current = me;
    let state;
    try {
      const r = await this.fetch(`${this.base}/auth/launcher/start`, { method: 'POST' });
      if (!r.ok) return 'error';
      const body = await r.json();
      if (typeof body.state !== 'string' || typeof body.url !== 'string' || !body.url.startsWith(`${this.base}/`)) return 'error';
      state = body.state;
      me.url = body.url;
    } catch {
      return 'error';
    }
    onUrl(me.url);
    await this.openUrl(me.url);
    const started = this.now();
    while (!me.cancelled && this.now() - started < GIVE_UP_MS) {
      await this.sleep(POLL_MS);
      if (me.cancelled) break;
      let body;
      try {
        const r = await this.fetch(`${this.base}/auth/launcher/claim`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }),
        });
        body = await r.json();
      } catch {
        continue;   // network blip: keep waiting
      }
      if (body.status === 'pending') continue;
      if (body.status === 'done' && body.cookie && typeof body.cookie.value === 'string') {
        await this.setCookie(body.cookie);
        if (this.current === me) this.current = null;
        return 'done';
      }
      if (body.status === 'expired' || body.status === 'other-address' || body.status === 'steam') return body.status;
      return 'error';
    }
    return me.cancelled ? 'cancelled' : 'expired';
  }

  /** Open the same login page again (the player closed the tab). */
  async reopen() {
    if (this.current?.url) await this.openUrl(this.current.url);
  }

  cancel() {
    if (this.current) this.current.cancelled = true;
    this.current = null;
  }
}

module.exports = { LoginFlow };
