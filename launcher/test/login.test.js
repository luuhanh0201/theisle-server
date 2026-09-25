// Launcher login: start, open the browser, poll, store the cookie.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LoginFlow } = require('../src/login.js');

const BASE = 'https://play.example.com';
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

test('done: the browser URL is opened and the session cookie stored', async () => {
  const claims = [{ status: 'pending' }, { status: 'done', cookie: { name: 'isle_session', value: 'v', maxAge: 60 } }];
  const opened = []; const cookies = []; const calls = [];
  const flow = new LoginFlow({
    base: BASE, sleep: async () => {},
    fetch: async (url, init) => { calls.push([url, init.body]); return url.endsWith('/start') ? json({ state: 'a'.repeat(64), url: `${BASE}/auth/steam?launcher=${'a'.repeat(64)}` }) : json(claims.shift()); },
    openUrl: async (u) => opened.push(u), setCookie: async (c) => cookies.push(c),
  });
  assert.equal(await flow.run(), 'done');
  assert.deepEqual(opened, [`${BASE}/auth/steam?launcher=${'a'.repeat(64)}`]);
  assert.deepEqual(cookies, [{ name: 'isle_session', value: 'v', maxAge: 60 }]);
  assert.equal(JSON.parse(calls[1][1]).state, 'a'.repeat(64));
});

test('a start answer pointing elsewhere is refused; expiry and cancel', async () => {
  const opened = [];
  const evil = new LoginFlow({ base: BASE, sleep: async () => {}, fetch: async () => json({ state: 'x', url: 'https://evil.example/' }), openUrl: async (u) => opened.push(u), setCookie: async () => {} });
  assert.equal(await evil.run(), 'error');
  assert.deepEqual(opened, [], 'never opens a URL the server did not own');
  const gone = new LoginFlow({ base: BASE, sleep: async () => {}, fetch: async (u) => (u.endsWith('/start') ? json({ state: 's', url: `${BASE}/x` }) : json({ status: 'expired' }, 410)), openUrl: async () => {}, setCookie: async () => {} });
  assert.equal(await gone.run(), 'expired');
  let flow;
  flow = new LoginFlow({ base: BASE, sleep: async () => flow.cancel(), fetch: async () => json({ state: 's', url: `${BASE}/x`, status: 'pending' }), openUrl: async () => {}, setCookie: async () => {} });
  assert.equal(await flow.run(), 'cancelled');
});

test('Steam unreachable at the check: the launcher hears "steam" (the gate says to retry)', async () => {
  const flow = new LoginFlow({ base: BASE, sleep: async () => {}, fetch: async (u) => (u.endsWith('/start') ? json({ state: 's', url: `${BASE}/x` }) : json({ status: 'steam' }, 410)), openUrl: async () => {}, setCookie: async () => {} });
  assert.equal(await flow.run(), 'steam');
});
