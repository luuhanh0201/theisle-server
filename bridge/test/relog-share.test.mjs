// A prime the mod set gets its prime stats only when the dino is loaded again:
// at a relog the max health jumps and the health stays the number it was —
// the bridge puts health and blood back to the share they had (relog-share.ts). npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { RelogShare } = await import('../dist/relog-share.js');
const ME = '76561199320940985';
const snap = (t, health, max, blood = health, maxBlood = max, species = 'BP_Tyrannosaurus_C') =>
  ({ type: 'snapshot', t, steamId: ME, species, health, blood, max: { health: max, blood: maxBlood } });

test('the max health jumped at a relog: the same share as when they left', () => {
  const r = new RelogShare(100);
  assert.equal(r.onEvent(snap(200, 9350, 9350)), null);
  assert.equal(r.onEvent({ type: 'session_end', t: 210, steamId: ME }), null);
  assert.equal(r.onEvent(snap(205, 9350, 9350)), null, 'a snapshot from before the relog, read late: not the new one');
  assert.deepEqual(r.onEvent(snap(260, 9361, 12274, 9365, 12274)), { steamId: ME, health: 1, blood: 1, maxBefore: 9350, maxNow: 12274 });
  assert.equal(r.onEvent(snap(270, 9380, 12274)), null, 'once');
});

test('nothing to do: no jump, another species, a fight since, or an old event read at start', () => {
  const r = new RelogShare(1000);
  const relog = (t0, a, b) => { r.onEvent(a); r.onEvent({ type: 'session_end', t: t0, steamId: ME }); return r.onEvent(b); };
  assert.equal(relog(1010, snap(1005, 5000, 9350), snap(1020, 5000, 9350)), null, 'same max');
  assert.equal(relog(1030, snap(1025, 5000, 9350), snap(1040, 50, 50, 50, 50, 'BP_Triceratops_C')), null, 'another dino');
  assert.equal(relog(1060, snap(1050, 9350, 9350), snap(1070, 4000, 12274)), null, 'hurt since');
  const half = relog(1090, snap(1080, 4675, 9350, 9350, 9350), snap(1100, 4675, 12274, 9350, 12274));
  assert.deepEqual([half.health, half.blood], [0.5, 1], 'half health stays half: nothing healed');
  const old = new RelogShare(5000);
  old.onEvent(snap(200, 9350, 9350)); old.onEvent({ type: 'session_end', t: 210, steamId: ME });
  assert.equal(old.onEvent(snap(260, 9350, 12274)), null, 'read again when the bridge starts: not acted on');
});
