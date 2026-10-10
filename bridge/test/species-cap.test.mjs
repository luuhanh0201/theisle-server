// The species limit (species-cap.ts): a full species off the game's picker, a player with no priority
// slot past the common slots listed for DinoGarage to remove; relogs, rebirths, garage dinos and grown
// dinos never; the store's alive dinos (aliveDinos) and the removal not counted as a death. npm test.
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

/** A SpeciesCaps on fakes: the clock, the dinos alive, VIPs, Game.ini's list, RCON calls. */
function rig(settings, { allowed = ['Tyrannosaurus', 'Allosaurus'], priority = [] } = {}) {
  const w = { now: 1_000_000, dinos: [], calls: [], over: [], state: { hidden: [], seq: 0 }, settings, listed: null, prio: new Set(priority) };
  const caps = new SpeciesCaps({
    aliveDinos: () => w.dinos,
    priority: async () => w.prio,
    allowed: async () => (allowed === null ? null : new Set(allowed)),
    rcon: {
      enabled: true,
      run: async (name, arg) => {
        w.calls.push(arg === undefined ? name : `${name} ${arg}`);
        return name === 'getPlayables' ? `[x] Playables\n${(w.listed ?? []).join(',')},` : 'ok';
      },
    },
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
const REX_RULE = (cap, reserve = 0, extra = {}) => ({ enabled: true, graceS: 30, species: { Tyrannosaurus: { cap, reserve } }, ...extra });

test('validate: names, whole numbers in range, off by default', () => {
  assert.deepEqual(validateSpeciesCap({}), { enabled: false, graceS: 30, species: {} });
  assert.deepEqual(validateSpeciesCap({ enabled: true, graceS: 60, species: { Tyrannosaurus: { cap: 8 } } }),
    { enabled: true, graceS: 60, species: { Tyrannosaurus: { cap: 8, reserve: 0 } } });
  assert.throws(() => validateSpeciesCap({ species: { 'Rex!': { cap: 1 } } }), /not a species/);
  assert.throws(() => validateSpeciesCap({ species: { Tyrannosaurus: { cap: -1 } } }), /cap must be/);
  assert.throws(() => validateSpeciesCap({ species: { Tyrannosaurus: { cap: 2.5 } } }), /cap must be/);
  assert.throws(() => validateSpeciesCap({ graceS: 2 }), /graceS/);
});

test('saved and read back; a broken file reads as the defaults', async () => {
  await saveSpeciesCap({ enabled: true, graceS: 20, species: { Allosaurus: { cap: 3, reserve: 1 } } });
  assert.deepEqual(await readSpeciesCap(), { enabled: true, graceS: 20, species: { Allosaurus: { cap: 3, reserve: 1 } } });
  await assert.rejects(() => saveSpeciesCap({ species: { Allosaurus: { cap: 'x' } } }));
});

test('8 common slots: the 9th plain player is listed to be removed, the picker hides the species at 8', async () => {
  const w = rig(REX_RULE(2));
  w.spawn(1, { ago: 100, event: false });
  w.spawn(2, { ago: 50, event: false });
  await w.later(1);
  assert.deepEqual(w.calls, ['removePlayable Tyrannosaurus'], 'full at 2: off the picker');
  const c = w.spawn(3);   // picked a moment before it went off
  await w.later(JUDGE_AFTER_S - 1);
  assert.equal(w.over.length, 0, 'judged only after a few seconds (a rebirth / garage mark comes with the next events)');
  await w.later(1);
  assert.deepEqual(w.over.map((o) => [o.steamId, o.species]), [[c.steamId, 'Tyrannosaurus']]);
  assert.equal(w.over[0].killAt, w.now + 30, 'removed after graceS');
  assert.deepEqual(w.caps.counts(), [{ species: 'Tyrannosaurus', alive: 2, cap: 2, reserve: 0, hidden: true }], 'the one over does not count');
  // Its dino gone (removed, or they stored it): the entry with it; one of the two dies: back on the picker.
  w.gone(3); w.gone(1);
  await w.later(1);
  assert.equal(w.over.length, 0);
  assert.equal(w.calls.at(-1), 'addPlayable Tyrannosaurus');
  assert.equal(w.calls.filter((x) => x.startsWith('removePlayable')).length, 1, 'taken off once, not again every tick');
  assert.equal(w.caps.counts()[0].hidden, false);
});

test('priority slots: VIP / SVip / admin may fill them, a plain player there is over; every dino counts', async () => {
  const VIP = 10;
  const w = rig(REX_RULE(2, 1), { priority: [ids(VIP)] });
  w.spawn(1, { ago: 100, event: false });
  w.spawn(2, { ago: 90, event: false });
  w.spawn(3, { ago: 0 });   // plain, the third: the priority slot is not theirs
  await w.later();
  assert.deepEqual(w.over.map((o) => o.steamId), [ids(3)]);
  assert.deepEqual(w.calls, [], 'the one over does not count: 2 of 3, still on the picker');
  w.gone(3);
  w.spawn(VIP);
  await w.later();
  assert.equal(w.over.length, 0, 'the VIP keeps theirs');
  assert.deepEqual(w.calls, ['removePlayable Tyrannosaurus'], '2 + 1 priority: full');
  // A VIP already in the common slots: a plain player still finds the priority slot taken by nobody else.
  const w2 = rig(REX_RULE(2, 1), { priority: [ids(VIP)] });
  w2.spawn(VIP, { ago: 100, event: false });
  w2.spawn(1, { ago: 90, event: false });
  w2.spawn(2);
  await w2.later();
  assert.equal(w2.over.length, 0, 'the VIP counts in the priority slot first: 1 common used, the plain player gets the 2nd');
});

test('who came first keeps the slot: two at once, the later one is over', async () => {
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
  const w = rig(REX_RULE(0));
  w.caps.onEvent({ t: w.now - 3600, type: 'spawn', steamId: ids(1) });
  w.dinos.push({ steamId: ids(1), species: REX, spawnedAt: w.now - 3600, fresh: true, growth: 0.25 });
  await w.later();
  assert.equal(w.over.length, 0);
});

test('off, a limit raised or taken away: the species back on the picker, nobody over', async () => {
  const w = rig(REX_RULE(1));
  w.spawn(1, { ago: 100, event: false });
  w.spawn(2);
  await w.later();
  assert.equal(w.over.length, 1);
  assert.ok(w.calls.includes('removePlayable Tyrannosaurus'));
  w.settings = { ...w.settings, enabled: false };
  await w.later(1);
  assert.equal(w.over.length, 0);
  assert.equal(w.calls.at(-1), 'addPlayable Tyrannosaurus');
  assert.deepEqual(w.state.hidden, []);
});

test('a species Game.ini does not allow is never put back; Game.ini unreadable: nothing put back yet', async () => {
  const w = rig(REX_RULE(1), { allowed: ['Allosaurus'] });
  w.spawn(1, { ago: 100, event: false });
  await w.later(1);
  w.gone(1);
  await w.later(1);
  assert.ok(!w.calls.includes('addPlayable Tyrannosaurus'));
  assert.equal(w.caps.counts()[0].hidden, false, 'no longer ours');
  const w2 = rig(REX_RULE(1), { allowed: null });
  w2.spawn(1, { ago: 100, event: false });
  await w2.later(1);
  w2.gone(1);
  await w2.later(1);
  assert.ok(!w2.calls.includes('addPlayable Tyrannosaurus'));
  assert.equal(w2.caps.counts()[0].hidden, true, 'kept hidden until Game.ini can be read');
});

test('the game restarted (Game.ini read again): taken off again; one the game lists again is taken off again', async () => {
  const w = rig(REX_RULE(1));
  w.spawn(1, { ago: 100, event: false });
  await w.later(1);
  assert.equal(w.calls.filter((c) => c === 'removePlayable Tyrannosaurus').length, 1);
  w.caps.onEvent({ t: w.now, type: 'mod_loaded', mod: 'StatsLogger' });
  await w.later(1);
  assert.equal(w.calls.filter((c) => c === 'removePlayable Tyrannosaurus').length, 2, 'after a server start');
  // The bridge was down through a restart: the game shows it again, the 30 s check sees it.
  w.listed = ['Allosaurus', 'Tyrannosaurus'];
  await w.later(31);
  assert.equal(w.calls.filter((c) => c === 'removePlayable Tyrannosaurus').length, 3);
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
