// The live state (1 s): players' position/vitals and the AI alive on the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLive, livePlayer } from '../dist/live.js';

const ME = '76561198000000001';

test('players: well-formed entries pass, junk is dropped', () => {
  const live = parseLive(JSON.stringify({
    t: 1000,
    players: [
      { id: ME, x: 1, y: 2, z: 3, yaw: 45, health: 90, stamina: 50, growth: 0.5 },
      { id: 'not-a-steamid', x: 1, y: 2 },
      { id: '76561198000000002', x: 'x', y: 2 },
    ],
    ai: { t: 999, count: 3, dead: 1, aiAlive: 3, list: [{ c: 'BP_Boar_C', x: 1, y: 2, z: 3, hp: 40 }, { x: 1 }] },
  }), 1001);
  assert.equal(live.stale, false);
  assert.deepEqual(live.players.map((p) => p.steamId), [ME]);
  assert.deepEqual(live.players[0].loc, { x: 1, y: 2, z: 3 });
  assert.equal(live.players[0].yaw, 45);
  assert.equal(live.players[0].vitals.health, 90);
  assert.equal(live.players[0].vitals.thirst, null);
  assert.equal(live.ai.count, 3, 'the count is the mod\'s, even when the list is capped');
  assert.deepEqual(live.ai.list, [{ c: 'BP_Boar_C', x: 1, y: 2, z: 3, hp: 40 }]);
  assert.equal(livePlayer(live, ME).growth, 0.5);
  assert.equal(livePlayer(live, '76561198000000009'), null);
});

test('the Lua writer\'s empty list ({}) is an empty list, not a broken file', () => {
  const live = parseLive('{"t":1000,"players":{},"ai":{"t":1000,"count":0,"list":{},"aiAlive":0,"dead":0}}', 1001);
  assert.deepEqual(live.players, []);
  assert.deepEqual(live.ai.list, []);
  assert.equal(live.ai.aiAlive, 0);
});

test('stale or broken: not trusted', () => {
  const old = parseLive(JSON.stringify({ t: 1000, players: [{ id: ME, x: 1, y: 2 }] }), 1100);
  assert.equal(old.stale, true);
  assert.equal(livePlayer(old, ME), null, 'a stale file says nothing about now');
  assert.equal(parseLive('{"t":1000,"players":[', 1000), null);
  assert.equal(parseLive(JSON.stringify({ players: [] }), 1000), null, 'no time, no trust');
  assert.equal(parseLive(JSON.stringify({ t: 1000, players: { a: 1 } }), 1000), null);
  assert.equal(parseLive(JSON.stringify({ t: 1000, players: [] }), 1000).ai, null, 'no AI scan yet');
});
