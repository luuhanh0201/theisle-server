// The launcher login's log line (server.ts maskIp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('the log shows an address only in part', async () => {
  const { maskIp } = await import('../dist/server.js');
  assert.equal(maskIp('113.161.25.7'), '113.161.x.x');
  assert.equal(maskIp('::ffff:113.161.25.7'), '113.161.x.x');
  assert.equal(maskIp('2405:4802:1d32:eec0::1'), '2405:4802:1d32::…');
});
