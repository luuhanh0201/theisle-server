// A dino's colours painted again when the player comes back on it (skin-relog.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { SkinRelog, toRequest } = await import('../dist/skin-relog.js');

const P = '76561198000000061';
const REX = 'BP_Tyrannosaurus_C';
const PINK = { colors: { Body: { r: 1, g: 0, b: 0.82 }, Eyes: { r: 5.2, g: 0.1, b: 0.1 } }, patternIndex: 2, themeIndex: 0, variation: 0.4, female: true };
const OWN = { colors: { Body: { r: 0.23, g: 0.18, b: 0.12 }, Eyes: { r: 0.5, g: 0.4, b: 0.1 } }, patternIndex: 0, themeIndex: 0, variation: 0.4, female: true };

function setup(kept = false, startedAt = 1000) {
  const sent = [];
  const r = new SkinRelog(startedAt, async (id, skin) => { sent.push({ id, skin }); }, async () => kept, () => {});
  return { r, sent };
}
const feed = async (r, events) => { for (const e of events) await r.handle(e); };
const played = (t) => [
  { type: 'spawn', t, steamId: P, species: REX, growth: 0.25 },
  { type: 'skin', t, steamId: P, species: REX, skin: OWN },
  { type: 'skin', t: t + 60, steamId: P, species: REX, skin: PINK },          // painted from the web
  { type: 'snapshot', t: t + 100, steamId: P, species: REX, growth: 0.81 },
];

test('a relog on the same dino: its colours painted again (the game brought back its own)', async () => {
  const { r, sent } = setup();
  await feed(r, [...played(2000),
    { type: 'session_end', t: 2200, steamId: P },
    { type: 'spawn', t: 2300, steamId: P, species: REX, growth: 0.81 },
    { type: 'skin', t: 2300, steamId: P, species: REX, skin: OWN }]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].skin.colors.Body, { r: 1, g: 0, b: 0.82 });
  assert.equal(sent[0].skin.colors.Eyes.r, 4, 'glow clamped to what the editor allows');
  assert.equal(sent[0].skin.pattern, 2);
});

test('not after a death, a store, or when the game kept them; not for kept colours; not on a replay', async () => {
  let s = setup();
  await feed(s.r, [...played(2000), { type: 'death', t: 2150, steamId: P, species: REX },
    { type: 'spawn', t: 2300, steamId: P, species: REX, growth: 0.25 }, { type: 'skin', t: 2300, steamId: P, species: REX, skin: OWN }]);
  assert.equal(s.sent.length, 0, 'a new dino after a death');
  s = setup();
  await feed(s.r, [...played(2000), { type: 'spawn', t: 2300, steamId: P, species: REX, growth: 0.5 },
    { type: 'skin', t: 2300, steamId: P, species: REX, skin: OWN }]);
  assert.equal(s.sent.length, 0, 'lower growth: another dino');
  s = setup();
  await feed(s.r, [...played(2000), { type: 'spawn', t: 2300, steamId: P, species: REX, growth: 0.81 },
    { type: 'skin', t: 2300, steamId: P, species: REX, skin: PINK }]);
  assert.equal(s.sent.length, 0, 'the colours are still there');
  s = setup(true);
  await feed(s.r, [...played(2000), { type: 'spawn', t: 2300, steamId: P, species: REX, growth: 0.81 },
    { type: 'skin', t: 2300, steamId: P, species: REX, skin: OWN }]);
  assert.equal(s.sent.length, 0, 'kept colours: the mod paints them');
  s = setup(false, 9999);
  await feed(s.r, [...played(2000), { type: 'spawn', t: 2300, steamId: P, species: REX, growth: 0.81 },
    { type: 'skin', t: 2300, steamId: P, species: REX, skin: OWN }]);
  assert.equal(s.sent.length, 0, 'replayed at the bridge start: nothing sent');
});

test('the game skin as the editor request', () => {
  assert.deepEqual(toRequest(PINK), { colors: { Body: { r: 1, g: 0, b: 0.82 }, Eyes: { r: 4, g: 0.1, b: 0.1 } }, pattern: 2, theme: 0, variation: 0.4 });
  assert.equal(toRequest({ colors: {} }), null);
});
