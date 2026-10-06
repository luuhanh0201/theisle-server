// A bite's reach and the far-bite verdict (damage-reach.ts), and how the store carries them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DamageReach, REACH_RULES, distanceM } from '../dist/damage-reach.js';
import { Store } from '../dist/store.js';
import { parseEvent } from '../dist/events.js';

const A = '76561198000000001';
const B = '76561198000000002';
const REX = 'BP_Tyrannosaurus_C';
const at = (m) => ({ x: m * 100, y: 0, z: 0 });
const bite = (m, growth = 1, species = REX) => ({ attackerSpecies: species, attackerGrowth: growth, attackerLoc: { x: 0, y: 0, z: 0 }, loc: at(m) });

test('distance: metres between the two centres, 3D, one decimal', () => {
  assert.equal(distanceM({ x: 0, y: 0, z: 0 }, { x: 300, y: 400, z: 0 }), 5);
  assert.equal(distanceM({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1234 }), 12.3);
  assert.equal(distanceM({ x: 0, y: 0 }, { x: 0, y: 250 }), 2.5, 'z missing counts as 0');
});

test('no verdict without both positions or the species', () => {
  const r = new DamageReach();
  assert.equal(r.judge({ attackerSpecies: REX, loc: at(5) }), null, 'StatsLogger before 2026-10-07: no attackerLoc');
  assert.equal(r.judge({ attackerLoc: at(0), loc: at(5) }), null);
  assert.equal(r.judge({ attackerSpecies: REX, attackerLoc: { x: 'a', y: 0 }, loc: at(5) }), null);
});

test('before learning: the default limit, then the hard limit always', () => {
  const r = new DamageReach();
  const near = r.judge(bite(10));
  assert.deepEqual(near, { distM: 10, limitM: REACH_RULES.DEFAULT_M, basis: 'default', far: false });
  assert.equal(r.judge(bite(REACH_RULES.DEFAULT_M + 1)).far, true);
});

test('learns a species\' reach, flags a bite far beyond it, never learns from a far one', () => {
  const r = new DamageReach();
  // A grown Rex bites from 6 to 9 m.
  for (let i = 0; i < 60; i++) r.judge(bite(6 + (i % 4)));
  const usual = r.judge(bite(8));
  assert.equal(usual.basis, 'learned');
  assert.equal(usual.far, false);
  assert.ok(usual.limitM >= 9 && usual.limitM < 20, `limit ${usual.limitM}`);
  const far = r.judge(bite(22));
  assert.equal(far.far, true, 'a 22 m bite is far for a Rex that bites at 6-9 m');
  // A hundred far bites do not widen it.
  for (let i = 0; i < 100; i++) r.judge(bite(22));
  assert.equal(r.judge(bite(22)).far, true);
  const g = r.groups().find((x) => x.species === REX && x.size === 'grown');
  assert.equal(g.samples, 61, 'only the near bites were learned');
});

test('the young are judged apart; a size not learned yet uses the whole species', () => {
  const r = new DamageReach();
  for (let i = 0; i < 40; i++) r.judge(bite(3 + (i % 2), 0.3));
  // The grown Rex has no bites of its own yet: the species' (young) limit, marked as such.
  const grown = r.judge(bite(4, 0.9));
  assert.equal(grown.basis, 'species');
  const young = r.judge(bite(4, 0.3));
  assert.equal(young.basis, 'learned');
  assert.ok(young.limitM >= REACH_RULES.FLOOR_M, 'never under the floor');
  assert.equal(r.judge(bite(15, 0.3)).far, true, 'a young Rex biting from 15 m');
  const sizes = r.groups().filter((x) => x.species === REX).map((x) => x.size);
  assert.deepEqual(sizes, ['young', 'grown', 'all']);
});

test('the store: a far bite carries its reach on the log, listed even on AI; hold ticks keep the bite', () => {
  const s = new Store();
  const t = Math.floor(Date.now() / 1000);
  const dmg = (i, m, victim = B, extra = {}) => ({ t: t + i, type: 'damage', attacker: A, victim, amount: 50, attackerSpecies: REX,
    attackerGrowth: 1, attackerLoc: { x: 0, y: 0, z: 0 }, loc: at(m), bite: `b${i}`, tick: 1, ...extra });
  const events = [{ t, type: 'session_start', steamId: A, name: 'Alpha' }, { t, type: 'session_start', steamId: B, name: 'Bravo' }];
  for (let i = 1; i <= 40; i++) events.push(dmg(i, 6 + (i % 3), 'ai'));
  events.push(dmg(50, 7));
  events.push(dmg(51, 30));
  events.push(dmg(51, 30, B, { amount: 45, tick: 2, bite: 'b51' }));
  events.push(dmg(52, 35, 'ai'));
  for (const raw of events) s.apply(parseEvent(raw));
  const log = s.feed(10, new Set(['damage']));
  assert.equal(log.length, 2, 'bites on AI stay off the log');
  const [farOne, nearOne] = log;
  assert.equal(nearOne.reach.far, false);
  assert.equal(farOne.reach.distM, 30);
  assert.equal(farOne.reach.far, true);
  assert.equal(farOne.ticks, 2, 'the hold tick added to the far bite');
  const far = s.farBites(10);
  assert.deepEqual(far.map((e) => e.victim), ['ai', B], 'far bites newest first, the AI one too');
  assert.ok(s.reach.groups().some((g) => g.species === REX && g.limitM !== null), 'bites on AI taught the limit');
});
