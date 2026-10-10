// The species limit (species-cap.ts): a player who counts (not SVip / admin) past a species' limit
// listed for DinoGarage to remove; relogs, rebirths, garage dinos and grown dinos never; the store's
// alive dinos (aliveDinos) and the removal not counted as a death. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'species-cap-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
const { SpeciesCaps, validateSpeciesCap, saveSpeciesCap, readSpeciesCap, JUDGE_AFTER_S } = await import('../dist/species-cap.js');
const { Store } = await import('../dist/store.js');
const { parseEvent } = await import('../dist/events.js');
after(() => rmSync(root, { recursive: true, force: true }));

const ids = (n) => `7656119800000${String(n).padStart(4, '0')}`;
const REX = 'BP_Tyrannosaurus_C';

/** A SpeciesCaps on fakes: the clock, the dinos alive, who is free of the limit (SVip / admins). */
function rig(settings, { exempt = [] } = {}) {
  const w = { now: 1_000_000, dinos: [], over: [], state: { seq: 0 }, settings, exempt: new Set(exempt) };
  const caps = new SpeciesCaps({
    aliveDinos: () => w.dinos,
    exempt: async () => w.exempt,
    settings: async () => w.settings,
    saveState: async (st) => { w.state = st; },
    loadState: async () => w.state,
    writeOver: async (over) => { w.over = over; },
    now: () => w.now,
    log: () => undefined,
  });
  /** A dino alive now (spawned `ago` s before), and its spawn event fed. */
  w.spawn = (n, { species = REX, ago = 0, fresh = true, growth = 0.25, event = true } = {}) => {
    const d = { steamId: ids(n), species, spawnedAt: w.now - ago, fresh, growth };
    w.dinos.push(d);
    if (event) caps.onEvent({ t: d.spawnedAt, type: 'spawn', steamId: d.steamId });
    return d;
  };
  w.gone = (n) => { w.dinos = w.dinos.filter((d) => d.steamId !== ids(n)); };
  w.later = async (s = JUDGE_AFTER_S) => { w.now += s; await caps.tick(); };
  w.caps = caps;
  return w;
}
const REX_RULE = (cap, extra = {}) => ({ enabled: true, graceS: 30, species: { Tyrannosaurus: { cap } }, ...extra });

test('validate: names, whole numbers in range, 0 = no limit, off by default', () => {
  assert.deepEqual(validateSpeciesCap({}), { enabled: false, graceS: 30, species: {} });
  assert.deepEqual(validateSpeciesCap({ enabled: true, graceS: 60, species: { Tyrannosaurus: { cap: 5 }, Allosaurus: { cap: 0 } } }),
    { enabled: true, graceS: 60, species: { Tyrannosaurus: { cap: 5 } } });
  assert.throws(() => validateSpeciesCap({ species: { 'Rex!': { cap: 1 } } }), /not a species/);
  assert.throws(() => validateSpeciesCap({ species: { Tyrannosaurus: { cap: -1 } } }), /cap must be/);
  assert.throws(() => validateSpeciesCap({ species: { Tyrannosaurus: { cap: 2.5 } } }), /cap must be/);
  assert.throws(() => validateSpeciesCap({ graceS: 2 }), /graceS/);
});

test('saved and read back', async () => {
  await saveSpeciesCap({ enabled: true, graceS: 20, species: { Allosaurus: { cap: 3 } } });
  assert.deepEqual(await readSpeciesCap(), { enabled: true, graceS: 20, species: { Allosaurus: { cap: 3 } } });
  await assert.rejects(() => saveSpeciesCap({ species: { Allosaurus: { cap: 'x' } } }));
});

test('T-Rex 2: the 3rd player who counts is listed to be removed after graceS; its dino gone, the entry with it', async () => {
  const w = rig(REX_RULE(2));
  w.spawn(1, { ago: 100, event: false });
  w.spawn(2, { ago: 50, event: false });
  const c = w.spawn(3);
  await w.later(JUDGE_AFTER_S - 1);
  assert.equal(w.over.length, 0, 'judged only after a few seconds (a rebirth / garage mark comes with the next events)');
  await w.later(1);
  assert.deepEqual(w.over.map((o) => [o.steamId, o.species]), [[c.steamId, 'Tyrannosaurus']]);
  assert.equal(w.over[0].killAt, w.now + 30);
  assert.equal(w.state.seq, 1);
  assert.deepEqual(w.caps.counts(), [{ species: 'Tyrannosaurus', alive: 2, free: 0, cap: 2 }], 'the one over does not count');
  w.gone(3);
  await w.later(1);
  assert.equal(w.over.length, 0);
});

