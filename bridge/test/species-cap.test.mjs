// The species limit (species-cap.ts): a species at its limit (plain players, VIP included; SVip and
// admins not counted) off the game's picker by RCON, back once there is room; nothing removed; the
// store's alive dinos (aliveDinos). npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'species-cap-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
const { SpeciesCaps, validateSpeciesCap, saveSpeciesCap, readSpeciesCap } = await import('../dist/species-cap.js');
const { Store } = await import('../dist/store.js');
const { parseEvent } = await import('../dist/events.js');
after(() => rmSync(root, { recursive: true, force: true }));

const ids = (n) => `7656119800000${String(n).padStart(4, '0')}`;
const REX = 'BP_Tyrannosaurus_C';

/** A SpeciesCaps on fakes: the dinos alive, who is not counted (SVip / admins), Game.ini's list, RCON calls. */
function rig(settings, { exempt = [], allowed = ['Tyrannosaurus', 'Allosaurus'] } = {}) {
  const w = { now: 1_000_000, dinos: [], calls: [], state: { hidden: [] }, settings, exempt: new Set(exempt), listed: null };
  const caps = new SpeciesCaps({
    aliveDinos: () => w.dinos,
    exempt: async () => w.exempt,
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
    now: () => w.now,
    log: () => undefined,
  });
  w.add = (n, species = REX) => { w.dinos.push({ steamId: ids(n), species }); };
  w.gone = (n) => { w.dinos = w.dinos.filter((d) => d.steamId !== ids(n)); };
  w.later = async (s = 5) => { w.now += s; await caps.tick(); };
  w.caps = caps;
  w.off = (sp = 'Tyrannosaurus') => w.calls.filter((c) => c === `removePlayable ${sp}`).length;
  w.on = (sp = 'Tyrannosaurus') => w.calls.filter((c) => c === `addPlayable ${sp}`).length;
  return w;
}
const REX_RULE = (cap) => ({ enabled: true, species: { Tyrannosaurus: { cap } } });

test('validate: names, whole numbers in range, 0 = no limit, off by default', () => {
  assert.deepEqual(validateSpeciesCap({}), { enabled: false, species: {} });
  assert.deepEqual(validateSpeciesCap({ enabled: true, species: { Tyrannosaurus: { cap: 5 }, Allosaurus: { cap: 0 } } }),
    { enabled: true, species: { Tyrannosaurus: { cap: 5 } } });
  assert.throws(() => validateSpeciesCap({ species: { 'Rex!': { cap: 1 } } }), /not a species/);
  assert.throws(() => validateSpeciesCap({ species: { Tyrannosaurus: { cap: -1 } } }), /cap must be/);
  assert.throws(() => validateSpeciesCap({ species: { Tyrannosaurus: { cap: 2.5 } } }), /cap must be/);
});

test('saved and read back', async () => {
  await saveSpeciesCap({ enabled: true, species: { Allosaurus: { cap: 3 } } });
  assert.deepEqual(await readSpeciesCap(), { enabled: true, species: { Allosaurus: { cap: 3 } } });
  await assert.rejects(() => saveSpeciesCap({ species: { Allosaurus: { cap: 'x' } } }));
});

test('T-Rex 2: off the picker at the 2nd plain player\'s T-Rex, once; back when one goes; nothing else done', async () => {
  const w = rig(REX_RULE(2));
  w.add(1);
  await w.later();
  assert.equal(w.off(), 0, '1 of 2: still on the picker');
  w.add(2);
  await w.later();
  assert.equal(w.off(), 1, '2 of 2: off');
  assert.deepEqual(w.state.hidden, ['Tyrannosaurus']);
  w.add(3);   // came back on a dino they had (a relog): plays as ever, nothing removed
  await w.later();
  assert.equal(w.off(), 1, 'taken off once, not again every tick');
  assert.deepEqual(w.caps.counts(), [{ species: 'Tyrannosaurus', alive: 3, free: 0, cap: 2, hidden: true }]);
  w.gone(3); await w.later();
  assert.equal(w.on(), 0, 'still 2: stays off');
  w.gone(1); await w.later();
  assert.equal(w.on(), 1, '1 of 2: back on the picker');
  assert.deepEqual(w.state.hidden, []);
});

test('SVip and admins are not counted; VIP is', async () => {
  const SVIP = 10, ADMIN = 11;
  const w = rig(REX_RULE(1), { exempt: [ids(SVIP), ids(ADMIN)] });
  w.add(SVIP); w.add(ADMIN);
  await w.later();
  assert.equal(w.off(), 0);
  assert.deepEqual(w.caps.counts(), [{ species: 'Tyrannosaurus', alive: 0, free: 2, cap: 1, hidden: false }]);
  w.add(12);   // a VIP: a plain player for the limit
  await w.later();
  assert.equal(w.off(), 1);
});

test('another species, a species with no limit: left alone; off: every species this took off put back', async () => {
  const w = rig(REX_RULE(1));
  w.add(1, 'BP_Allosaurus_C'); w.add(2, 'BP_Allosaurus_C');
  await w.later();
  assert.deepEqual(w.calls, []);
  w.add(3);
  await w.later();
  assert.equal(w.off(), 1);
  w.settings = { ...w.settings, enabled: false };
  await w.later();
  assert.equal(w.on(), 1);
  assert.equal(w.calls.filter((c) => c.includes('Allosaurus')).length, 0);
});

test('a species Game.ini does not allow is never put back; Game.ini unreadable: nothing put back yet', async () => {
  const w = rig(REX_RULE(1), { allowed: ['Allosaurus'] });
  w.add(1); await w.later();
  w.gone(1); await w.later();
  assert.equal(w.on(), 0);
  assert.equal(w.caps.counts()[0].hidden, false, 'no longer ours');
  const w2 = rig(REX_RULE(1), { allowed: null });
  w2.add(1); await w2.later();
  w2.gone(1); await w2.later();
  assert.equal(w2.on(), 0);
  assert.equal(w2.caps.counts()[0].hidden, true, 'kept off until Game.ini can be read');
});

test('the game restarted (every species back): taken off again; one the game lists again is taken off again', async () => {
  const w = rig(REX_RULE(1));
  w.add(1); await w.later();
  assert.equal(w.off(), 1);
  w.caps.onEvent({ t: w.now, type: 'mod_loaded', mod: 'StatsLogger' });
  await w.later();
  assert.equal(w.off(), 2, 'after a server start');
  w.caps.onEvent({ t: w.now - 3600, type: 'mod_loaded', mod: 'StatsLogger' });
  await w.later();
  assert.equal(w.off(), 2, 'an old start read again at a bridge start: nothing');
  w.listed = ['Allosaurus', 'Tyrannosaurus'];   // the bridge was down through a restart
  await w.later(31);
  assert.equal(w.off(), 3);
});

test('the store: one alive dino per online player; the admin camera is not a dino', () => {
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
  assert.deepEqual(alive, [{ steamId: A, species: REX }, { steamId: B, species: REX }], 'B relogged: counted as any other; the admin camera is not a dino');
});