test('SVip and admins: never listed, never counted; VIP counts like anyone', async () => {
  const SVIP = 10, ADMIN = 11, VIP = 12;
  const w = rig(REX_RULE(1), { exempt: [ids(SVIP), ids(ADMIN)] });
  w.spawn(SVIP, { ago: 100, event: false });
  w.spawn(ADMIN, { ago: 90, event: false });
  w.spawn(1, { ago: 2 });   // the first that counts: room
  await w.later();
  assert.equal(w.over.length, 0, 'SVip and admin dinos take no place');
  w.spawn(SVIP + 100, { ago: 0 });
  w.exempt.add(ids(SVIP + 100));
  w.spawn(VIP);
  await w.later();
  assert.deepEqual(w.over.map((o) => o.steamId), [ids(VIP)], 'the limit full: a VIP is over, a SVip is not');
  assert.deepEqual(w.caps.counts(), [{ species: 'Tyrannosaurus', alive: 1, free: 3, cap: 1 }]);
});

test('who came first keeps the place: two at once, the later one is over', async () => {
  const w = rig(REX_RULE(2));
  w.spawn(1, { ago: 100, event: false });
  w.spawn(2, { ago: 3 });
  w.spawn(3, { ago: 1 });
  await w.later();
  assert.deepEqual(w.over.map((o) => o.steamId), [ids(3)]);
});

test('never touched: a relog, a rebirth / garage dino (not fresh), a grown dino, another species, a species with no limit', async () => {
  const w = rig(REX_RULE(1));
  w.spawn(1, { ago: 100, event: false });
  w.spawn(2, { fresh: false });
  w.spawn(3, { growth: 0.6 });
  w.spawn(4, { growth: null });
  w.spawn(5, { species: 'BP_Allosaurus_C' });
  await w.later();
  assert.equal(w.over.length, 0);
});

test('only what happens now: events read again at a bridge start are not judged', async () => {
  const w = rig(REX_RULE(1));
  w.spawn(1, { ago: 100, event: false });
  w.caps.onEvent({ t: w.now - 3600, type: 'spawn', steamId: ids(2) });
  w.dinos.push({ steamId: ids(2), species: REX, spawnedAt: w.now - 3600, fresh: true, growth: 0.25 });
  await w.later();
  assert.equal(w.over.length, 0);
});

test('off: nobody over, nothing judged', async () => {
  const w = rig(REX_RULE(1));
  w.spawn(1, { ago: 100, event: false });
  w.spawn(2);
  await w.later();
  assert.equal(w.over.length, 1);
  w.settings = { ...w.settings, enabled: false };
  await w.later(1);
  assert.equal(w.over.length, 0);
  w.spawn(3);
  await w.later();
  assert.equal(w.over.length, 0);
});

test('the store: alive dinos, fresh or not; a removal by the limit is not a death', () => {
  const s = new Store();
  const t = Math.floor(Date.now() / 1000);
  const A = ids(1), B = ids(2), C = ids(3);
  const feed = (raws) => { for (const r of raws) { const e = parseEvent(r); assert.notEqual(e, null, JSON.stringify(r)); s.apply(e); } };
  feed([
    { t: t - 100, type: 'session_start', steamId: A, name: 'A' },
    { t: t - 100, type: 'spawn', steamId: A, species: REX, growth: 0.25 },
    { t: t - 90, type: 'session_start', steamId: B, name: 'B' },
    { t: t - 90, type: 'spawn', steamId: B, species: REX, growth: 0.7 },
    { t: t - 60, type: 'session_end', steamId: B, duration: 30 },
    { t: t - 10, type: 'session_start', steamId: B, name: 'B' },
    { t: t - 10, type: 'spawn', steamId: B, species: REX, growth: 0.7 },
    { t: t - 5, type: 'session_start', steamId: C, name: 'C' },
    { t: t - 5, type: 'spawn', steamId: C, species: 'AdminPawn', growth: null },
    { t: t - 1, type: 'snapshot', steamId: A, species: REX, growth: 0.25 },
    { t: t - 1, type: 'snapshot', steamId: B, species: REX, growth: 0.7 },
  ]);
  const alive = s.aliveDinos().sort((a, b) => a.steamId.localeCompare(b.steamId));
  assert.deepEqual(alive.map((d) => [d.steamId, d.species, d.fresh, d.growth]), [[A, REX, true, 0.25], [B, REX, false, 0.7]],
    'B relogged on the dino they had; the admin camera is not a dino');
  feed([
    { t, type: 'species_cap_kill', steamId: A, species: 'Tyrannosaurus', capId: 1 },
    { t: t + 2, type: 'death', steamId: A, species: REX, growth: 0.25 },
  ]);
  const a = s.player(A);
  assert.equal(a.player.deaths, 0, 'not a death');
  assert.equal(a.lives[0].end, 'admin');
  assert.ok(!s.aliveDinos().some((d) => d.steamId === A));
});
